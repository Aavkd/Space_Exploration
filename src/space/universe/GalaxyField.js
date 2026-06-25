import * as THREE from 'three';
import { gaussian, randomRange, weightedChoice } from './rng.js';
import { getImpostorTexture } from './impostors.js';

const TYPE_WEIGHTS = {
    spiral: 'spiralRatio',
    elliptical: 'ellipticalRatio',
    irregular: 'irregularRatio'
};

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
        const detailed = this.galaxies
            .map((galaxy) => ({ galaxy, distance: shipPosition.distanceTo(galaxy.position) }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 5)
            .map((entry) => entry.galaxy);

        for (const galaxy of this.galaxies) {
            const showDetail = detailed.includes(galaxy) && shipPosition.distanceTo(galaxy.position) < 150000;
            galaxy.points.visible = showDetail;
            galaxy.sprite.visible = !showDetail;
            galaxy.points.rotation.z += dt * 0.006 * galaxy.spin * this.config.galaxies.rotationSpeed;
            galaxy.sprite.material.rotation += dt * 0.002 * galaxy.spin * this.config.galaxies.rotationSpeed;
        }
    }

    setRuntimeConfig(galaxies) {
        this.config.galaxies = { ...this.config.galaxies, ...galaxies };
        const inner = new THREE.Color(this.config.galaxies.colorInner);
        const outer = new THREE.Color(this.config.galaxies.colorOuter);
        // `bloom` rides on top of brightness as an extra emissive push so the
        // galaxy colour clears the global bloom threshold and glows.
        const glow = this.config.galaxies.brightness * (this.config.galaxies.bloom ?? 1);
        for (const galaxy of this.galaxies) {
            galaxy.points.material.opacity = this.config.galaxies.opacity;
            galaxy.points.material.size = this.config.galaxies.pointSize;
            galaxy.points.material.color.copy(inner).lerp(outer, 0.25).multiplyScalar(glow);
            galaxy.sprite.material.opacity = this.config.galaxies.opacity * 0.95;
            galaxy.sprite.material.color.setScalar(glow);
        }
    }

    getPOIs() {
        return this.galaxies.map((galaxy, index) => ({
            type: 'galaxy',
            name: `${capitalize(galaxy.type)} galaxy ${index + 1}`,
            position: galaxy.position,
            mass: 2.4e8,
            radius: galaxy.radius,
            node: galaxy.node?.name
        }));
    }

    _create() {
        if (!this.config.galaxies.enabled) return;
        const count = Math.max(0, Math.floor(this.config.galaxies.count * this.config.global.masterDensity));
        const spawnGuarantee = Math.min(2, count);
        for (let i = 0; i < count; i++) {
            const type = this._type();
            const sample = i < spawnGuarantee
                ? this.web.sample(this.rng, { nodeBias: 1, filamentBias: 0, voidScatter: 0, spread: 0.22 })
                : this.web.sample(this.rng, { nodeBias: 0.55, filamentBias: 0.4, voidScatter: this.config.global.voidScatter });
            const radius = randomRange(this.rng, this.config.galaxies.sizeMin, this.config.galaxies.sizeMax);
            const galaxy = this._createGalaxy({ type, position: sample.position, radius, node: sample.node });
            this.galaxies.push(galaxy);
            this.group.add(galaxy.points, galaxy.sprite);
        }
    }

    _createGalaxy({ type, position, radius, node }) {
        const particleCount = Math.floor(THREE.MathUtils.clamp(radius / 4, 1200, 7000));
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const inner = new THREE.Color(this.config.galaxies.colorInner);
        const outer = new THREE.Color(this.config.galaxies.colorOuter);
        const color = new THREE.Color();

        for (let i = 0; i < particleCount; i++) {
            const index = i * 3;
            const p = this._galaxyPoint(type, radius);
            positions[index] = p.x;
            positions[index + 1] = p.y;
            positions[index + 2] = p.z;

            color.copy(inner).lerp(outer, Math.min(1, p.length() / radius));
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
            opacity: this.config.galaxies.opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        }));
        points.position.copy(position);
        points.rotation.set(randomRange(this.rng, -0.8, 0.8), randomRange(this.rng, 0, Math.PI), randomRange(this.rng, 0, Math.PI));

        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: getImpostorTexture(type, {
                inner: this.config.galaxies.colorInner,
                outer: this.config.galaxies.colorOuter
            }),
            transparent: true,
            opacity: this.config.galaxies.opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        }));
        sprite.name = `GalaxyImpostor:${type}`;
        sprite.position.copy(position);
        sprite.scale.set(radius * 2.6, radius * 1.55, 1);

        return { type, position: position.clone(), radius, node, points, sprite, spin: randomRange(this.rng, 0.45, 1.4) };
    }

    _galaxyPoint(type, radius) {
        if (type === 'elliptical') {
            return new THREE.Vector3(gaussian(this.rng) * radius * 0.36, gaussian(this.rng) * radius * 0.2, gaussian(this.rng) * radius * 0.36);
        }
        if (type === 'irregular') {
            return new THREE.Vector3(gaussian(this.rng) * radius * 0.33, gaussian(this.rng) * radius * 0.18, gaussian(this.rng) * radius * 0.33)
                .add(new THREE.Vector3(randomRange(this.rng, -radius * 0.2, radius * 0.2), 0, randomRange(this.rng, -radius * 0.2, radius * 0.2)));
        }

        const r = Math.pow(this.rng(), 0.55) * radius;
        const arm = Math.floor(this.rng() * 5);
        const angle = r * 0.0024 + arm * Math.PI * 0.4;
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
