import * as THREE from 'three';

const DEFAULTS = Object.freeze({
    enabled: true,
    previewOnDesktop: false,
    realPostFxEnabled: true,
    framebufferScale: 0.72,
    fovCoverage: 1.15,
    scanlineOpacity: 0.16,
    pixelGridOpacity: 0.08,
    pixelSize: 4,
    colorDepth: 16,
    contrast: 0.9,
    saturation: 0.5,
    brightness: -0.02,
    exposure: 2.5,
    noiseOpacity: 0.025,
    vignetteOpacity: 0.18,
    halftoneOpacity: 0,
    asciiOpacity: 0,
    bloomStrength: 0.85,
    bloomThreshold: 0.22,
    bloomRadius: 1.1,
    bloomSurrogateEnabled: true,
    bloomHazeOpacity: 0.12,
    sceneGlow: 1.2,
    shipGlow: 1.35,
    starGlow: 1.28,
    nebulaGlow: 1.18,
    landmarkGlow: 1.45,
    haloOpacity: 0.68,
    haloScale: 1.25,
    warpEnabled: true,
    warpOpacity: 0.34,
    warpLength: 280,
    warpDensity: 180,
    warpSpeedThreshold: 80,
    warpComfortClamp: 0.7
});

export class XRVisualEffects {
    constructor({ scene, camera, ship, environment }) {
        this.scene = scene;
        this.camera = camera;
        this.ship = ship;
        this.environment = environment;
        this.config = { ...DEFAULTS };
        this._lastStreakDensity = -1;
        this._lastStreakLength = -1;
        this._travel = 0;
        this._rtSize = new THREE.Vector2();

        this.overlay = this._createOverlay();
        this.camera.add(this.overlay);

        this.haloTexture = createRadialTexture();
        this.worldHalos = this._createWorldHalos();
        this.anchorHalos = this._createAnchorHalos();
        this.streaks = this._createStreaks();
        this.ship.exteriorRoot.add(this.streaks);
    }

    update(dt, state = {}) {
        const config = { ...DEFAULTS, ...(state.config ?? {}) };
        this.config = config;

        // The bloom surrogate/overlay system is retired in Phase 06: real bloom +
        // retro now come from XRPostFxPipeline. With the surrogate disabled in the
        // presets these stay inert; the calls remain only so old configs that
        // re-enable them still work for debugging.
        const active = Boolean(config.enabled && (state.xrActive || config.previewOnDesktop));
        const bloomActive = active && Boolean(config.bloomSurrogateEnabled);
        const warpActive = active && Boolean(config.warpEnabled);
        const speed = state.shipSpeed ?? 0;

        this._updateOverlay(dt, active, config);
        this._updateHalos(bloomActive, config);
        this._updateStreaks(dt, warpActive, config, speed);
    }

    /**
     * Retired Phase 06: the per-eye render-target + composite-plane experiment
     * toggled `renderer.xr.enabled` and composited to the canvas, which presents
     * black in a real headset. Hard-disabled; the real path is XRPostFxPipeline.
     */
    renderXrPostFx() {
        return false;
    }

    getDebugState() {
        return {
            overlayVisible: this.overlay.visible,
            realPostFxEnabled: Boolean(this.config.realPostFxEnabled),
            renderTargetSize: this._rtSize.toArray(),
            haloVisibleCount: [...this.worldHalos, ...this.anchorHalos].filter((h) => h.sprite.visible).length,
            streaksVisible: this.streaks.visible,
            streakDrawCount: this.streaks.geometry.drawRange.count,
            config: { ...this.config }
        };
    }

    resize(width, height, pixelRatio = 1) {
        this.overlay.material.uniforms.resolution.value.set(width * pixelRatio, height * pixelRatio);
    }

    _updateOverlay(dt, active, config) {
        const uniforms = this.overlay.material.uniforms;
        uniforms.time.value += dt;
        uniforms.bloomHazeOpacity.value = config.bloomSurrogateEnabled ? config.bloomHazeOpacity : 0;
        uniforms.scanlineOpacity.value = config.scanlineOpacity;
        uniforms.pixelGridOpacity.value = config.pixelGridOpacity;
        uniforms.pixelSize.value = Math.max(1, config.pixelSize);
        uniforms.noiseOpacity.value = config.noiseOpacity;
        uniforms.vignetteOpacity.value = config.vignetteOpacity;
        uniforms.halftoneOpacity.value = config.halftoneOpacity;
        uniforms.asciiOpacity.value = config.asciiOpacity;
        this.overlay.visible = active;
        this.overlay.scale.setScalar(Math.max(0.75, config.fovCoverage));
    }

    _updateHalos(active, config) {
        const opacity = active ? config.haloOpacity : 0;
        const scale = Math.max(0.1, config.haloScale);
        const sceneBoost = Math.max(0, config.sceneGlow);
        const landmarkBoost = Math.max(0, config.landmarkGlow);

        for (const halo of this.worldHalos) {
            halo.target.updateWorldMatrix(true, false);
            halo.target.getWorldPosition(halo.sprite.position);
            halo.sprite.scale.setScalar(halo.baseScale * scale);
            halo.sprite.material.opacity = opacity * halo.opacity * halo.landmarkWeight * landmarkBoost;
            halo.sprite.visible = active && halo.sprite.material.opacity > 0.001;
        }

        for (const halo of this.anchorHalos) {
            halo.sprite.scale.setScalar(halo.baseScale * scale);
            halo.sprite.material.opacity = opacity * halo.opacity * sceneBoost;
            halo.sprite.visible = active && halo.sprite.material.opacity > 0.001;
        }
    }

    _updateStreaks(dt, active, config, speed) {
        const density = THREE.MathUtils.clamp(Math.round(config.warpDensity), 0, 420);
        const length = THREE.MathUtils.clamp(config.warpLength, 20, 900);
        if (density !== this._lastStreakDensity || length !== this._lastStreakLength) {
            this._writeStreakGeometry(density, length);
        }

        const threshold = Math.max(0, config.warpSpeedThreshold);
        const denominator = Math.max(1, 600 - threshold);
        const speedAlpha = THREE.MathUtils.clamp((speed - threshold) / denominator, 0, 1);
        const comfortClamp = THREE.MathUtils.clamp(config.warpComfortClamp, 0, 1);
        const opacity = active ? config.warpOpacity * speedAlpha * comfortClamp : 0;

        this._travel += dt * Math.max(speed, 1);
        this.streaks.position.z = -80 + (this._travel % 80);
        this.streaks.material.opacity = opacity;
        this.streaks.visible = density > 0 && opacity > 0.001;
    }

    _createOverlay() {
        const material = new THREE.ShaderMaterial({
            transparent: true,
            depthTest: false,
            depthWrite: false,
            uniforms: {
                resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
                time: { value: 0 },
                bloomHazeOpacity: { value: DEFAULTS.bloomHazeOpacity },
                scanlineOpacity: { value: DEFAULTS.scanlineOpacity },
                pixelGridOpacity: { value: DEFAULTS.pixelGridOpacity },
                pixelSize: { value: DEFAULTS.pixelSize },
                noiseOpacity: { value: DEFAULTS.noiseOpacity },
                vignetteOpacity: { value: DEFAULTS.vignetteOpacity },
                halftoneOpacity: { value: DEFAULTS.halftoneOpacity },
                asciiOpacity: { value: DEFAULTS.asciiOpacity }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec2 vUv;
                uniform vec2 resolution;
                uniform float time;
                uniform float bloomHazeOpacity;
                uniform float scanlineOpacity;
                uniform float pixelGridOpacity;
                uniform float pixelSize;
                uniform float noiseOpacity;
                uniform float vignetteOpacity;
                uniform float halftoneOpacity;
                uniform float asciiOpacity;

                float hash(vec2 p) {
                    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
                }

                vec2 rotate(vec2 p, float a) {
                    float c = cos(a);
                    float s = sin(a);
                    return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
                }

                void main() {
                    vec2 safeResolution = max(resolution, vec2(1.0));
                    float cell = max(pixelSize, 1.0);
                    vec2 gridUv = vUv * safeResolution / cell;
                    vec2 local = fract(gridUv);

                    float scan = pow(0.5 + 0.5 * sin(vUv.y * safeResolution.y * 3.1415926), 2.0) * scanlineOpacity;
                    float grid = clamp(step(local.x, 0.035) + step(local.y, 0.035), 0.0, 1.0) * pixelGridOpacity;
                    float noise = (hash(floor(gridUv) + floor(time * 18.0)) - 0.5) * 2.0 * noiseOpacity;

                    vec2 centered = vUv - 0.5;
                    centered.x *= safeResolution.x / safeResolution.y;
                    float vignette = smoothstep(0.25, 0.78, length(centered)) * vignetteOpacity;

                    vec2 halfUv = rotate(vUv - 0.5, 0.785398) * min(safeResolution.x, safeResolution.y) / max(9.0, cell * 3.0);
                    float dotMask = 1.0 - smoothstep(0.2, 0.33, length(fract(halfUv) - 0.5));
                    float halftone = dotMask * halftoneOpacity;

                    vec2 asciiGrid = floor(vUv * vec2(64.0, 36.0));
                    vec2 asciiLocal = fract(vUv * vec2(64.0, 36.0));
                    float glyphSeed = hash(asciiGrid);
                    float horizontal = smoothstep(0.05, 0.0, abs(asciiLocal.y - 0.5 + (glyphSeed - 0.5) * 0.34));
                    float vertical = smoothstep(0.04, 0.0, abs(asciiLocal.x - glyphSeed));
                    float ascii = max(horizontal, vertical) * step(0.54, glyphSeed) * asciiOpacity;

                    float centerGlow = (1.0 - smoothstep(0.0, 0.72, length(centered))) * bloomHazeOpacity;
                    float edgeBloom = smoothstep(0.22, 0.88, length(centered)) * bloomHazeOpacity * 0.45;
                    vec3 bloomColor = vec3(0.18, 0.72, 1.0) * centerGlow + vec3(0.7, 0.16, 0.95) * edgeBloom;

                    float darkAlpha = clamp(scan + grid + max(noise, 0.0) + vignette, 0.0, 0.82);
                    vec3 color = bloomColor + mix(vec3(0.0), vec3(0.35, 0.95, 1.0), clamp(halftone + ascii, 0.0, 1.0));
                    float alpha = clamp(darkAlpha + centerGlow + edgeBloom + halftone * 0.45 + ascii * 0.5, 0.0, 0.88);
                    gl_FragColor = vec4(color, alpha);
                }
            `
        });

        const overlay = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 4.2), material);
        overlay.name = 'XRVisualFxOverlay';
        overlay.position.set(0, 0, -1.0);
        overlay.renderOrder = 9999;
        overlay.visible = false;
        return overlay;
    }

    _createWorldHalos() {
        const specs = [
            { target: this.environment.blackHole.mesh, color: 0xff8050, baseScale: 900, opacity: 0.5, landmarkWeight: 1 },
            { target: this.environment.anomaly.mesh, color: 0x44ffdd, baseScale: 420, opacity: 0.46, landmarkWeight: 1 },
            { target: this.environment.galaxy, color: 0x88ccff, baseScale: 5200, opacity: 0.22, landmarkWeight: 1.2 }
        ];

        return specs.map((spec) => {
            const sprite = this._createHaloSprite(spec.color);
            sprite.name = `${spec.target.name || 'World'}XRHalo`;
            this.scene.add(sprite);
            return { ...spec, sprite };
        });
    }

    _createAnchorHalos() {
        const specs = [
            { anchorName: 'pilotControls', color: 0x66dcff, baseScale: 1.3, opacity: 0.42 },
            { anchorName: 'exitAirlock', color: 0xff9f45, baseScale: 1.5, opacity: 0.38 },
            { anchorName: 'cockpitSeat', color: 0x88ccff, baseScale: 1.0, opacity: 0.24 }
        ];

        const halos = [];
        for (const spec of specs) {
            const anchor = this.ship.getAnchor(spec.anchorName);
            if (!anchor) continue;

            const sprite = this._createHaloSprite(spec.color);
            sprite.name = `${spec.anchorName}XRHalo`;
            sprite.position.set(0, 0.15, 0);
            anchor.add(sprite);
            halos.push({ ...spec, sprite });
        }
        return halos;
    }

    _createHaloSprite(color) {
        const material = new THREE.SpriteMaterial({
            map: this.haloTexture,
            color,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false
        });
        const sprite = new THREE.Sprite(material);
        sprite.visible = false;
        sprite.renderOrder = 2;
        return sprite;
    }

    _createStreaks() {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(420 * 2 * 3), 3));
        geometry.setDrawRange(0, 0);
        const material = new THREE.LineBasicMaterial({
            color: 0xb8ecff,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const lines = new THREE.LineSegments(geometry, material);
        lines.name = 'XRWarpStreaks';
        lines.position.z = -80;
        lines.visible = false;
        return lines;
    }

    _writeStreakGeometry(density, length) {
        const positions = this.streaks.geometry.attributes.position.array;
        const rng = createSeededRandom(8128 + density * 17 + Math.round(length));

        for (let i = 0; i < density; i++) {
            const index = i * 6;
            const x = (rng() - 0.5) * 70;
            const y = (rng() - 0.5) * 38;
            const z = -rng() * 820;
            positions[index] = x;
            positions[index + 1] = y;
            positions[index + 2] = z;
            positions[index + 3] = x;
            positions[index + 4] = y;
            positions[index + 5] = z - length * (0.35 + rng() * 0.9);
        }

        for (let i = density * 6; i < positions.length; i++) positions[i] = 0;

        this.streaks.geometry.setDrawRange(0, density * 2);
        this.streaks.geometry.attributes.position.needsUpdate = true;
        this._lastStreakDensity = density;
        this._lastStreakLength = length;
    }
}

function createRadialTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
    gradient.addColorStop(0.25, 'rgba(255,255,255,0.38)');
    gradient.addColorStop(0.7, 'rgba(255,255,255,0.08)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
}

function createSeededRandom(seed) {
    let value = seed >>> 0;
    return () => {
        value = Math.imul(1664525, value) + 1013904223;
        return ((value >>> 0) / 4294967296);
    };
}
