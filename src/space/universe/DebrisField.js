import * as THREE from 'three';
import { createSeededRandom, deriveSeed, gaussian, randomRange } from './rng.js';

const DEFAULT_CONFIG = Object.freeze({
    enabled: true,
    systemBelts: true,
    beltCount: 2,
    density: 1,
    opacity: 0.74,
    brightness: 1,
    driftSpeed: 1,
    hazardIntensity: 1.4
});

const ROCK_COLORS = ['#8f8a82', '#6f7479', '#b19a7a', '#5c5148'];
const DUST_COLORS = ['#7b8fa8', '#a89a82', '#c0b8a8'];

const _matrix = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _color = new THREE.Color();
const _origin = new THREE.Vector3();

export class DebrisField {
    constructor({
        seed,
        config = {},
        planets = [],
        starRadius = 3200,
        regionRadius = 115000
    } = {}) {
        this.seed = seed;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.planets = planets;
        this.starRadius = starRadius;
        this.regionRadius = regionRadius;
        this.group = new THREE.Group();
        this.group.name = 'SystemDebris';
        this.fields = [];
        this.counts = { debrisFields: 0, asteroids: 0, ringParticles: 0 };
        this.time = 0;
        this._rng = createSeededRandom(deriveSeed(seed, 'debris:system'));
        this._hazardScratch = new THREE.Vector3();

        if (this.config.enabled) this._create();
        this.setRuntimeConfig(this.config);
    }

    update(shipPosition = new THREE.Vector3(), dt = 0) {
        this.time += dt * (this.config.driftSpeed ?? 1);
        for (const field of this.fields) {
            if (field.kind === 'belt') {
                field.group.rotation.y += dt * field.spin * this.config.driftSpeed;
                field.visibleDistance = this._distanceToBelt(shipPosition, field);
            } else if (field.kind === 'ring') {
                field.group.rotation.y += dt * field.spin * this.config.driftSpeed;
                field.center = field.group.getWorldPosition(field.center);
                field.visibleDistance = shipPosition.distanceTo(field.center);
            }
            field.group.visible = field.visibleDistance <= field.cullDistance;
        }
    }

    setRuntimeConfig(config = {}) {
        this.config = { ...this.config, ...config };
        for (const field of this.fields) {
            if (field.mesh?.material) {
                field.mesh.material.opacity = this.config.opacity;
                field.mesh.material.color.setScalar(this.config.brightness);
            }
            if (field.dust?.material) {
                field.dust.material.opacity = this.config.opacity * field.dustOpacity;
                field.dust.material.color.setScalar(this.config.brightness);
                field.dust.material.size = field.dustSize;
            }
        }
    }

    getPOIs(shipPosition = new THREE.Vector3(), limit = 3) {
        return this.fields
            .filter((field) => field.kind !== 'ring')
            .map((field) => {
                const position = this._fieldPoiPosition(field);
                return {
                    type: 'asteroid belt',
                    name: field.name,
                    position,
                    radius: field.radius + field.width,
                    density: field.density,
                    distance: shipPosition.distanceTo(position)
                };
            })
            .sort((a, b) => a.distance - b.distance)
            .slice(0, limit);
    }

    getCounts() {
        return { ...this.counts };
    }

    getHazardState(shipPosition = new THREE.Vector3(), velocity = new THREE.Vector3()) {
        const hazardGain = Math.max(0, this.config.hazardIntensity ?? 0);
        if (!this.config.enabled || hazardGain <= 0) return emptyHazard();

        let best = null;
        let bestIntensity = 0;
        let bestDistance = Infinity;
        for (const field of this.fields) {
            const state = this._fieldHazard(field, shipPosition);
            if (state.intensity > bestIntensity) {
                best = field;
                bestIntensity = state.intensity;
                bestDistance = state.distance;
            }
        }

        if (!best || bestIntensity <= 0.001) return emptyHazard();

        const speedScale = THREE.MathUtils.clamp(velocity.length() / 1800, 0.18, 1.25);
        const wave = Math.sin(this.time * 2.7 + best.phase) * 0.55 + Math.cos(this.time * 1.31 + best.phase * 2.3) * 0.45;
        const accel = this._hazardScratch.set(
            Math.sin(best.phase + this.time * 0.9),
            Math.cos(best.phase * 1.7 + this.time * 1.1) * 0.35,
            Math.cos(best.phase - this.time * 0.7)
        );
        if (velocity.lengthSq() > 1e-3) {
            accel.cross(velocity).cross(velocity).normalize();
        } else {
            accel.normalize();
        }
        accel.multiplyScalar(bestIntensity * hazardGain * speedScale * (0.75 + Math.abs(wave) * 0.5));

        return {
            active: true,
            type: best.kind,
            name: best.name,
            intensity: bestIntensity,
            distance: bestDistance,
            acceleration: accel.clone()
        };
    }

    _create() {
        this._createSystemBelts();
        this._createPlanetRings();
    }

    _createSystemBelts() {
        if (!this.config.systemBelts) return;
        const count = Math.max(0, Math.floor(this.config.beltCount ?? 2));
        if (count <= 0) return;

        const innerStart = this.starRadius * 4.2 + 9000;
        const span = Math.max(16000, this.regionRadius * 0.55 - innerStart);
        for (let i = 0; i < count; i++) {
            const orbit = innerStart + span * ((i + 0.35 + this._rng() * 0.3) / Math.max(count, 1));
            const width = randomRange(this._rng, 1800, 4200) * (1 + i * 0.18);
            const asteroids = Math.floor(THREE.MathUtils.clamp(240 * this.config.density * (1 + i * 0.25), 80, 900));
            const dust = Math.floor(asteroids * 2.4);
            const field = this._createBeltField({
                name: `Asteroid belt ${i + 1}`,
                radius: orbit,
                width,
                asteroids,
                dust,
                seed: deriveSeed(this.seed, `system-belt:${i}`),
                cullDistance: orbit + width + 72000
            });
            this.fields.push(field);
            this.group.add(field.group);
            this.counts.debrisFields++;
            this.counts.asteroids += asteroids;
        }
    }

    _createPlanetRings() {
        for (const [index, planet] of this.planets.entries()) {
            if (!planet.hasRings) continue;
            const rng = createSeededRandom(deriveSeed(this.seed, `ring:${planet.name}:${index}`));
            const particles = Math.floor(THREE.MathUtils.clamp(180 * this.config.density, 80, 520));
            const field = this._createRingField({ planet, rng, particles, index });
            planet.body.add(field.group);
            this.fields.push(field);
            this.counts.debrisFields++;
            this.counts.ringParticles += particles;
        }
    }

    _createBeltField({ name, radius, width, asteroids, dust, seed, cullDistance }) {
        const rng = createSeededRandom(seed);
        const group = new THREE.Group();
        group.name = name;
        const mesh = createRockMesh(asteroids, rng, 'belt');
        const color = new THREE.Color();
        for (let i = 0; i < asteroids; i++) {
            const angle = rng() * Math.PI * 2;
            const r = radius + gaussian(rng) * width;
            const y = gaussian(rng) * width * 0.18;
            _pos.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
            const size = randomRange(rng, 35, 180) * randomRange(rng, 0.65, 1.4);
            writeRockInstance(mesh, i, _pos, size, rng);
            color.set(ROCK_COLORS[Math.floor(rng() * ROCK_COLORS.length)]).multiplyScalar(randomRange(rng, 0.55, 1.2));
            mesh.setColorAt(i, color);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        group.add(mesh);

        const dustPoints = createBeltDust({ count: dust, radius, width, rng });
        group.add(dustPoints);

        return {
            kind: 'belt',
            name,
            group,
            mesh,
            dust: dustPoints,
            center: new THREE.Vector3(),
            radius,
            width,
            density: this.config.density,
            spin: randomRange(rng, -0.012, 0.012),
            phase: rng() * Math.PI * 2,
            cullDistance,
            dustOpacity: 0.22,
            dustSize: 2.1
        };
    }

    _createRingField({ planet, rng, particles, index }) {
        const group = new THREE.Group();
        group.name = `RingDebris:${planet.name}`;
        group.rotation.z = Math.PI * 0.08;
        const mesh = createRockMesh(particles, rng, 'ring');
        const color = new THREE.Color('#c8b990');
        for (let i = 0; i < particles; i++) {
            const angle = rng() * Math.PI * 2;
            const r = randomRange(rng, planet.radius * 1.56, planet.radius * 2.52);
            const y = gaussian(rng) * planet.radius * 0.012;
            _pos.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
            const size = randomRange(rng, planet.radius * 0.012, planet.radius * 0.04);
            writeRockInstance(mesh, i, _pos, size, rng);
            color.set(DUST_COLORS[Math.floor(rng() * DUST_COLORS.length)]).multiplyScalar(randomRange(rng, 0.6, 1.18));
            mesh.setColorAt(i, color);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        group.add(mesh);

        return {
            kind: 'ring',
            name: `${planet.name} ring debris`,
            group,
            mesh,
            dust: null,
            planet,
            center: new THREE.Vector3(),
            radius: planet.radius * 2.05,
            width: planet.radius * 0.5,
            density: this.config.density,
            spin: randomRange(rng, 0.018, 0.04) * (rng() < 0.5 ? -1 : 1),
            phase: rng() * Math.PI * 2 + index,
            cullDistance: planet.radius * 18,
            dustOpacity: 0,
            dustSize: 1
        };
    }

    _fieldPoiPosition(field) {
        this.group.getWorldPosition(_origin);
        return new THREE.Vector3(field.radius + _origin.x, _origin.y, _origin.z);
    }

    _distanceToBelt(shipPosition, field) {
        this.group.getWorldPosition(_origin);
        const x = shipPosition.x - _origin.x;
        const y = shipPosition.y - _origin.y;
        const z = shipPosition.z - _origin.z;
        const radial = Math.hypot(x, z);
        const radialDistance = Math.abs(radial - field.radius);
        const verticalDistance = Math.abs(y);
        return Math.hypot(radialDistance, verticalDistance * 2.6);
    }

    _fieldHazard(field, shipPosition) {
        let distance;
        if (field.kind === 'belt') {
            distance = this._distanceToBelt(shipPosition, field);
        } else {
            distance = shipPosition.distanceTo(field.center);
        }
        const hazardRadius = field.width * (field.kind === 'ring' ? 3.0 : 2.2);
        const intensity = 1 - THREE.MathUtils.smoothstep(distance, hazardRadius * 0.35, hazardRadius);
        return { distance, intensity: Math.max(0, intensity) };
    }
}

function emptyHazard() {
    return {
        active: false,
        type: null,
        name: null,
        intensity: 0,
        distance: Infinity,
        acceleration: new THREE.Vector3()
    };
}

function createRockMesh(count, rng, kind) {
    const geometry = kind === 'ring'
        ? new THREE.IcosahedronGeometry(1, 0)
        : new THREE.DodecahedronGeometry(1, 0);
    const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.92,
        metalness: 0.02,
        flatShading: true,
        vertexColors: true,
        transparent: true,
        opacity: 0.74,
        depthWrite: true
    });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = `DebrisRocks:${kind}`;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.frustumCulled = false;
    return mesh;
}

function writeRockInstance(mesh, index, position, size, rng) {
    _axis.set(gaussian(rng), gaussian(rng), gaussian(rng)).normalize();
    _quat.setFromAxisAngle(_axis, rng() * Math.PI * 2);
    _scale.set(
        size * randomRange(rng, 0.65, 1.65),
        size * randomRange(rng, 0.45, 1.2),
        size * randomRange(rng, 0.7, 1.8)
    );
    _matrix.compose(position, _quat, _scale);
    mesh.setMatrixAt(index, _matrix);
}

function createBeltDust({ count, radius, width, rng }) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const angle = rng() * Math.PI * 2;
        const r = radius + gaussian(rng) * width * 1.45;
        const y = gaussian(rng) * width * 0.24;
        const item = i * 3;
        positions[item] = Math.cos(angle) * r;
        positions[item + 1] = y;
        positions[item + 2] = Math.sin(angle) * r;
        _color.set(DUST_COLORS[Math.floor(rng() * DUST_COLORS.length)]).multiplyScalar(randomRange(rng, 0.35, 0.75));
        colors[item] = _color.r;
        colors[item + 1] = _color.g;
        colors[item + 2] = _color.b;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return createDustPoints(geometry, 2.1);
}

function createDustPoints(geometry, size) {
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
        size,
        color: 0xffffff,
        vertexColors: true,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true
    }));
    points.name = 'DebrisDust';
    points.frustumCulled = false;
    return points;
}
