import * as THREE from 'three';
import { AutoExposureController } from './AutoExposureController.js';

/**
 * Custom WebXR post-FX pipeline (Phase 06).
 *
 * Why this exists, and why it is shaped the way it is:
 *
 * Three's `EffectComposer` is not a safe WebXR path, and the earlier prototype
 * (XRVisualEffects.renderXrPostFx) toggled `renderer.xr.enabled` mid-frame and
 * composited to the canvas (`setRenderTarget(null)`) instead of the XR
 * framebuffer, which presents black in a real headset. This pipeline avoids
 * both mistakes.
 *
 * Verified facts about three r160 WebXRManager that this relies on:
 *  - While presenting, `renderer.render(scene, anyCamera)` always swaps in the
 *    XR `ArrayCamera`, which renders each eye into its own `camera.viewport`
 *    inside whatever render target is currently bound. So we never need to
 *    toggle `xr.enabled`: we bind our own target and let the ArrayCamera fill
 *    both eye viewports.
 *  - On Quest 3 (WebGL2 + projection layers) both eyes share ONE side-by-side
 *    2D texture, distinguished only by `camera.viewport`.
 *  - The XR framebuffer is the render target returned by
 *    `renderer.getRenderTarget()` at the start of the animation-frame callback
 *    (an `isXRRenderTarget` WebGLRenderTarget), NOT `null`. We capture it first
 *    and composite back into it.
 *  - `mesh.onBeforeRender` fires once per eye with that eye's sub-camera, which
 *    is how we feed per-eye UV rects to the fullscreen passes.
 *
 * Every pass uses a clip-space passthrough quad (the vertex shader ignores the
 * camera, so the ArrayCamera projection is irrelevant and only the viewport
 * matters). Intermediate render targets are left in linear space and the
 * composite shader omits `colorspace_fragment` exactly like the desktop
 * `Retro16BitShader`, so the VR image matches the desktop look by construction.
 */
export class XRPostFxPipeline {
    constructor({ renderer }) {
        this.renderer = renderer;

        this.enabled = true;
        this.quality = 'high';
        this.sceneSamples = 0;
        this.failHardOnError = true;
        this.lastError = null;
        this.lastErrorAt = 0;
        this.lastFrameMs = 0;
        this._warnedError = false;

        this._size = new THREE.Vector2(0, 0);
        this.sceneRT = null;
        this.bloomA = null;
        this.bloomB = null;

        this.bloom = { enabled: true, strength: 1.2, radius: 0.8, threshold: 0.1 };
        this.autoExposure = new AutoExposureController({ renderer });
        this.retroExposureBase = 3;
        this.warp = {
            enabled: true,
            speedFactor: 0,
            debugOverrideEnabled: false,
            debugSpeedFactor: 0,
            blurStrength: 0.04,
            aberrationStrength: 0.00005,
            vignetteStrength: 0.4,
            streakIntensity: 0.015,
            distortion: 0
        };

        // Shared clip-space quad geometry for every pass.
        this._quad = new THREE.PlaneGeometry(2, 2);

        this._buildBrightPass();
        this._buildBlurPass();
        this._buildCompositePass();
    }

    // ---- public API --------------------------------------------------------

    setBackendConfig({ enabled, quality, sceneSamples, failHardOnError, foveation } = {}) {
        if (enabled !== undefined) this.enabled = Boolean(enabled);
        if (quality !== undefined) this.quality = quality;
        if (sceneSamples !== undefined && sceneSamples !== this.sceneSamples) {
            this.sceneSamples = Math.max(0, Math.floor(sceneSamples));
            this._size.set(0, 0); // force target rebuild
        }
        if (failHardOnError !== undefined) this.failHardOnError = Boolean(failHardOnError);
        if (foveation !== undefined && typeof this.renderer.xr.setFoveation === 'function') {
            this.renderer.xr.setFoveation(THREE.MathUtils.clamp(foveation, 0, 1));
        }
    }

    applyConfig(config) {
        const bloom = config.bloom ?? {};
        this.bloom.enabled = bloom.enabled !== false;
        this.bloom.strength = (bloom.strength ?? 1.2) * (bloom.xrStrengthScale ?? 1);
        this.bloom.radius = (bloom.radius ?? 0.8) * (bloom.xrRadiusScale ?? 1);
        this.bloom.threshold = bloom.threshold ?? 0.1;

        const warp = config.warp ?? {};
        this.warp.enabled = warp.enabled !== false;
        this.warp.debugOverrideEnabled = Boolean(warp.debugOverrideEnabled);
        this.warp.debugSpeedFactor = warp.debugSpeedFactor ?? 0;
        this.warp.blurStrength = warp.blurStrength ?? 0.04;
        this.warp.aberrationStrength = warp.aberrationStrength ?? 0.00005;
        this.warp.vignetteStrength = warp.vignetteStrength ?? 0.4;
        this.warp.streakIntensity = warp.streakIntensity ?? 0.015;
        this.warp.distortion = warp.distortion ?? 0;

        const retro = config.retro ?? {};
        const u = this.compositeMaterial.uniforms;
        u.uRetroEnabled.value = retro.enabled !== false ? 1 : 0;
        u.uPixelSize.value = Math.max(1, retro.pixelSize ?? 4);
        u.uColorDepth.value = Math.max(2, retro.colorDepth ?? 16);
        u.uContrast.value = retro.contrast ?? 0.9;
        u.uSaturation.value = retro.saturation ?? 0.5;
        u.uScanlineIntensity.value = retro.scanlineIntensity ?? 0.15;
        u.uScanlineCount.value = retro.scanlineCount ?? 1.5;
        u.uNoiseIntensity.value = retro.noiseIntensity ?? 0;
        u.uVignetteStart.value = retro.vignetteStrength ?? 0.4;
        u.uVignetteIntensity.value = retro.vignetteIntensity ?? 0.6;
        u.uAberration.value = retro.aberration ?? 0;
        u.uBrightness.value = retro.brightness ?? -0.02;
        this.retroExposureBase = retro.exposure ?? 3;
        u.uExposure.value = this.retroExposureBase * this.autoExposure.getExposureScale();

        this.autoExposure.applyConfig(config.autoExposure);

        const xr = config.xrPostFx ?? {};
        this.setBackendConfig({
            enabled: xr.enabled,
            quality: xr.quality,
            sceneSamples: xr.sceneSamples,
            failHardOnError: xr.failHardOnError,
            foveation: xr.foveation
        });
    }

    setWarpSpeedFactor(value) {
        const debugFloor = this.warp.debugOverrideEnabled ? this.warp.debugSpeedFactor : 0;
        const floored = Math.max(value ?? 0, debugFloor);
        this.warp.speedFactor = THREE.MathUtils.clamp(floored, 0, 1);
    }

    // Set directly (no baseline floor) so a vrComfort cap of 0 yields a clean,
    // diegetic-only look in the headset with no code change.
    setWarpDistortion(value) {
        this.warp.distortion = THREE.MathUtils.clamp(value ?? 0, 0, 1);
    }

    /** Render while presenting. Returns true if it drove the XR framebuffer. */
    render({ scene, camera, dt = 0 }) {
        const renderer = this.renderer;
        if (!this.enabled) return false;
        if (!renderer.xr.isPresenting) return false;

        // The XR framebuffer target, captured BEFORE we touch renderer state.
        const xrRenderTarget = renderer.getRenderTarget();
        if (!xrRenderTarget || xrRenderTarget.width < 2 || xrRenderTarget.height < 2) return false;

        return this._runPipeline(scene, camera, xrRenderTarget, dt);
    }

    /**
     * Desktop debug path: run the exact same combined shader single-camera and
     * composite to the canvas. Lets the look be validated without a headset.
     */
    renderDesktopPreview({ scene, camera, dt = 0 }) {
        const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
        // Reuse a render target sized to the canvas so the single camera fills it.
        this._ensureTargets(size.x, size.y);
        return this._runPipeline(scene, camera, null, dt);
    }

    getDebugState() {
        return {
            enabled: this.enabled,
            quality: this.quality,
            sceneSamples: this.sceneSamples,
            failHardOnError: this.failHardOnError,
            renderTargetSize: this._size.toArray(),
            bloom: { ...this.bloom },
            autoExposure: this.autoExposure.getDebugState(this.retroExposureBase),
            warpSpeedFactor: this.warp.speedFactor,
            lastFrameMs: Number(this.lastFrameMs.toFixed(2)),
            lastError: this.lastError ? String(this.lastError.message || this.lastError) : null,
            lastErrorAt: this.lastErrorAt
        };
    }

    dispose() {
        this._disposeTargets();
        this.autoExposure.dispose();
        this._quad.dispose();
        this.brightMaterial.dispose();
        this.blurMaterial.dispose();
        this.compositeMaterial.dispose();
    }

    // ---- internals ---------------------------------------------------------

    _runPipeline(scene, camera, outputTarget, dt) {
        const renderer = this.renderer;
        const t0 = (typeof performance !== 'undefined') ? performance.now() : 0;

        const width = outputTarget ? outputTarget.width : this._size.x;
        const height = outputTarget ? outputTarget.height : this._size.y;
        this._ensureTargets(width, height);

        const prevAutoClear = renderer.autoClear;

        try {
            // 1) Capture the scene (both eyes via the ArrayCamera) into sceneRT.
            renderer.autoClear = true;
            renderer.setRenderTarget(this.sceneRT);
            renderer.render(scene, camera);

            // 2) Meter scene luminance and ease a shared exposure multiplier.
            this.autoExposure.updateFromTexture(this.sceneRT.texture, dt, { vr: true });

            // 3) Bloom: bright-pass + separable blur, all per-eye clamped.
            let bloomTexture = null;
            if (this.bloom.enabled && this.bloom.strength > 0.0001) {
                bloomTexture = this._renderBloom(camera);
            }

            // 4) Composite (scene + bloom + warp + retro) into the output target.
            this._setCompositeUniforms(bloomTexture, dt);
            renderer.setRenderTarget(outputTarget);
            renderer.render(this._compositeScene, camera);

            renderer.autoClear = prevAutoClear;
            this.lastError = null;
            this._warnedError = false;
            this.lastFrameMs = ((typeof performance !== 'undefined') ? performance.now() : 0) - t0;
            return true;
        } catch (error) {
            renderer.autoClear = prevAutoClear;
            this.lastError = error;
            this.lastErrorAt = Date.now();
            if (!this._warnedError) {
                console.error('XRPostFxPipeline failed; presenting a visible error frame (no silent fallback).', error);
                this._warnedError = true;
            }
            // Fail visibly per spec: paint the output target magenta rather than
            // silently falling back to a working direct render.
            if (this.failHardOnError && outputTarget !== undefined) {
                renderer.setRenderTarget(outputTarget);
                renderer.setClearColor(0xff00ff, 1);
                renderer.clear(true, true, false);
            }
            return true; // we still "drove" the frame; caller must not fall back
        }
    }

    _renderBloom(camera) {
        const renderer = this.renderer;
        const iterations = this.quality === 'low' ? 3 : this.quality === 'medium' ? 4 : 5;
        this._bloomIterations = iterations;

        // Bright-pass: sceneRT -> bloomA
        this.brightMaterial.uniforms.tInput.value = this.sceneRT.texture;
        this.brightMaterial.uniforms.uThreshold.value = this.bloom.threshold;
        renderer.setRenderTarget(this.bloomA);
        renderer.render(this._brightScene, camera);

        // Separable gaussian whose stride doubles each iteration, approximating
        // UnrealBloom's mip pyramid: a wide, soft halo from a full-res chain.
        let src = this.bloomA;
        let dst = this.bloomB;
        for (let i = 0; i < iterations; i++) {
            const radius = Math.max(0.0, this.bloom.radius) * Math.pow(1.7, i);

            this.blurMaterial.uniforms.tInput.value = src.texture;
            this.blurMaterial.uniforms.uDir.value.set(1, 0);
            this.blurMaterial.uniforms.uRadius.value = radius;
            renderer.setRenderTarget(dst);
            renderer.render(this._blurScene, camera);

            this.blurMaterial.uniforms.tInput.value = dst.texture;
            this.blurMaterial.uniforms.uDir.value.set(0, 1);
            renderer.setRenderTarget(src);
            renderer.render(this._blurScene, camera);
        }
        return src.texture;
    }

    _setCompositeUniforms(bloomTexture, dt) {
        const u = this.compositeMaterial.uniforms;
        u.tScene.value = this.sceneRT.texture;
        u.tBloom.value = bloomTexture;
        u.uBloomEnabled.value = bloomTexture ? 1 : 0;
        u.uBloomStrength.value = this.bloom.strength;
        // The energy-preserving gaussian dims as it widens; compensate so the
        // wide halo stays as hot as the desktop UnrealBloom sum-of-mips.
        u.uBloomGain.value = 1.0 + (this._bloomIterations ?? 3) * 0.7;
        u.uTime.value += dt;
        u.uExposure.value = this.retroExposureBase * this.autoExposure.getExposureScale();

        u.uWarpEnabled.value = this.warp.enabled ? 1 : 0;
        u.uWarpSpeed.value = this.warp.speedFactor;
        u.uWarpBlur.value = this.warp.blurStrength;
        u.uWarpAberration.value = this.warp.aberrationStrength;
        u.uWarpVignette.value = this.warp.vignetteStrength;
        u.uWarpStreak.value = this.warp.streakIntensity;
        u.uWarpDistortion.value = this.warp.distortion;
    }

    _setEyeUniforms(material, camera) {
        const W = Math.max(1, this._size.x);
        const H = Math.max(1, this._size.y);
        const vp = camera.viewport;
        let x = 0;
        let y = 0;
        let w = W;
        let h = H;
        if (vp && vp.z > 0 && vp.w > 0) {
            x = vp.x;
            y = vp.y;
            w = vp.z;
            h = vp.w;
        }
        const u = material.uniforms;
        u.uEyeUvMin.value.set(x / W, y / H);
        u.uEyeUvMax.value.set((x + w) / W, (y + h) / H);
        if (u.uEyeRes) u.uEyeRes.value.set(w, h);
        if (u.uTexel) u.uTexel.value.set(1 / Math.max(1, w), 1 / Math.max(1, h));
    }

    _ensureTargets(width, height) {
        width = Math.max(2, Math.floor(width));
        height = Math.max(2, Math.floor(height));
        if (this._size.x === width && this._size.y === height && this.sceneRT) return;

        this._disposeTargets();
        this._size.set(width, height);

        // Linear (default colorSpace) so it matches the desktop EffectComposer
        // buffer; NearestFilter keeps the retro pixelation crisp.
        this.sceneRT = new THREE.WebGLRenderTarget(width, height, {
            depthBuffer: true,
            stencilBuffer: false,
            samples: this.sceneSamples,
            magFilter: THREE.NearestFilter,
            minFilter: THREE.NearestFilter
        });
        this.sceneRT.texture.name = 'XRPostFxScene';

        const bloomOpts = {
            depthBuffer: false,
            stencilBuffer: false,
            magFilter: THREE.LinearFilter,
            minFilter: THREE.LinearFilter
        };
        this.bloomA = new THREE.WebGLRenderTarget(width, height, bloomOpts);
        this.bloomB = new THREE.WebGLRenderTarget(width, height, bloomOpts);
        this.bloomA.texture.name = 'XRPostFxBloomA';
        this.bloomB.texture.name = 'XRPostFxBloomB';
    }

    _disposeTargets() {
        this.sceneRT?.dispose();
        this.bloomA?.dispose();
        this.bloomB?.dispose();
        this.sceneRT = this.bloomA = this.bloomB = null;
    }

    _makeQuadScene(material) {
        const scene = new THREE.Scene();
        scene.matrixWorldAutoUpdate = false;
        const mesh = new THREE.Mesh(this._quad, material);
        mesh.frustumCulled = false;
        mesh.onBeforeRender = (_renderer, _scene, cam) => this._setEyeUniforms(material, cam);
        scene.add(mesh);
        return scene;
    }

    _buildBrightPass() {
        this.brightMaterial = new THREE.ShaderMaterial({
            depthTest: false,
            depthWrite: false,
            uniforms: {
                tInput: { value: null },
                uEyeUvMin: { value: new THREE.Vector2(0, 0) },
                uEyeUvMax: { value: new THREE.Vector2(1, 1) },
                uThreshold: { value: 0.1 }
            },
            vertexShader: PASSTHROUGH_VERTEX,
            fragmentShader: /* glsl */`
                varying vec2 vUv;
                uniform sampler2D tInput;
                uniform vec2 uEyeUvMin;
                uniform vec2 uEyeUvMax;
                uniform float uThreshold;

                void main() {
                    vec2 uv = mix(uEyeUvMin, uEyeUvMax, vUv);
                    vec3 c = texture2D(tInput, uv).rgb;
                    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
                    // Soft knee like UnrealBloom's luminance threshold.
                    float knee = smoothstep(uThreshold, uThreshold + 0.35, luma);
                    gl_FragColor = vec4(c * knee, 1.0);
                }
            `
        });
        this._brightScene = this._makeQuadScene(this.brightMaterial);
    }

    _buildBlurPass() {
        this.blurMaterial = new THREE.ShaderMaterial({
            depthTest: false,
            depthWrite: false,
            uniforms: {
                tInput: { value: null },
                uEyeUvMin: { value: new THREE.Vector2(0, 0) },
                uEyeUvMax: { value: new THREE.Vector2(1, 1) },
                uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
                uDir: { value: new THREE.Vector2(1, 0) },
                uRadius: { value: 1.0 }
            },
            vertexShader: PASSTHROUGH_VERTEX,
            fragmentShader: /* glsl */`
                varying vec2 vUv;
                uniform sampler2D tInput;
                uniform vec2 uEyeUvMin;
                uniform vec2 uEyeUvMax;
                uniform vec2 uTexel;
                uniform vec2 uDir;
                uniform float uRadius;

                vec2 clampUv(vec2 uv) { return clamp(uv, uEyeUvMin, uEyeUvMax); }

                void main() {
                    vec2 uv = mix(uEyeUvMin, uEyeUvMax, vUv);
                    vec2 stride = uDir * uTexel * uRadius;

                    float w0 = 0.227027;
                    float w1 = 0.1945946;
                    float w2 = 0.1216216;
                    float w3 = 0.054054;
                    float w4 = 0.016216;

                    vec3 acc = texture2D(tInput, uv).rgb * w0;
                    acc += texture2D(tInput, clampUv(uv + stride * 1.0)).rgb * w1;
                    acc += texture2D(tInput, clampUv(uv - stride * 1.0)).rgb * w1;
                    acc += texture2D(tInput, clampUv(uv + stride * 2.0)).rgb * w2;
                    acc += texture2D(tInput, clampUv(uv - stride * 2.0)).rgb * w2;
                    acc += texture2D(tInput, clampUv(uv + stride * 3.0)).rgb * w3;
                    acc += texture2D(tInput, clampUv(uv - stride * 3.0)).rgb * w3;
                    acc += texture2D(tInput, clampUv(uv + stride * 4.0)).rgb * w4;
                    acc += texture2D(tInput, clampUv(uv - stride * 4.0)).rgb * w4;

                    gl_FragColor = vec4(acc, 1.0);
                }
            `
        });
        this._blurScene = this._makeQuadScene(this.blurMaterial);
    }

    _buildCompositePass() {
        this.compositeMaterial = new THREE.ShaderMaterial({
            depthTest: false,
            depthWrite: false,
            uniforms: {
                tScene: { value: null },
                tBloom: { value: null },
                uEyeUvMin: { value: new THREE.Vector2(0, 0) },
                uEyeUvMax: { value: new THREE.Vector2(1, 1) },
                uEyeRes: { value: new THREE.Vector2(1024, 1024) },
                uTime: { value: 0 },

                uBloomEnabled: { value: 1 },
                uBloomStrength: { value: 1.2 },
                uBloomGain: { value: 1.0 },

                uRetroEnabled: { value: 1 },
                uPixelSize: { value: 4 },
                uColorDepth: { value: 16 },
                uContrast: { value: 0.9 },
                uSaturation: { value: 0.5 },
                uScanlineIntensity: { value: 0.15 },
                uScanlineCount: { value: 1.5 },
                uNoiseIntensity: { value: 0 },
                uVignetteStart: { value: 0.4 },
                uVignetteIntensity: { value: 0.6 },
                uAberration: { value: 0 },
                uBrightness: { value: -0.02 },
                uExposure: { value: 3 },

                uWarpEnabled: { value: 1 },
                uWarpSpeed: { value: 0 },
                uWarpBlur: { value: 0.04 },
                uWarpAberration: { value: 0.00005 },
                uWarpVignette: { value: 0.4 },
                uWarpStreak: { value: 0.015 },
                uWarpDistortion: { value: 0 }
            },
            vertexShader: PASSTHROUGH_VERTEX,
            fragmentShader: COMPOSITE_FRAGMENT
        });
        this._compositeScene = this._makeQuadScene(this.compositeMaterial);
    }
}

const PASSTHROUGH_VERTEX = /* glsl */`
    varying vec2 vUv;
    void main() {
        vUv = uv;
        // Ignore the camera entirely: fill clip space so only the eye viewport
        // (set by the XR ArrayCamera) decides where this quad lands.
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;

/**
 * Combined Bloom -> Warp -> Retro/Pixel/ColorDepth/Scanlines pass. Mirrors the
 * desktop chain (UnrealBloom + WarpSpeedShader + Retro16BitShader) so the VR
 * output reads as the same art direction. Deliberately omits any colorspace
 * conversion, exactly like the desktop Retro pass, for parity.
 */
const COMPOSITE_FRAGMENT = /* glsl */`
    varying vec2 vUv;
    uniform sampler2D tScene;
    uniform sampler2D tBloom;
    uniform vec2 uEyeUvMin;
    uniform vec2 uEyeUvMax;
    uniform vec2 uEyeRes;
    uniform float uTime;

    uniform float uBloomEnabled;
    uniform float uBloomStrength;
    uniform float uBloomGain;

    uniform float uRetroEnabled;
    uniform float uPixelSize;
    uniform float uColorDepth;
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uScanlineIntensity;
    uniform float uScanlineCount;
    uniform float uNoiseIntensity;
    uniform float uVignetteStart;
    uniform float uVignetteIntensity;
    uniform float uAberration;
    uniform float uBrightness;
    uniform float uExposure;

    uniform float uWarpEnabled;
    uniform float uWarpSpeed;
    uniform float uWarpBlur;
    uniform float uWarpAberration;
    uniform float uWarpVignette;
    uniform float uWarpStreak;
    uniform float uWarpDistortion;

    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    // Map an eye-local [0,1] coord to the eye's sub-rect of the source texture.
    vec2 toTex(vec2 eyeUv) {
        return mix(uEyeUvMin, uEyeUvMax, clamp(eyeUv, 0.0, 1.0));
    }

    vec3 sampleScene(vec2 eyeUv) {
        return texture2D(tScene, toTex(eyeUv)).rgb;
    }

    void main() {
        // Retro pixelation snaps to blocks in eye-local space.
        float cell = max(uPixelSize, 1.0);
        vec2 eyeUv = vUv;
        if (uRetroEnabled > 0.5) {
            eyeUv = floor(vUv * uEyeRes / cell) * cell / uEyeRes;
        }

        // Warp: radial displacement + blur toward eye center, driven by speed.
        vec2 center = vec2(0.5);
        vec2 sampleUv = eyeUv;
        float speed = clamp(uWarpSpeed, 0.0, 1.0);
        if (uWarpEnabled > 0.5 && speed > 0.001) {
            vec2 toCenter = center - eyeUv;
            float dist = length(toCenter);
            vec2 dir = normalize(toCenter + 0.00001);
            if (uWarpDistortion > 0.001) {
                float f = 1.0 + uWarpDistortion * dist * dist;
                sampleUv = center - dir * (dist * f);
            }
        }

        // Bloom is added in linear space before the retro treatment, so the glow
        // itself gets pixelated/quantized like the desktop reference.
        vec3 color = sampleScene(sampleUv);

        // Warp radial blur (cheap fixed taps gated by speed).
        if (uWarpEnabled > 0.5 && speed > 0.001) {
            vec2 toCenter = center - sampleUv;
            float dist = length(toCenter);
            vec2 dir = normalize(toCenter + 0.00001);
            float amount = uWarpBlur * speed * speed * dist;
            vec3 blur = color;
            blur += sampleScene(sampleUv + dir * amount * 0.5);
            blur += sampleScene(sampleUv - dir * amount * 0.5);
            blur += sampleScene(sampleUv + dir * amount);
            blur += sampleScene(sampleUv - dir * amount);
            color = blur / 5.0;
            float centerGlow = (1.0 - smoothstep(0.0, 0.3, dist)) * speed * speed * 0.15;
            color += vec3(0.9, 0.95, 1.0) * centerGlow;
        }

        float bloomScale = uBloomStrength * uBloomGain;
        if (uBloomEnabled > 0.5) {
            color += texture2D(tBloom, toTex(sampleUv)).rgb * bloomScale;
        }

        // Optional chromatic aberration (retro), matched to the desktop shader.
        if (uAberration > 0.0) {
            vec2 off = normalize(eyeUv - center + 0.00001) * uAberration;
            color.r = sampleScene(sampleUv + off).r;
            color.b = sampleScene(sampleUv - off).b;
            if (uBloomEnabled > 0.5) {
                color.r += texture2D(tBloom, toTex(sampleUv + off)).r * bloomScale;
                color.b += texture2D(tBloom, toTex(sampleUv - off)).b * bloomScale;
            }
        }

        // ---- Retro16Bit treatment (matches Retro16BitShader math) ----
        color *= uExposure;
        color += uBrightness;
        color = (color - 0.5) * uContrast + 0.5;

        float luma = dot(color, vec3(0.299, 0.587, 0.114));
        color = mix(vec3(luma), color, uSaturation);

        if (uRetroEnabled > 0.5) {
            color = floor(clamp(color, 0.0, 1.0) * uColorDepth) / max(uColorDepth, 1.0);
        }

        float scan = sin(vUv.y * uEyeRes.y * uScanlineCount * 3.14159);
        color *= 1.0 - uScanlineIntensity * (0.5 + 0.5 * scan);
        color += (hash(vUv * uEyeRes + floor(uTime * 18.0)) - 0.5) * uNoiseIntensity;

        // Warp vignette (speed) then the retro vignette.
        if (uWarpEnabled > 0.5 && speed > 0.001) {
            float d = distance(vUv, center);
            float wv = smoothstep(0.0, 1.0, max(0.0, 1.0 - d * uWarpVignette * speed));
            color *= mix(1.0, wv, speed * 0.5);
        }

        float dist = distance(vUv, center);
        float vignette = smoothstep(0.8, uVignetteStart, dist);
        color *= mix(1.0, 1.0 - uVignetteIntensity, vignette);

        gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
`;
