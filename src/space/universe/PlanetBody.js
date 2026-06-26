import * as THREE from 'three';
import { deriveSeed } from './rng.js';
import {
    createPlanetSurfaceModel,
    normalizePlanetDescriptor,
    paletteToLegacyArray,
    planetPaletteArray
} from './planetPresets.js';

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
        palette = null,
        descriptor = null,
        hasRings = false
    } = {}) {
        this.descriptor = normalizePlanetDescriptor({
            ...(descriptor ?? {}),
            name,
            kind,
            palette: descriptor?.palette ?? palette,
            hasRings,
            systemRadius: radius,
            landable: descriptor?.landable ?? kind === 'terrestrial'
        });
        this.name = name;
        this.kind = this.descriptor.kind;
        this.type = this.descriptor.type;
        this.radius = radius;
        this.orbitRadius = orbitRadius;
        this.orbitSpeed = orbitSpeed;
        this.spinSpeed = spinSpeed;
        this.phase = phase;
        this.hasRings = this.descriptor.hasRings ?? hasRings;
        this.palette = this.descriptor.palette;
        this.paletteArray = this.descriptor.paletteArray ?? paletteToLegacyArray(this.palette);
        this.pivot = new THREE.Group();
        this.pivot.name = `Orbit:${name}`;
        this.body = new THREE.Group();
        this.body.name = `PlanetBody:${name}`;
        this.body.position.set(orbitRadius, 0, 0);

        this.mesh = this._createMesh();
        this.body.add(this.mesh);
        if (this.kind === 'terrestrial') this.body.add(this._createSystemAtmosphere());
        if (this.kind === 'terrestrial' && this.descriptor.clouds?.enabled) this.body.add(this._createClouds());
        if (this.hasRings) this.body.add(this._createRings());

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
            planetType: this.type,
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

    // Seed-derived summary the Planetary level is rebuilt from. Carries typed
    // planet identity plus the legacy palette array while migration is underway.
    getDescentDescriptor(parentSeed) {
        return {
            ...this.descriptor,
            name: this.name,
            kind: this.kind,
            palette: this.palette,
            paletteArray: this.paletteArray,
            hasRings: this.hasRings,
            systemRadius: this.radius,
            landable: this.kind === 'terrestrial',
            childSeed: this.descriptor.childSeed ?? deriveSeed(parentSeed, `planet:${this.name}`)
        };
    }

    _createMesh() {
        const geometry = new THREE.SphereGeometry(this.radius, 64, 32);
        if (this.kind === 'gas') {
            return new THREE.Mesh(geometry, createGasMaterial(this.paletteArray));
        }
        return this._createTerrestrialPreview(geometry);
    }

    _createTerrestrialPreview(geometry) {
        const model = createPlanetSurfaceModel(this.descriptor, {
            radius: this.radius,
            seed: this.descriptor.childSeed ?? this.descriptor.seed
        });
        const position = geometry.attributes.position;
        const colors = new Float32Array(position.count * 3);
        const materialData = new Float32Array(position.count * 3);
        const dir = new THREE.Vector3();
        const sample = {};

        for (let i = 0; i < position.count; i++) {
            dir.set(position.getX(i), position.getY(i), position.getZ(i)).normalize();
            model.sampleAt(dir, sample);
            const r = this.radius + (sample.height - this.radius) * 0.018;
            position.setXYZ(i, dir.x * r, dir.y * r, dir.z * r);
            const previewColor = previewColorForType(this.type, dir, sample, this.palette);
            colors[i * 3] = previewColor.r;
            colors[i * 3 + 1] = previewColor.g;
            colors[i * 3 + 2] = previewColor.b;
            materialData[i * 3] = sample.roughnessHint ?? 0.7;
            materialData[i * 3 + 1] = previewEmissiveForType(this.type, dir, sample);
            materialData[i * 3 + 2] = sample.normalizedElevation ?? 0;
        }

        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aMaterialData', new THREE.BufferAttribute(materialData, 3));
        geometry.computeVertexNormals();

        return new THREE.Mesh(geometry, createTerrestrialMaterial());
    }

    _createSystemAtmosphere() {
        const atmosphere = this.descriptor.atmosphere ?? {};
        const density = atmosphere.density ?? 0.2;
        const geometry = new THREE.SphereGeometry(this.radius * (1.035 + density * 0.03), 48, 24);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: new THREE.Color(atmosphere.color ?? '#7fb6ff') },
                uIntensity: { value: 0.32 + density * 0.65 }
            },
            vertexShader: `
                varying vec3 vNormal;
                varying vec3 vViewDir;
                void main() {
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vNormal = normalize(mat3(modelMatrix) * normal);
                    vViewDir = normalize(cameraPosition - wp.xyz);
                    gl_Position = projectionMatrix * viewMatrix * wp;
                }
            `,
            fragmentShader: `
                varying vec3 vNormal;
                varying vec3 vViewDir;
                uniform vec3 uColor;
                uniform float uIntensity;
                void main() {
                    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 2.0);
                    gl_FragColor = vec4(uColor * rim * uIntensity, rim * uIntensity);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.BackSide
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `SystemAtmosphere:${this.type}`;
        return mesh;
    }

    _createClouds() {
        const geometry = new THREE.SphereGeometry(this.radius * 1.012, 48, 24);
        const material = new THREE.MeshPhongMaterial({
            color: new THREE.Color(this.descriptor.clouds?.color ?? '#ffffff'),
            transparent: true,
            opacity: this.descriptor.clouds?.opacity ?? 0.18,
            depthWrite: false
        });
        const clouds = new THREE.Mesh(geometry, material);
        clouds.name = 'PlanetClouds';
        return clouds;
    }

    _createRings() {
        const geometry = new THREE.RingGeometry(this.radius * 1.55, this.radius * 2.55, 96, 8);
        const color = new THREE.Color(this.palette.accent ?? this.palette.highland ?? '#d8c38a');
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
    if (kind === 'gas') return GAS[index % GAS.length];
    return planetPaletteArray(kind, index);
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

function createTerrestrialMaterial() {
    return new THREE.ShaderMaterial({
        vertexShader: `
            attribute vec3 aColor;
            attribute vec3 aMaterialData;
            varying vec3 vNormal;
            varying vec3 vColor;
            varying vec3 vMaterialData;

            void main() {
                vNormal = normalize(normalMatrix * normal);
                vColor = aColor;
                vMaterialData = aMaterialData;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            varying vec3 vNormal;
            varying vec3 vColor;
            varying vec3 vMaterialData;

            void main() {
                float light = 0.34 + max(dot(normalize(vNormal), normalize(vec3(-0.5, 0.35, 0.8))), 0.0) * 0.84;
                vec3 emissive = vColor * vMaterialData.y * 0.8;
                gl_FragColor = vec4(vColor * light + emissive, 1.0);
            }
        `
    });
}

function previewColorForType(type, dir, sample, palette) {
    const color = new THREE.Color().copy(sample.color);
    const lat = Math.abs(dir.y);
    const band = Math.sin((dir.x * 11.0 + dir.z * 9.0 + dir.y * 4.0) * Math.PI);
    switch (type) {
        case 'temperate':
            if (sample.isLiquid) color.set(palette.water ?? '#1d5f91').multiplyScalar(1.18);
            else color.lerp(new THREE.Color(sample.normalizedElevation > 0.68 || lat > 0.78 ? palette.snow : palette.lowland), 0.48);
            break;
        case 'ice':
            color.set(lat > 0.55 ? palette.snow : palette.lowland);
            if (band > 0.72 || sample.material === 'dark rock') color.lerp(new THREE.Color(palette.rock), 0.62);
            color.lerp(new THREE.Color(palette.accent), 0.18);
            break;
        case 'desert':
            color.set(palette.lowland).lerp(new THREE.Color(palette.midland), sample.normalizedElevation * 0.65);
            if (band > 0.45) color.lerp(new THREE.Color(palette.highland), 0.35);
            break;
        case 'volcanic':
            color.set(palette.rock).lerp(new THREE.Color(palette.midland), Math.max(0, sample.normalizedElevation) * 0.42);
            if (previewEmissiveForType(type, dir, sample) > 0.1) color.lerp(new THREE.Color(palette.emissive), 0.72);
            break;
        case 'barren':
            color.set(palette.midland).lerp(new THREE.Color(palette.highland), Math.max(0, sample.normalizedElevation) * 0.55);
            if (band > 0.62 || sample.biome?.includes('crater')) color.lerp(new THREE.Color(palette.rock), 0.38);
            break;
        case 'toxic':
            color.set(sample.isLiquid ? palette.water : palette.lowland).lerp(new THREE.Color(palette.accent), sample.isLiquid ? 0.36 : 0.22);
            if (band > 0.58) color.lerp(new THREE.Color(palette.highland), 0.35);
            break;
        default:
            break;
    }
    return color.multiplyScalar(1.1);
}

function previewEmissiveForType(type, dir, sample) {
    if (type === 'volcanic') {
        const cracks = Math.sin((dir.x * 23.0 + dir.z * 17.0 + dir.y * 5.0) * Math.PI);
        return Math.max(sample.emissiveStrength ?? 0, cracks > 0.82 ? 0.72 : 0);
    }
    if (type === 'toxic' && sample.isLiquid) return 0.12;
    return sample.emissiveStrength ?? 0;
}
