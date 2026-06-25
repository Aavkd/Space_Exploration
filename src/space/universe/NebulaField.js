import * as THREE from 'three';
import { gaussian, randomRange } from './rng.js';

const PALETTES = [
    ['#ff5a70', '#7fd6ff'],
    ['#31ffd7', '#6a5cff'],
    ['#ff9d4d', '#d44dff'],
    ['#77aaff', '#ffffff']
];

export class NebulaField {
    constructor({ rng, web, config }) {
        this.rng = rng;
        this.web = web;
        this.config = config;
        this.group = new THREE.Group();
        this.group.name = 'UniverseNebulae';
        this.nebulae = [];
        this.clusters = [];
        this.dust = null;
        this._create();
        this.setRuntimeConfig(config.nebulae);
    }

    update(dt) {
        for (const nebula of this.nebulae) {
            nebula.rotation.y += dt * 0.002 * this.config.nebulae.driftSpeed;
            nebula.rotation.x += dt * 0.0007 * this.config.nebulae.driftSpeed;
        }
        for (const cluster of this.clusters) cluster.rotation.y += dt * 0.004 * this.config.nebulae.driftSpeed;
        if (this.dust) this.dust.material.uniforms.time.value += dt * this.config.nebulae.driftSpeed;
    }

    setRuntimeConfig(nebulae) {
        this.config.nebulae = { ...this.config.nebulae, ...nebulae };
        const bloom = this.config.nebulae.bloom ?? 1;
        for (const nebula of this.nebulae) {
            nebula.material.uniforms.opacity.value = this.config.nebulae.opacity;
            nebula.material.uniforms.brightness.value = this.config.nebulae.brightness;
            nebula.material.uniforms.scale.value = this.config.nebulae.scale;
            nebula.material.uniforms.bloom.value = bloom;
        }
        for (const cluster of this.clusters) {
            cluster.material.opacity = Math.min(1, this.config.nebulae.opacity * 0.95);
            cluster.material.size = 18 * this.config.nebulae.scale;
            // Extra emissive push on the per-vertex cluster colours so they bloom.
            cluster.material.color.setScalar(bloom);
        }
        if (this.dust) {
            this.dust.material.uniforms.opacity.value = this.config.nebulae.opacity * 0.28;
            this.dust.material.uniforms.brightness.value = this.config.nebulae.brightness;
        }
    }

    getPOIs() {
        return [
            ...this.nebulae.map((nebula, index) => ({
                type: 'nebula',
                name: `Nebula ${index + 1}`,
                position: nebula.position,
                radius: nebula.userData.radius,
                density: nebula.userData.density
            })),
            ...this.clusters.map((cluster, index) => ({
                type: 'cluster',
                name: `Star cluster ${index + 1}`,
                position: cluster.position,
                radius: cluster.userData.radius,
                density: cluster.userData.density
            }))
        ];
    }

    _create() {
        if (!this.config.nebulae.enabled) return;
        for (let i = 0; i < this.config.nebulae.nebulaCount; i++) {
            const sample = i === 0
                ? this.web.sample(this.rng, { nodeBias: 1, filamentBias: 0, voidScatter: 0, spread: 0.16, densityAttempts: 6, densityPower: 1.55 })
                : this.web.sample(this.rng, { nodeBias: 0.7, filamentBias: 0.2, voidScatter: 0.05, spread: 0.52, densityAttempts: 5, densityPower: 1.4 });
            const densityScale = fieldScale(sample.field, 0.72, 1.38);
            const nebula = this._createNebula(sample.position, randomRange(this.rng, 15000, 60000) * densityScale, i, sample.field);
            this.nebulae.push(nebula);
            this.group.add(nebula);
        }

        for (let i = 0; i < this.config.nebulae.clusterCount; i++) {
            const sample = this.web.sample(this.rng, { nodeBias: 0.78, filamentBias: 0.16, voidScatter: 0.04, spread: 0.35, densityAttempts: 5, densityPower: 1.45 });
            const densityScale = fieldScale(sample.field, 0.7, 1.32);
            const cluster = this._createCluster(sample.position, randomRange(this.rng, 1400, 8000) * densityScale, i, sample.field);
            this.clusters.push(cluster);
            this.group.add(cluster);
        }

        if (this.config.nebulae.dust) {
            this.dust = this._createDust();
            this.group.add(this.dust);
        }
    }

    _createNebula(position, radius, index, field) {
        const densityScale = fieldScale(field, 0.85, 1.25);
        const count = Math.floor(THREE.MathUtils.clamp(radius / 35 * densityScale, 520, 1900));
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const seeds = new Float32Array(count);
        const [a, b] = PALETTES[index % PALETTES.length].map((value) => new THREE.Color(value));
        const color = new THREE.Color();

        for (let i = 0; i < count; i++) {
            const p = new THREE.Vector3(gaussian(this.rng) * radius * 0.32, gaussian(this.rng) * radius * 0.16, gaussian(this.rng) * radius * 0.32);
            const item = i * 3;
            positions[item] = p.x;
            positions[item + 1] = p.y;
            positions[item + 2] = p.z;
            color.copy(a).lerp(b, this.rng());
            colors[item] = color.r * 0.45;
            colors[item + 1] = color.g * 0.45;
            colors[item + 2] = color.b * 0.45;
            sizes[i] = randomRange(this.rng, radius * 0.11, radius * 0.26);
            seeds[i] = this.rng() * 1000;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('particleSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));

        const material = createNebulaMaterial(this.config.nebulae);
        const nebula = new THREE.Points(geometry, material);
        nebula.position.copy(position);
        nebula.name = 'ProceduralNebula';
        nebula.userData.radius = radius;
        nebula.userData.density = field?.density ?? 0;
        return nebula;
    }

    _createCluster(position, radius, index, field) {
        const count = Math.floor(randomRange(this.rng, 160, 620) * fieldScale(field, 0.82, 1.28));
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const cool = new THREE.Color(index % 2 ? '#fff0c0' : '#aaccff');
        const hot = new THREE.Color('#ffffff');
        const color = new THREE.Color();

        for (let i = 0; i < count; i++) {
            const p = new THREE.Vector3(gaussian(this.rng), gaussian(this.rng), gaussian(this.rng)).multiplyScalar(radius * 0.26);
            const item = i * 3;
            positions[item] = p.x;
            positions[item + 1] = p.y;
            positions[item + 2] = p.z;
            color.copy(cool).lerp(hot, this.rng() * 0.6);
            colors[item] = color.r;
            colors[item + 1] = color.g;
            colors[item + 2] = color.b;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const cluster = new THREE.Points(geometry, new THREE.PointsMaterial({
            size: 18,
            vertexColors: true,
            transparent: true,
            opacity: this.config.nebulae.opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        }));
        cluster.position.copy(position);
        cluster.name = 'StarCluster';
        cluster.userData.radius = radius;
        cluster.userData.density = field?.density ?? 0;
        return cluster;
    }

    _createDust() {
        const pointsPerFilament = 260;
        const count = this.web.filaments.length * pointsPerFilament;
        const positions = new Float32Array(count * 3);
        const seeds = new Float32Array(count);
        let cursor = 0;

        for (const filament of this.web.filaments) {
            for (let i = 0; i < pointsPerFilament; i++) {
                const t = this.rng();
                const p = filament.a.position.clone().lerp(filament.b.position, t);
                const thickness = Math.min(filament.a.radius, filament.b.radius) * 0.22 * this.config.global.filamentStrength;
                p.add(new THREE.Vector3(gaussian(this.rng), gaussian(this.rng), gaussian(this.rng)).multiplyScalar(thickness));
                positions[cursor * 3] = p.x;
                positions[cursor * 3 + 1] = p.y;
                positions[cursor * 3 + 2] = p.z;
                seeds[cursor] = this.rng() * 1000;
                cursor++;
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
        return new THREE.Points(geometry, new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                opacity: { value: this.config.nebulae.opacity * 0.28 },
                brightness: { value: this.config.nebulae.brightness }
            },
            vertexShader: `
                attribute float seed;
                varying float vSeed;
                uniform float time;
                void main() {
                    vSeed = seed;
                    vec3 p = position;
                    p.y += sin(time * 0.1 + seed) * 120.0;
                    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
                    gl_PointSize = 900.0 / max(-mvPosition.z, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying float vSeed;
                uniform float opacity;
                uniform float brightness;
                void main() {
                    float d = length(gl_PointCoord - 0.5);
                    float alpha = smoothstep(0.5, 0.0, d) * opacity * (0.45 + fract(sin(vSeed) * 43758.5) * 0.55);
                    gl_FragColor = vec4(vec3(0.18, 0.24, 0.32) * brightness, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        }));
    }
}

function fieldScale(field, min, max) {
    const density = field?.density ?? 0.6;
    const t = THREE.MathUtils.clamp((density - 0.15) / 1.75, 0, 1);
    return THREE.MathUtils.lerp(min, max, t);
}

function createNebulaMaterial(config) {
    return new THREE.ShaderMaterial({
        uniforms: {
            opacity: { value: config.opacity },
            brightness: { value: config.brightness },
            scale: { value: config.scale },
            bloom: { value: config.bloom ?? 1 }
        },
        vertexShader: `
            attribute float particleSize;
            attribute float seed;
            varying vec3 vColor;
            varying float vSeed;
            uniform float scale;
            void main() {
                vColor = color;
                vSeed = seed;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = particleSize * scale * (520.0 / max(-mvPosition.z, 1.0));
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform float opacity;
            uniform float brightness;
            uniform float bloom;
            varying vec3 vColor;
            varying float vSeed;
            float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float noise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                float a = hash(i + vSeed);
                float b = hash(i + vec2(1.0, 0.0) + vSeed);
                float c = hash(i + vec2(0.0, 1.0) + vSeed);
                float d = hash(i + vec2(1.0, 1.0) + vSeed);
                return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
            }
            float fbm(vec2 p) {
                float value = 0.0;
                float amp = 0.5;
                for (int i = 0; i < 4; i++) {
                    value += noise(p) * amp;
                    p *= 2.03;
                    amp *= 0.5;
                }
                return value;
            }
            void main() {
                vec2 uv = gl_PointCoord * 2.0 - 1.0;
                float radius = length(uv);
                float cloud = fbm(uv * 3.4 + vec2(vSeed, vSeed * 0.37));
                float alpha = (smoothstep(0.16, 0.9, cloud) * (1.0 - smoothstep(0.35, 1.0, radius))) * opacity * 0.2;
                if (alpha < 0.003) discard;
                gl_FragColor = vec4(vColor * brightness * bloom * (0.65 + cloud * 0.75), alpha);
            }
        `,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
}
