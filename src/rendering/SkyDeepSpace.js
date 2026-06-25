import * as THREE from 'three';
import { DEEP_SPACE_PRESET } from '../config/deepSpacePreset.js';

// Temperature palette for the static backdrop, weighted toward cool/white so the
// deep field reads blue-white with a few warm stragglers.
const SKY_STAR_PALETTE = [
    { color: '#fff6e8', weight: 0.30 },
    { color: '#ffffff', weight: 0.34 },
    { color: '#cfe2ff', weight: 0.24 },
    { color: '#ffd9b0', weight: 0.12 }
];

const SKY_STAR_COUNT = 4800;

export class SkyDeepSpace {
    constructor(scene) {
        this.scene = scene;
        this._time = 0;
        this.skyDome = this._createSkyDome();
        // A dense, always-present field of distant stars parented to the dome, so
        // the backdrop is never pure black even where the procedural star layers
        // thin out. It rides the camera with the dome (so the stars sit "at
        // infinity") and uses its own fog-free additive shader so the scene fog
        // can't crush it the way it does the procedural layers.
        this.starfield = this._createStarfield();
        this.skyDome.add(this.starfield);

        this.scene.add(this.skyDome);
    }

    update(deltaTime, cameraPosition) {
        this.skyDome.position.copy(cameraPosition);
        this._time += deltaTime;
        this.starfield.material.uniforms.time.value = this._time;
    }

    _createSkyDome() {
        return new THREE.Mesh(
            new THREE.SphereGeometry(DEEP_SPACE_PRESET.skyRadius, 32, 32),
            new THREE.ShaderMaterial({
                uniforms: {
                    topColor: { value: new THREE.Color(0x000000) },
                    bottomColor: { value: new THREE.Color(0x000005) },
                    exponent: { value: 0.6 }
                },
                vertexShader: `
                    varying vec3 vWorldPosition;
                    void main() {
                        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                        vWorldPosition = worldPosition.xyz;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform vec3 topColor;
                    uniform vec3 bottomColor;
                    uniform float exponent;
                    varying vec3 vWorldPosition;
                    void main() {
                        float h = normalize(vWorldPosition + vec3(0.0, 2000.0, 0.0)).y;
                        vec3 color = mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0));
                        gl_FragColor = vec4(color, 1.0);
                    }
                `,
                side: THREE.BackSide,
                depthWrite: false
            })
        );
    }

    _createStarfield() {
        const radius = DEEP_SPACE_PRESET.skyRadius * 0.85;
        const rng = mulberry32(0x5eed1a3);
        const count = SKY_STAR_COUNT;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const seeds = new Float32Array(count);
        const brightnesses = new Float32Array(count);
        const color = new THREE.Color();
        const weightTotal = SKY_STAR_PALETTE.reduce((sum, entry) => sum + entry.weight, 0);

        for (let i = 0; i < count; i++) {
            const index = i * 3;
            // Even distribution on the dome sphere.
            const u = rng();
            const v = rng();
            const theta = u * Math.PI * 2;
            const phi = Math.acos(2 * v - 1);
            positions[index] = Math.sin(phi) * Math.cos(theta) * radius;
            positions[index + 1] = Math.cos(phi) * radius;
            positions[index + 2] = Math.sin(phi) * Math.sin(theta) * radius;

            color.set(pickPaletteColor(rng, weightTotal));
            // Bake per-star intensity into the colour so the brightest cores reach
            // HDR and bloom; most stars stay as faint backdrop fill.
            const bright = Math.pow(rng(), 1.8) * 1.6;
            const intensity = 0.45 + bright * 0.9;
            colors[index] = color.r * intensity;
            colors[index + 1] = color.g * intensity;
            colors[index + 2] = color.b * intensity;

            seeds[i] = rng() * 1000;
            brightnesses[i] = bright;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
        geometry.setAttribute('bs', new THREE.BufferAttribute(brightnesses, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                uPixelScale: { value: radius * 1.4 }
            },
            vertexShader: `
                attribute float seed;
                attribute float bs;
                varying vec3 vColor;
                varying float vTw;
                uniform float time;
                uniform float uPixelScale;
                void main() {
                    vColor = color;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    float dist = max(-mvPosition.z, 1.0);
                    vTw = 0.6 + 0.4 * sin(time * (0.6 + seed * 0.0007) + seed);
                    float px = (uPixelScale / dist) * (0.5 + bs);
                    gl_PointSize = clamp(px, 1.0, 3.6);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying float vTw;
                void main() {
                    float d = length(gl_PointCoord - 0.5);
                    float core = pow(smoothstep(0.5, 0.0, d), 2.2);
                    float halo = smoothstep(0.5, 0.08, d) * 0.3;
                    float alpha = (core + halo) * vTw;
                    if (alpha < 0.003) discard;
                    gl_FragColor = vec4(vColor * (1.0 + core * 1.2), alpha);
                }
            `,
            vertexColors: true,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        const points = new THREE.Points(geometry, material);
        points.name = 'SkyBackdropStars';
        points.frustumCulled = false;
        return points;
    }
}

function pickPaletteColor(rng, weightTotal) {
    let roll = rng() * weightTotal;
    for (const entry of SKY_STAR_PALETTE) {
        roll -= entry.weight;
        if (roll <= 0) return entry.color;
    }
    return SKY_STAR_PALETTE[SKY_STAR_PALETTE.length - 1].color;
}

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
