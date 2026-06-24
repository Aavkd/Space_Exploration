import * as THREE from 'three';
import { gaussian, randomRange, weightedChoice } from './rng.js';
import { randomPointInSphere } from './CosmicWeb.js';

const STAR_PALETTE = [
    { color: '#ffb080', weight: 0.34 },
    { color: '#fff0c0', weight: 0.38 },
    { color: '#ffffff', weight: 0.2 },
    { color: '#aaccff', weight: 0.08 }
];

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

            const entry = weightedChoice(this.rng, this._temperatureWeights());
            color.set(entry.color);
            const lift = 1 + this.config.stars.saturation * 0.12;
            colors[index] = Math.min(1, color.r * lift);
            colors[index + 1] = Math.min(1, color.g * lift);
            colors[index + 2] = Math.min(1, color.b * lift);

            seeds[i] = this.rng() * 1000;
            brightnesses[i] = Math.pow(this.rng(), 2.3) * 1.7 + 0.28;

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
                regionRadius: { value: this.config.global.regionRadius }
            },
            vertexShader: `
                attribute float seed;
                attribute float brightnessSeed;
                varying vec3 vColor;
                varying float vAlpha;
                uniform float time;
                uniform float size;
                uniform float brightness;
                uniform float saturation;
                uniform float regionRadius;

                void main() {
                    vec3 saturated = mix(vec3(dot(color, vec3(0.299, 0.587, 0.114))), color, saturation);
                    vColor = saturated * brightness * brightnessSeed;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    float twinkle = 0.78 + 0.22 * sin(time * (1.5 + seed * 0.003) + seed);
                    float borderFade = 1.0 - smoothstep(regionRadius * 0.86, regionRadius, length(position));
                    vAlpha = twinkle * max(borderFade, 0.18);
                    gl_PointSize = size * (260.0 / max(-mvPosition.z, 1.0)) * (0.75 + brightnessSeed * 0.45);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vAlpha;
                uniform float opacity;

                void main() {
                    vec2 uv = gl_PointCoord - 0.5;
                    float dist = length(uv);
                    float core = smoothstep(0.18, 0.0, dist);
                    float halo = smoothstep(0.5, 0.0, dist) * 0.35;
                    float alpha = (core + halo) * vAlpha * opacity;
                    if (alpha < 0.002) discard;
                    gl_FragColor = vec4(vColor, alpha);
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

    _temperatureWeights() {
        const bias = THREE.MathUtils.clamp(this.config.stars.temperatureBias, 0, 1);
        return STAR_PALETTE.map((entry, index) => {
            const cool = index <= 1 ? bias : 1 - bias;
            return { value: entry, weight: entry.weight * (0.45 + cool) };
        });
    }
}
