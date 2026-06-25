import * as THREE from 'three';

const DEFAULT_AUTO_EXPOSURE = {
    enabled: true,
    targetLuminance: 0.18,
    minExposureScale: 0.5,
    maxExposureScale: 1.65,
    adaptationUpSeconds: 1.15,
    adaptationDownSeconds: 0.55,
    vrAdaptationUpSeconds: 1.65,
    vrAdaptationDownSeconds: 0.95,
    meteringMinLog: -7,
    meteringMaxLog: 3
};

/**
 * Tiny GPU log-luminance meter with CPU feedback. The pass outputs one encoded
 * log-average luminance pixel; JS eases that into an exposure multiplier used by
 * the final grade/retro pass.
 */
export class AutoExposureController {
    constructor({ renderer }) {
        this.renderer = renderer;
        this.config = { ...DEFAULT_AUTO_EXPOSURE };
        this.exposureScale = 1;
        this.targetExposureScale = 1;
        this.lastLuminance = 0.18;
        this.lastSampleAt = 0;
        this.lastError = null;

        this._pixel = new Uint8Array(4);
        this._previousViewport = new THREE.Vector4();
        this._meterTarget = new THREE.WebGLRenderTarget(1, 1, {
            depthBuffer: false,
            stencilBuffer: false,
            magFilter: THREE.NearestFilter,
            minFilter: THREE.NearestFilter,
            type: THREE.UnsignedByteType
        });
        this._meterTarget.texture.name = 'AutoExposureMeter';
        this._meterTarget.texture.colorSpace = THREE.NoColorSpace;

        this._material = new THREE.ShaderMaterial({
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
            uniforms: {
                tInput: { value: null },
                uUvMin: { value: new THREE.Vector2(0, 0) },
                uUvMax: { value: new THREE.Vector2(1, 1) },
                uMinLog: { value: DEFAULT_AUTO_EXPOSURE.meteringMinLog },
                uMaxLog: { value: DEFAULT_AUTO_EXPOSURE.meteringMaxLog }
            },
            vertexShader: /* glsl */`
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                varying vec2 vUv;
                uniform sampler2D tInput;
                uniform vec2 uUvMin;
                uniform vec2 uUvMax;
                uniform float uMinLog;
                uniform float uMaxLog;

                void main() {
                    float acc = 0.0;
                    for (int y = 0; y < 8; y++) {
                        for (int x = 0; x < 8; x++) {
                            vec2 p = (vec2(float(x), float(y)) + 0.5) / 8.0;
                            vec2 uv = mix(uUvMin, uUvMax, p);
                            vec3 color = texture2D(tInput, uv).rgb;
                            float luma = max(dot(color, vec3(0.2126, 0.7152, 0.0722)), 0.00001);
                            float encoded = clamp((log2(luma) - uMinLog) / max(0.0001, uMaxLog - uMinLog), 0.0, 1.0);
                            acc += encoded;
                        }
                    }
                    float avg = acc / 64.0;
                    gl_FragColor = vec4(avg, avg, avg, 1.0);
                }
            `
        });

        this._scene = new THREE.Scene();
        this._scene.matrixWorldAutoUpdate = false;
        this._camera = new THREE.Camera();
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material);
        quad.frustumCulled = false;
        this._scene.add(quad);
        this._quad = quad;
    }

    applyConfig(config = {}) {
        this.config = { ...DEFAULT_AUTO_EXPOSURE, ...config };
        this.exposureScale = THREE.MathUtils.clamp(
            this.exposureScale,
            this.config.minExposureScale,
            this.config.maxExposureScale
        );
        this.targetExposureScale = THREE.MathUtils.clamp(
            this.targetExposureScale,
            this.config.minExposureScale,
            this.config.maxExposureScale
        );
    }

    updateFromTexture(texture, dt = 0, { vr = false, uvMin = [0, 0], uvMax = [1, 1] } = {}) {
        if (!this.config.enabled || !texture) {
            this.exposureScale = 1;
            this.targetExposureScale = 1;
            return this.exposureScale;
        }

        const luminance = this._sampleLuminance(texture, uvMin, uvMax);
        if (Number.isFinite(luminance) && luminance > 0) {
            this.lastLuminance = luminance;
            this.targetExposureScale = THREE.MathUtils.clamp(
                (this.config.targetLuminance ?? 0.18) / Math.max(luminance, 0.00001),
                this.config.minExposureScale ?? 0.5,
                this.config.maxExposureScale ?? 1.65
            );
            this.lastSampleAt = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        }

        const rising = this.targetExposureScale > this.exposureScale;
        const seconds = vr
            ? (rising ? this.config.vrAdaptationUpSeconds : this.config.vrAdaptationDownSeconds)
            : (rising ? this.config.adaptationUpSeconds : this.config.adaptationDownSeconds);
        const alpha = 1 - Math.exp(-Math.max(0, dt) / Math.max(0.001, seconds ?? 1));
        this.exposureScale += (this.targetExposureScale - this.exposureScale) * alpha;
        this.exposureScale = THREE.MathUtils.clamp(
            this.exposureScale,
            this.config.minExposureScale ?? 0.5,
            this.config.maxExposureScale ?? 1.65
        );
        return this.exposureScale;
    }

    getExposureScale() {
        return this.config.enabled ? this.exposureScale : 1;
    }

    getDebugState(baseExposure = 1) {
        const scale = this.getExposureScale();
        return {
            enabled: Boolean(this.config.enabled),
            luminance: Number(this.lastLuminance.toFixed(5)),
            exposureScale: Number(scale.toFixed(3)),
            targetExposureScale: Number(this.targetExposureScale.toFixed(3)),
            effectiveExposure: Number((baseExposure * scale).toFixed(3)),
            targetLuminance: this.config.targetLuminance,
            range: [this.config.minExposureScale, this.config.maxExposureScale],
            lastSampleAt: this.lastSampleAt,
            lastError: this.lastError ? String(this.lastError.message || this.lastError) : null
        };
    }

    dispose() {
        this._meterTarget.dispose();
        this._material.dispose();
        this._quad.geometry.dispose();
    }

    _sampleLuminance(texture, uvMin, uvMax) {
        const renderer = this.renderer;
        const prevTarget = renderer.getRenderTarget();
        const prevAutoClear = renderer.autoClear;
        const prevXrEnabled = renderer.xr.enabled;
        renderer.getViewport(this._previousViewport);

        try {
            this._material.uniforms.tInput.value = texture;
            this._material.uniforms.uUvMin.value.fromArray(uvMin);
            this._material.uniforms.uUvMax.value.fromArray(uvMax);
            this._material.uniforms.uMinLog.value = this.config.meteringMinLog ?? -7;
            this._material.uniforms.uMaxLog.value = this.config.meteringMaxLog ?? 3;

            // The meter is a monoscopic offscreen pass. During an XR frame, keep
            // it out of WebXRManager's ArrayCamera substitution, then restore.
            if (renderer.xr.isPresenting) renderer.xr.enabled = false;
            renderer.autoClear = true;
            renderer.setRenderTarget(this._meterTarget);
            renderer.render(this._scene, this._camera);
            renderer.readRenderTargetPixels(this._meterTarget, 0, 0, 1, 1, this._pixel);

            const encoded = this._pixel[0] / 255;
            const minLog = this.config.meteringMinLog ?? -7;
            const maxLog = this.config.meteringMaxLog ?? 3;
            this.lastError = null;
            return Math.pow(2, minLog + encoded * (maxLog - minLog));
        } catch (error) {
            this.lastError = error;
            return this.lastLuminance;
        } finally {
            renderer.xr.enabled = prevXrEnabled;
            renderer.autoClear = prevAutoClear;
            renderer.setRenderTarget(prevTarget);
            renderer.setViewport(this._previousViewport);
        }
    }
}
