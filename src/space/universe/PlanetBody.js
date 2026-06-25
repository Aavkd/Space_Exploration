import * as THREE from 'three';

const TERRESTRIAL = [
    ['#406080', '#8fb37a', '#d8c38a'],
    ['#8c6d58', '#c7a87b', '#4d3c36'],
    ['#254b6e', '#d7e6ef', '#5c9a66']
];

const GAS = [
    ['#d8b37d', '#8d5f43', '#f3dcac'],
    ['#a7b7d8', '#536a9f', '#efe6d0'],
    ['#d6c9a8', '#6f8f96', '#f5e4b8']
];

export class PlanetBody {
    constructor({
        name = 'Planet',
        kind = 'terrestrial',
        radius = 1200,
        orbitRadius = 22000,
        orbitSpeed = 0.018,
        spinSpeed = 0.1,
        phase = 0,
        palette = TERRESTRIAL[0],
        hasRings = false
    } = {}) {
        this.name = name;
        this.kind = kind;
        this.radius = radius;
        this.orbitRadius = orbitRadius;
        this.orbitSpeed = orbitSpeed;
        this.spinSpeed = spinSpeed;
        this.phase = phase;
        this.hasRings = hasRings;
        this.pivot = new THREE.Group();
        this.pivot.name = `Orbit:${name}`;
        this.body = new THREE.Group();
        this.body.name = `PlanetBody:${name}`;
        this.body.position.set(orbitRadius, 0, 0);

        this.mesh = this._createMesh(palette);
        this.body.add(this.mesh);
        if (kind === 'terrestrial') this.body.add(this._createClouds());
        if (hasRings) this.body.add(this._createRings(palette));

        this.pivot.rotation.y = phase;
        this.pivot.add(this.body);
    }

    update(dt) {
        this.pivot.rotation.y += dt * this.orbitSpeed;
        this.mesh.rotation.y += dt * this.spinSpeed;
        const clouds = this.body.getObjectByName('PlanetClouds');
        if (clouds) clouds.rotation.y += dt * this.spinSpeed * 1.35;
    }

    getWorldPosition(target = new THREE.Vector3()) {
        return this.body.getWorldPosition(target);
    }

    getPOI() {
        return {
            type: this.kind === 'gas' ? 'gas giant' : 'planet',
            name: this.name,
            position: this.getWorldPosition(),
            radius: this.radius
        };
    }

    getAttractor() {
        return {
            type: 'planet',
            name: this.name,
            position: this.getWorldPosition(),
            mass: this.kind === 'gas' ? 4.5e7 : 1.2e7
        };
    }

    _createMesh(palette) {
        const geometry = new THREE.SphereGeometry(this.radius, 64, 32);
        if (this.kind === 'gas') {
            return new THREE.Mesh(geometry, createGasMaterial(palette));
        }
        return new THREE.Mesh(geometry, createTerrestrialMaterial(palette));
    }

    _createClouds() {
        const geometry = new THREE.SphereGeometry(this.radius * 1.012, 48, 24);
        const material = new THREE.MeshPhongMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.18,
            depthWrite: false
        });
        const clouds = new THREE.Mesh(geometry, material);
        clouds.name = 'PlanetClouds';
        return clouds;
    }

    _createRings(palette) {
        const geometry = new THREE.RingGeometry(this.radius * 1.55, this.radius * 2.55, 96, 8);
        const color = new THREE.Color(palette[2] ?? '#d8c38a');
        const material = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.42,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const rings = new THREE.Mesh(geometry, material);
        rings.name = 'PlanetRings';
        rings.rotation.x = Math.PI * 0.5;
        rings.rotation.z = Math.PI * 0.08;
        return rings;
    }
}

export function planetPalette(kind, index) {
    const palettes = kind === 'gas' ? GAS : TERRESTRIAL;
    return palettes[index % palettes.length];
}

function createGasMaterial(palette) {
    const a = new THREE.Color(palette[0]);
    const b = new THREE.Color(palette[1]);
    const c = new THREE.Color(palette[2]);
    return new THREE.ShaderMaterial({
        uniforms: {
            uA: { value: a },
            uB: { value: b },
            uC: { value: c }
        },
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vLocal;

            void main() {
                vNormal = normalize(normalMatrix * normal);
                vLocal = position;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            varying vec3 vNormal;
            varying vec3 vLocal;
            uniform vec3 uA;
            uniform vec3 uB;
            uniform vec3 uC;

            float hash(float n) { return fract(sin(n) * 43758.5453123); }

            void main() {
                float lat = normalize(vLocal).y;
                float bands = sin(lat * 34.0) * 0.5 + 0.5;
                float storm = smoothstep(0.985, 1.0, sin(vLocal.x * 0.003 + vLocal.z * 0.002 + lat * 9.0));
                vec3 col = mix(uA, uB, bands);
                col = mix(col, uC, smoothstep(0.18, 0.42, abs(lat)) * 0.35);
                col += uC * storm * 0.35;
                float light = 0.38 + max(dot(normalize(vNormal), normalize(vec3(-0.5, 0.4, 0.8))), 0.0) * 0.75;
                gl_FragColor = vec4(col * light, 1.0);
            }
        `
    });
}

function createTerrestrialMaterial(palette) {
    const ocean = new THREE.Color(palette[0]);
    const land = new THREE.Color(palette[1]);
    const desert = new THREE.Color(palette[2]);
    return new THREE.ShaderMaterial({
        uniforms: {
            uOcean: { value: ocean },
            uLand: { value: land },
            uDesert: { value: desert }
        },
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vLocal;

            void main() {
                vNormal = normalize(normalMatrix * normal);
                vLocal = position;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            varying vec3 vNormal;
            varying vec3 vLocal;
            uniform vec3 uOcean;
            uniform vec3 uLand;
            uniform vec3 uDesert;

            float hash(vec3 p) {
                p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
                p *= 17.0;
                return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
            }

            float noise(vec3 p) {
                vec3 i = floor(p);
                vec3 f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                return mix(
                    mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
                    f.z
                );
            }

            void main() {
                vec3 p = normalize(vLocal) * 4.2;
                float n = noise(p) * 0.55 + noise(p * 2.3 + 8.0) * 0.45;
                vec3 col = n > 0.54 ? mix(uLand, uDesert, smoothstep(0.62, 0.9, n)) : uOcean;
                float ice = smoothstep(0.72, 0.92, abs(normalize(vLocal).y));
                col = mix(col, vec3(0.86, 0.94, 1.0), ice * 0.75);
                float light = 0.34 + max(dot(normalize(vNormal), normalize(vec3(-0.5, 0.35, 0.8))), 0.0) * 0.84;
                gl_FragColor = vec4(col * light, 1.0);
            }
        `
    });
}
