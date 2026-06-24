import * as THREE from 'three';
import { BlackHole } from './BlackHole.js';
import { SpatialAnomaly } from './SpatialAnomaly.js';

// Gravitational mass per landmark, tuned for this project's scale (attractors a
// few thousand units away, ship cruising at tens-to-hundreds of m/s). These are
// the "physics weight" of each object, intentionally separate from its visual
// size: the black hole is small on screen but heavy; the galaxy is huge but a
// gentle far-field pull. The runtime master gain is GravityField.gravityScale.
const ATTRACTOR_MASS = Object.freeze({
    blackhole: 2.0e7,
    galaxy: 2.4e8
});

export class DeepSpaceEnvironment {
    constructor({ preset, seed }) {
        this.preset = preset;
        this.seed = seed;
        this.group = new THREE.Group();
        this.group.name = 'DeepSpaceEnvironment';
        this.runtimeConfig = {
            starOpacity: 1,
            starBrightness: 2.4,
            starSize: 8,
            nebulaOpacity: 0.72,
            nebulaBrightness: 2.1,
            nebulaScale: 1.18
        };

        this._rng = createSeededRandom(seed);
        this.stars = this._createStars();
        this.galaxy = this._createLandmarkGalaxy();
        this.nebula = this._createNebula();
        this.blackHole = this._createBlackHole();
        this.anomaly = this._createAnomaly();
        this.baseVisualGlow = {
            blackHoleBloom: this.blackHole.bloomIntensity,
            anomalyBloom: this.anomaly.params.bloomIntensity,
            galaxyOpacity: this.galaxy.material.opacity,
            galaxySize: this.galaxy.material.size
        };

        this.group.add(this.stars, this.galaxy, this.nebula, this.blackHole.mesh, this.anomaly.mesh);
    }

    update(shipPosition, dt) {
        this.galaxy.rotation.z += dt * 0.01;
        this.nebula.rotation.y += dt * 0.003;
        this.stars.material.uniforms.time.value += dt;
        this.blackHole.update(dt);
        this.anomaly.update(dt);
    }

    /**
     * World-space attractors for the GravityField. Decoupled from the meshes:
     * we hand out positions + masses, not object references, so physics never
     * reaches into the render graph. The environment group sits at the origin,
     * so these local positions are also world positions.
     */
    getAttractors() {
        return [
            {
                type: 'blackhole',
                name: 'Black hole',
                position: new THREE.Vector3(
                    this.preset.blackHolePosition.x,
                    this.preset.blackHolePosition.y,
                    this.preset.blackHolePosition.z
                ),
                mass: ATTRACTOR_MASS.blackhole
            },
            {
                type: 'galaxy',
                name: 'Landmark galaxy',
                position: new THREE.Vector3(
                    this.preset.landmarkGalaxyPosition.x,
                    this.preset.landmarkGalaxyPosition.y,
                    this.preset.landmarkGalaxyPosition.z
                ),
                mass: ATTRACTOR_MASS.galaxy
            }
        ];
    }

    setRuntimeConfig(config) {
        this.runtimeConfig = { ...this.runtimeConfig, ...config };
        this.stars.material.uniforms.opacity.value = this.runtimeConfig.starOpacity;
        this.stars.material.uniforms.brightness.value = this.runtimeConfig.starBrightness;
        this.stars.material.uniforms.size.value = this.runtimeConfig.starSize;
        this.nebula.material.uniforms.opacity.value = this.runtimeConfig.nebulaOpacity;
        this.nebula.material.uniforms.brightness.value = this.runtimeConfig.nebulaBrightness;
        this.nebula.material.uniforms.scale.value = this.runtimeConfig.nebulaScale;
    }

    setVisualGlow({ sceneGlow = 1, landmarkGlow = 1 } = {}) {
        const scene = Math.max(0, sceneGlow);
        const landmark = Math.max(0, landmarkGlow);
        const landmarkBoost = scene * landmark;

        this.blackHole.bloomIntensity = this.baseVisualGlow.blackHoleBloom * landmarkBoost;
        this.anomaly.params.bloomIntensity = this.baseVisualGlow.anomalyBloom * landmarkBoost;
        this.anomaly.mesh.material.uniforms.uBloomIntensity.value = this.anomaly.params.bloomIntensity;

        this.galaxy.material.opacity = THREE.MathUtils.clamp(
            this.baseVisualGlow.galaxyOpacity * (0.75 + landmarkBoost * 0.25),
            0,
            1
        );
        this.galaxy.material.size = this.baseVisualGlow.galaxySize * (0.85 + landmarkBoost * 0.15);
    }

    _createStars() {
        const positions = new Float32Array(this.preset.starCount * 3);
        const colors = new Float32Array(this.preset.starCount * 3);
        const palette = [
            new THREE.Color(0xffffff),
            new THREE.Color(0xaaccff),
            new THREE.Color(0xfff0c0),
            new THREE.Color(0xffb080)
        ];

        for (let i = 0; i < this.preset.starCount; i++) {
            const index = i * 3;
            positions[index] = (this._rng() - 0.5) * this.preset.universeSize;
            positions[index + 1] = (this._rng() - 0.5) * this.preset.universeSize;
            positions[index + 2] = -this._rng() * this.preset.universeSize;

            const color = palette[Math.floor(this._rng() * palette.length)];
            colors[index] = color.r;
            colors[index + 1] = color.g;
            colors[index + 2] = color.b;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                opacity: { value: this.runtimeConfig.starOpacity },
                brightness: { value: this.runtimeConfig.starBrightness },
                size: { value: this.runtimeConfig.starSize }
            },
            vertexShader: `
                varying vec3 vColor;
                varying float vAlpha;
                uniform float time;
                uniform float size;
                uniform float brightness;

                void main() {
                    vColor = color * brightness;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    float twinkle = 0.78 + 0.22 * sin(time * 2.0 + position.x * 0.013 + position.z * 0.007);
                    float fade = 1.0 - smoothstep(10000.0, 28000.0, length(mvPosition.xyz));
                    vAlpha = twinkle * fade;
                    gl_PointSize = size * (320.0 / max(-mvPosition.z, 1.0));
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vAlpha;
                uniform float opacity;

                void main() {
                    vec2 uv = gl_PointCoord - 0.5;
                    float falloff = smoothstep(0.5, 0.0, length(uv));
                    gl_FragColor = vec4(vColor, falloff * vAlpha * opacity);
                }
            `,
            vertexColors: true,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const stars = new THREE.Points(geometry, material);
        stars.name = 'StarVolume';
        return stars;
    }

    _createLandmarkGalaxy() {
        const positions = new Float32Array(this.preset.galaxyParticleCount * 3);
        const colors = new Float32Array(this.preset.galaxyParticleCount * 3);
        const inside = new THREE.Color(0x88ccff);
        const outside = new THREE.Color(0xff44cc);

        for (let i = 0; i < this.preset.galaxyParticleCount; i++) {
            const index = i * 3;
            const radius = Math.pow(this._rng(), 0.55) * 3800;
            const arm = Math.floor(this._rng() * 5);
            const angle = radius * 0.0024 + arm * Math.PI * 0.4;
            const scatter = (1 - radius / 3800) * 180 + 40;

            positions[index] = Math.cos(angle) * radius + (this._rng() - 0.5) * scatter;
            positions[index + 1] = (this._rng() - 0.5) * 360;
            positions[index + 2] = Math.sin(angle) * radius + (this._rng() - 0.5) * scatter;

            const color = inside.clone().lerp(outside, radius / 3800);
            colors[index] = color.r;
            colors[index + 1] = color.g;
            colors[index + 2] = color.b;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const galaxy = new THREE.Points(
            geometry,
            new THREE.PointsMaterial({
                size: 24,
                vertexColors: true,
                transparent: true,
                opacity: 0.82,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            })
        );

        galaxy.position.set(
            this.preset.landmarkGalaxyPosition.x,
            this.preset.landmarkGalaxyPosition.y,
            this.preset.landmarkGalaxyPosition.z
        );
        galaxy.rotation.x = -0.2;
        return galaxy;
    }

    _createNebula() {
        const positions = new Float32Array(this.preset.nebulaParticleCount * 3);
        const colors = new Float32Array(this.preset.nebulaParticleCount * 3);
        const sizes = new Float32Array(this.preset.nebulaParticleCount);
        const seeds = new Float32Array(this.preset.nebulaParticleCount);
        const primary = new THREE.Color(0x4c1d95);
        const secondary = new THREE.Color(0x22d3ee);

        for (let i = 0; i < this.preset.nebulaParticleCount; i++) {
            const index = i * 3;
            const radius = 8000 + this._rng() * 18000;
            const theta = this._rng() * Math.PI * 2;
            const phi = Math.acos(2 * this._rng() - 1);
            positions[index] = Math.sin(phi) * Math.cos(theta) * radius;
            positions[index + 1] = Math.cos(phi) * radius * 0.35;
            positions[index + 2] = -12000 + Math.sin(phi) * Math.sin(theta) * radius;

            const color = primary.clone().lerp(secondary, this._rng());
            colors[index] = color.r * 0.35;
            colors[index + 1] = color.g * 0.35;
            colors[index + 2] = color.b * 0.35;
            sizes[i] = 1800 + this._rng() * 3600;
            seeds[i] = this._rng() * 1000;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('particleSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                opacity: { value: this.runtimeConfig.nebulaOpacity },
                brightness: { value: this.runtimeConfig.nebulaBrightness },
                scale: { value: this.runtimeConfig.nebulaScale }
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
                varying vec3 vColor;
                varying float vSeed;

                float hash(vec2 p) {
                    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
                }

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
                    float softMask = 1.0 - smoothstep(0.18, 1.0, radius);
                    float rimBreakup = smoothstep(1.0, 0.45, radius + fbm(uv * 2.2 + vSeed) * 0.28);
                    float cloud = fbm(uv * 3.5 + vec2(vSeed, vSeed * 0.37));
                    float core = smoothstep(0.08, 0.85, cloud) * softMask;
                    float alpha = (core * 0.72 + rimBreakup * 0.28) * opacity * 0.18;

                    if (alpha < 0.003) discard;

                    vec3 color = vColor * brightness * (0.55 + cloud * 0.65);
                    gl_FragColor = vec4(color, alpha);
                }
            `,
            vertexColors: true,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const nebula = new THREE.Points(geometry, material);
        nebula.name = 'VolumetricNebula';
        return nebula;
    }

    _createBlackHole() {
        const blackHole = new BlackHole({
            scale: 115,
            distortion: 0.18,
            diskRadius: 6,
            bloomIntensity: 1.6,
            colorInner: '#ffc880',
            colorOuter: '#ff5050'
        });
        blackHole.mesh.position.set(
            this.preset.blackHolePosition.x,
            this.preset.blackHolePosition.y,
            this.preset.blackHolePosition.z
        );
        return blackHole;
    }

    _createAnomaly() {
        const anomaly = new SpatialAnomaly({
            radius: 170,
            color: 0x44ffdd,
            bloomIntensity: 2.2,
            speed: 0.9,
            maxDistortion: 0.7
        });
        anomaly.mesh.position.set(
            this.preset.anomalyPosition.x,
            this.preset.anomalyPosition.y,
            this.preset.anomalyPosition.z
        );
        return anomaly;
    }
}

function createSeededRandom(seedText) {
    let seed = 2166136261;
    for (let i = 0; i < seedText.length; i++) {
        seed ^= seedText.charCodeAt(i);
        seed = Math.imul(seed, 16777619);
    }

    return () => {
        seed += 0x6d2b79f5;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
