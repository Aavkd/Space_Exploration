import * as THREE from 'three';
import { gaussian, randomRange } from './rng.js';
import { randomPointInSphere } from './CosmicWeb.js';
import { blackbody, sampleStarTemperature, sampleLuminosity } from './starColor.js';

export class StarField {
    constructor({ rng, web, config }) {
        this.rng = rng;
        this.web = web;
        this.config = config;
        this.group = new THREE.Group();
        this.group.name = 'UniverseStars';
        this.layers = {};
        this.heroLights = [];
        this._create();
        this.setRuntimeConfig(config.stars);
    }

    update(dt, cameraPosition) {
        for (const layer of Object.values(this.layers)) {
            layer.material.uniforms.time.value += dt * this.config.stars.twinkleSpeed;
        }
        if (this.layers.background) this.layers.background.position.copy(cameraPosition);
    }

    setRuntimeConfig(stars) {
        this.config.stars = { ...this.config.stars, ...stars };
        for (const [name, layer] of Object.entries(this.layers)) {
            const scale = name === 'background' ? 0.65 : name === 'mid' ? 0.85 : 1;
            layer.material.uniforms.opacity.value = this.config.stars.opacity;
            layer.material.uniforms.brightness.value = this.config.stars.brightness * scale;
            layer.material.uniforms.size.value = this.config.stars.size * (name === 'near' ? 1.15 : 1);
            layer.material.uniforms.saturation.value = this.config.stars.saturation;
            layer.material.uniforms.bloom.value = this.config.stars.bloom ?? 1;
            layer.material.uniforms.regionRadius.value = this.config.global.regionRadius;
        }
    }

    getCounts() {
        return {
            stars: Object.values(this.layers).reduce((sum, layer) => sum + layer.geometry.attributes.position.count, 0)
        };
    }

    _create() {
        if (!this.config.stars.enabled) return;
        this.layers.near = this._createLayer('near', this.config.stars.nearCount, 80000, true);
        this.layers.mid = this._createLayer('mid', this.config.stars.midCount, this.config.global.regionRadius * 0.82, true);
        this.layers.background = this._createLayer('background', this.config.stars.bgCount, 420000, false);
        this.group.add(...Object.values(this.layers));
    }

    _createLayer(name, count, radius, webBiased) {
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const seeds = new Float32Array(count);
        const brightnesses = new Float32Array(count);
        const color = new THREE.Color();

        for (let i = 0; i < count; i++) {
            const index = i * 3;
            const position = webBiased
                ? this._webStarPosition(name, radius)
                : randomPointInSphere(this.rng, radius).setLength(randomRange(this.rng, radius * 0.72, radius));

            positions[index] = position.x;
            positions[index + 1] = position.y;
            positions[index + 2] = position.z;

            // Temperature drives both hue (blackbody ramp) and luminosity, so
            // the two stay correlated: hot stars are rare, blue-white, and bright.
            const tempK = sampleStarTemperature(this.rng, this.config.stars.temperatureBias);
            blackbody(tempK, color);
            const lift = 1 + this.config.stars.saturation * 0.12;
            colors[index] = Math.min(1, color.r * lift);
            colors[index + 1] = Math.min(1, color.g * lift);
            colors[index + 2] = Math.min(1, color.b * lift);

            seeds[i] = this.rng() * 1000;
            brightnesses[i] = sampleLuminosity(this.rng, tempK);

            if (name === 'near' && this.heroLights.length < 36 && brightnesses[i] > 1.1) {
                this.heroLights.push({
                    type: 'star',
                    name: `Hero star ${this.heroLights.length + 1}`,
                    position: position.clone(),
                    color: color.clone(),
                    intensity: brightnesses[i],
                    mass: 1.0e6,
                    isHeroLight: true
                });
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
        geometry.setAttribute('brightnessSeed', new THREE.BufferAttribute(brightnesses, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                opacity: { value: this.config.stars.opacity },
                brightness: { value: this.config.stars.brightness },
                size: { value: this.config.stars.size },
                saturation: { value: this.config.stars.saturation },
                bloom: { value: this.config.stars.bloom ?? 1 },
                regionRadius: { value: this.config.global.regionRadius }
            },
            vertexShader: `
                attribute float seed;
                attribute float brightnessSeed;
                varying vec3 vColor;
                varying float vAlpha;
                varying float vSpike;
                uniform float time;
                uniform float size;
                uniform float brightness;
                uniform float saturation;
                uniform float regionRadius;

                void main() {
                    vec3 saturated = mix(vec3(dot(color, vec3(0.299, 0.587, 0.114))), color, saturation);
                    vColor = saturated * brightness * brightnessSeed;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    float dist = max(-mvPosition.z, 1.0);

                    float twinkle = 0.72 + 0.28 * sin(time * (1.5 + seed * 0.003) + seed);
                    float borderFade = 1.0 - smoothstep(regionRadius * 0.86, regionRadius, length(position));
                    vAlpha = twinkle * max(borderFade, 0.2);
                    // Only the brightest stars grow diffraction glints.
                    vSpike = smoothstep(0.95, 1.8, brightnessSeed);

                    // Perspective attenuation calibrated to the region scale (~10^5
                    // units) instead of the old fixed 260.0 (which assumed a ~10^3
                    // scene and collapsed every layer to sub-pixel). The clamp keeps a
                    // visible pixel floor so the distant mid/background layers actually
                    // render, and a ceiling so close stars don't balloon.
                    float sizeScale = regionRadius * 0.02;
                    float px = size * (sizeScale / dist) * (0.5 + brightnessSeed * 0.7);
                    gl_PointSize = clamp(px, 1.8, 30.0);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vAlpha;
                varying float vSpike;
                uniform float opacity;
                uniform float bloom;

                void main() {
                    vec2 uv = gl_PointCoord - 0.5;
                    float d = length(uv);

                    // Tight core punched into HDR so the bloom pass catches it, wrapped
                    // in a soft halo for the glow.
                    float core = pow(smoothstep(0.5, 0.0, d), 2.4);
                    float halo = smoothstep(0.5, 0.05, d) * 0.4;

                    // Vertical + horizontal diffraction glints on the brightest stars so
                    // they read as shining rather than as flat dots.
                    vec2 a = abs(uv);
                    float spikeH = smoothstep(0.5, 0.0, a.y) * smoothstep(0.5, 0.0, a.x * 7.0);
                    float spikeV = smoothstep(0.5, 0.0, a.x) * smoothstep(0.5, 0.0, a.y * 7.0);
                    float spike = max(spikeH, spikeV) * vSpike;

                    float mask = core + halo + spike * 0.5;
                    float alpha = mask * vAlpha * opacity;
                    if (alpha < 0.003) discard;

                    // bloom scales how hard the core overshoots into HDR, which is
                    // what the global bloom pass picks up - higher = more glow spill.
                    vec3 col = vColor * (1.0 + core * 1.8 * bloom);
                    gl_FragColor = vec4(col, alpha);
                }
            `,
            vertexColors: true,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const points = new THREE.Points(geometry, material);
        points.name = `StarLayer:${name}`;
        points.frustumCulled = false;
        return points;
    }

    _webStarPosition(name, radius) {
        const sampled = this.web.sample(this.rng, {
            nodeBias: name === 'near' ? 0.82 : 0.58,
            filamentBias: name === 'near' ? 0.12 : 0.36,
            voidScatter: name === 'near' ? 0.03 : this.config.global.voidScatter,
            spread: name === 'near' ? 0.36 : 0.8
        });
        if (name === 'near') return sampled.position.clampLength(2000, radius);
        if (sampled.position.length() < 90000) sampled.position.add(new THREE.Vector3(gaussian(this.rng), gaussian(this.rng), gaussian(this.rng)).multiplyScalar(90000));
        return sampled.position.clampLength(20000, radius);
    }
}
