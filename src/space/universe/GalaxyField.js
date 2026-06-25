import * as THREE from 'three';
import { createSeededRandom, deriveSeed, gaussian, randomRange, weightedChoice } from './rng.js';
import { getImpostorTexture } from './impostors.js';

const TYPE_WEIGHTS = {
    spiral: 'spiralRatio',
    elliptical: 'ellipticalRatio',
    irregular: 'irregularRatio'
};

const DETAIL_LIMIT = 5;

export class GalaxyField {
    constructor({ rng, web, config }) {
        this.rng = rng;
        this.web = web;
        this.config = config;
        this.group = new THREE.Group();
        this.group.name = 'UniverseGalaxies';
        this.galaxies = [];
        this._create();
        this.setRuntimeConfig(config.galaxies);
    }

    update(shipPosition, dt) {
        const entries = this.galaxies
            .map((galaxy) => ({ galaxy, distance: shipPosition.distanceTo(galaxy.position) }))
            .sort((a, b) => a.distance - b.distance)
        const detailed = new Set(entries.slice(0, DETAIL_LIMIT).map((entry) => entry.galaxy));

        for (const { galaxy, distance } of entries) {
            const outer = THREE.MathUtils.clamp(galaxy.radius * 9.5, 120000, 360000);
            const inner = THREE.MathUtils.clamp(galaxy.radius * 2.15, 32000, 105000);
            const detailFade = detailed.has(galaxy) ? 1 - THREE.MathUtils.smoothstep(distance, inner, outer) : 0;
            const spriteFade = THREE.MathUtils.clamp(1 - detailFade * 0.82, 0.16, 1);

            galaxy.points.visible = detailFade > 0.01;
            galaxy.sprite.visible = spriteFade > 0.01;
            galaxy.lod.detailFade = detailFade;
            galaxy.lod.spriteFade = spriteFade;
            this._applyGalaxyMaterial(galaxy);
            galaxy.points.rotation.z += dt * 0.006 * galaxy.spin * this.config.galaxies.rotationSpeed;
            galaxy.sprite.material.rotation += dt * 0.002 * galaxy.spin * this.config.galaxies.rotationSpeed;
        }
    }

    setRuntimeConfig(galaxies) {
        this.config.galaxies = { ...this.config.galaxies, ...galaxies };
        for (const galaxy of this.galaxies) {
            this._applyGalaxyMaterial(galaxy);
        }
    }

    getPOIs() {
        if (this.config.galaxies.backdropOnly) return [];
        return this.galaxies.map((galaxy) => ({
            type: 'galaxy',
            name: galaxy.descriptor.id,
            position: galaxy.position,
            mass: 2.4e8,
            radius: galaxy.radius,
            node: galaxy.node?.name,
            density: galaxy.density,
            descriptor: { ...galaxy.descriptor }
        }));
    }

    _create() {
        if (!this.config.galaxies.enabled) return;
        const count = Math.max(0, Math.floor(this.config.galaxies.count * this.config.global.masterDensity));
        const spawnGuarantee = Math.min(this.config.galaxies.spawnGuarantee ?? 2, count);
        for (let i = 0; i < count; i++) {
            const type = this._type();
            const sample = i < spawnGuarantee
                ? this.web.sample(this.rng, { nodeBias: 1, filamentBias: 0, voidScatter: 0, spread: 0.22, densityAttempts: 6, densityPower: 1.5 })
                : this.web.sample(this.rng, { nodeBias: 0.55, filamentBias: 0.4, voidScatter: this.config.global.voidScatter, densityAttempts: 5, densityPower: 1.35 });
            const densityScale = fieldScale(sample.field, 0.78, 1.34);
            const radius = randomRange(this.rng, this.config.galaxies.sizeMin, this.config.galaxies.sizeMax) * densityScale;
            const descriptor = this._createDescriptor({ index: i, type, radius, density: sample.field?.density ?? 0 });
            const position = enforceMinDistance(sample.position, this.config.galaxies.minDistanceFromOrigin ?? 0, this.rng);
            const galaxy = this._createGalaxy({ descriptor, position, node: sample.node });
            this.galaxies.push(galaxy);
            this.group.add(galaxy.points, galaxy.sprite);
        }
    }

    _createGalaxy({ descriptor, position, node }) {
        const { type, radius, density } = descriptor;
        const particleCount = Math.floor(THREE.MathUtils.clamp(radius / 4, 1200, 7000));
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const inner = new THREE.Color(descriptor.palette.inner);
        const outer = new THREE.Color(descriptor.palette.outer);
        const hii = new THREE.Color('#ff85c8');
        const color = new THREE.Color();

        for (let i = 0; i < particleCount; i++) {
            const index = i * 3;
            const p = this._galaxyPoint(type, radius, descriptor);
            positions[index] = p.x;
            positions[index + 1] = p.y;
            positions[index + 2] = p.z;

            const radial = Math.min(1, p.length() / Math.max(radius, 1));
            color.copy(inner).lerp(outer, radial);
            if (type === 'spiral') {
                const angle = Math.atan2(p.z, p.x);
                const armBand = Math.sin(angle * descriptor.armCount - radial * 8.5 + descriptor.dustPhase);
                const dust = THREE.MathUtils.smoothstep(0.52, 0.96, armBand * 0.5 + 0.5);
                color.multiplyScalar(THREE.MathUtils.lerp(1, 0.42, dust * (0.35 + radial * 0.35)));
                if (radial > 0.22 && radial < 0.92 && armBand > 0.58 && this.rng() < 0.035) {
                    color.lerp(hii, 0.72).multiplyScalar(1.35);
                }
            }
            colors[index] = color.r;
            colors[index + 1] = color.g;
            colors[index + 2] = color.b;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const points = new THREE.Points(geometry, new THREE.PointsMaterial({
            size: this.config.galaxies.pointSize,
            color: 0xffffff,
            vertexColors: true,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        }));
        points.position.copy(position);
        points.rotation.set(descriptor.tilt.x, descriptor.tilt.y, descriptor.tilt.z);

        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: getImpostorTexture(type, {
                inner: descriptor.palette.inner,
                outer: descriptor.palette.outer,
                variant: descriptor.seed,
                armCount: descriptor.armCount,
                dustPhase: descriptor.dustPhase
            }),
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        }));
        sprite.name = `GalaxyImpostor:${type}`;
        sprite.position.copy(position);
        sprite.scale.set(radius * 2.6, radius * 1.55, 1);

        return {
            type,
            position: position.clone(),
            radius,
            node,
            density,
            descriptor,
            points,
            sprite,
            spin: descriptor.spin,
            lod: { detailFade: 0, spriteFade: 1 }
        };
    }

    _createDescriptor({ index, type, radius, density }) {
        const seed = deriveSeed(this.config.global.seed, `galaxy:${index}:${type}`);
        const rng = createSeededRandom(seed);
        const palette = galaxyPalette(type, rng, this.config.galaxies);
        return {
            id: `${capitalize(type)} galaxy ${index + 1}`,
            type,
            seed,
            radius,
            density,
            palette,
            spin: randomRange(rng, 0.45, 1.4),
            armCount: type === 'spiral' ? Math.floor(randomRange(rng, 3, 7)) : 0,
            dustPhase: randomRange(rng, 0, Math.PI * 2),
            hiiSeed: deriveSeed(seed, 'hii'),
            tilt: {
                x: randomRange(rng, -0.8, 0.8),
                y: randomRange(rng, 0, Math.PI),
                z: randomRange(rng, 0, Math.PI)
            }
        };
    }

    _applyGalaxyMaterial(galaxy) {
        const glow = Math.min(
            this.config.galaxies.brightness * (this.config.galaxies.bloom ?? 1),
            this.config.galaxies.maxGlow ?? 1.85
        );
        const inner = new THREE.Color(galaxy.descriptor.palette.inner);
        const outer = new THREE.Color(galaxy.descriptor.palette.outer);
        galaxy.points.material.opacity = this.config.galaxies.opacity * galaxy.lod.detailFade * 0.72;
        galaxy.points.material.size = this.config.galaxies.pointSize;
        galaxy.points.material.color.copy(inner).lerp(outer, 0.25).multiplyScalar(glow * 0.76);
        galaxy.sprite.material.opacity = this.config.galaxies.opacity * galaxy.lod.spriteFade * 0.88;
        galaxy.sprite.material.color.copy(inner).lerp(outer, 0.38).multiplyScalar(glow);
    }

    _galaxyPoint(type, radius, descriptor) {
        if (type === 'elliptical') {
            return new THREE.Vector3(gaussian(this.rng) * radius * 0.36, gaussian(this.rng) * radius * 0.2, gaussian(this.rng) * radius * 0.36);
        }
        if (type === 'irregular') {
            return new THREE.Vector3(gaussian(this.rng) * radius * 0.33, gaussian(this.rng) * radius * 0.18, gaussian(this.rng) * radius * 0.33)
                .add(new THREE.Vector3(randomRange(this.rng, -radius * 0.2, radius * 0.2), 0, randomRange(this.rng, -radius * 0.2, radius * 0.2)));
        }

        const r = Math.pow(this.rng(), 0.55) * radius;
        const armCount = Math.max(2, descriptor.armCount || 5);
        const arm = Math.floor(this.rng() * armCount);
        const angle = r * 0.0024 + arm * Math.PI * 2 / armCount + descriptor.dustPhase * 0.12;
        const scatter = (1 - r / radius) * radius * 0.06 + radius * 0.018;
        return new THREE.Vector3(
            Math.cos(angle) * r + gaussian(this.rng) * scatter,
            gaussian(this.rng) * radius * 0.035,
            Math.sin(angle) * r + gaussian(this.rng) * scatter
        );
    }

    _type() {
        return weightedChoice(this.rng, Object.entries(TYPE_WEIGHTS).map(([value, key]) => ({
            value,
            weight: this.config.galaxies[key]
        }))) ?? 'spiral';
    }
}

function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function fieldScale(field, min, max) {
    const density = field?.density ?? 0.6;
    const t = THREE.MathUtils.clamp((density - 0.15) / 1.75, 0, 1);
    return THREE.MathUtils.lerp(min, max, t);
}

function enforceMinDistance(position, minDistance, rng) {
    const result = position.clone();
    if (minDistance <= 0 || result.length() >= minDistance) return result;
    if (result.lengthSq() < 1) {
        result.set(gaussian(rng), gaussian(rng) * 0.45, gaussian(rng)).normalize();
    } else {
        result.normalize();
    }
    return result.multiplyScalar(randomRange(rng, minDistance, minDistance * 1.28));
}

function galaxyPalette(type, rng, galaxiesConfig) {
    const inner = new THREE.Color(galaxiesConfig.colorInner);
    const outer = new THREE.Color(galaxiesConfig.colorOuter);
    const hueShift = randomRange(rng, -0.08, 0.08);
    inner.offsetHSL(hueShift, randomRange(rng, -0.06, 0.08), randomRange(rng, -0.03, 0.08));
    outer.offsetHSL(hueShift + randomRange(rng, -0.04, 0.04), randomRange(rng, -0.04, 0.1), randomRange(rng, -0.05, 0.08));

    if (type === 'elliptical') {
        inner.lerp(new THREE.Color('#ffd8a0'), 0.28);
        outer.lerp(new THREE.Color('#d8b46f'), 0.22);
    } else if (type === 'irregular') {
        inner.lerp(new THREE.Color('#a8ffe8'), 0.22);
        outer.lerp(new THREE.Color('#ff7bc8'), 0.26);
    }

    return {
        inner: `#${inner.getHexString()}`,
        outer: `#${outer.getHexString()}`
    };
}
