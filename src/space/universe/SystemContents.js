import * as THREE from 'three';
import { StarBody } from './StarBody.js';
import { PlanetBody, planetPalette } from './PlanetBody.js';
import { DebrisField } from './DebrisField.js';
import { starBodyRadius } from './starColor.js';
import { createSeededRandom, deriveSeed, randomRange } from './rng.js';
import { DESCENT } from '../../config/scaleTiers.js';

const PLANET_ENTRY = Object.freeze({
    scale: DESCENT.planetEntryRadiusScale,
    min: DESCENT.planetEntryRadiusMin,
    max: DESCENT.planetEntryRadiusMax
});

const EMPTY_COUNTS = Object.freeze({
    stars: 0,
    planets: 0,
    galaxies: 0,
    blackHoles: 0,
    pulsars: 0,
    anomalies: 0,
    nebulae: 0,
    clusters: 0,
    debrisFields: 0,
    asteroids: 0,
    ringParticles: 0,
    nodes: 0,
    filaments: 0
});

export class SystemContents {
    constructor({ seed, anchor, regionRadius = 115000 }) {
        this.seed = seed;
        this.anchor = {
            ...anchor,
            name: anchor.name ?? anchor.id ?? 'Star system'
        };
        this.regionRadius = regionRadius;
        this.group = new THREE.Group();
        this.group.name = `System:${this.anchor.name}`;
        this.runtimeConfig = {};
        this.visualGlow = { sceneGlow: 1, landmarkGlow: 1 };
        this._rng = createSeededRandom(deriveSeed(seed, 'system-contents'));
        this._scratch = new THREE.Vector3();
        this.planets = [];
        this.star = null;
        this.debrisField = null;
        this._create();
    }

    update(shipPosition, dt) {
        this.star?.update(dt, shipPosition);
        for (const planet of this.planets) planet.update(dt);
        this.debrisField?.update(shipPosition, dt);
    }

    rebaseOrigin(offset) {
        this.group.position.sub(offset);
    }

    getAttractors() {
        return [
            this.star.getAttractor(),
            ...this.planets.map((planet) => planet.getAttractor())
        ];
    }

    getPOIs(shipPosition = new THREE.Vector3(), limit = 12) {
        const pois = [
            this.star.getPOI(),
            ...this.planets.map((planet) => planet.getPOI()),
            ...(this.debrisField?.getPOIs(shipPosition, 3) ?? [])
        ];
        return pois
            .map((poi) => ({ ...poi, distance: shipPosition.distanceTo(poi.position) }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, limit);
    }

    // Planets the ship can descend into from this System level (§4.1). Each
    // carries a seed-derived descriptor so its Planetary level is rebuilt
    // deterministically and matches the world that was approached (§5). The
    // entry shell is derived from the in-system planet radius and is small
    // relative to orbits so precision flight sinks into the specific world the
    // ship is closing on, not every planet in the system.
    getDescentCandidates(shipPosition = new THREE.Vector3(), maxRadiusOverride = null) {
        const candidates = [];
        for (const planet of this.planets) {
            const descriptor = planet.getDescentDescriptor(this.seed);
            const position = planet.getWorldPosition();
            const entryRadius = THREE.MathUtils.clamp(
                planet.radius * PLANET_ENTRY.scale,
                PLANET_ENTRY.min,
                PLANET_ENTRY.max
            );
            const reach = maxRadiusOverride ?? entryRadius;
            if (shipPosition.distanceTo(position) > reach) continue;
            candidates.push({
                id: descriptor.name,
                kind: 'planet',
                position,
                radius: planet.radius,
                entryRadius,
                descriptor,
                childSeed: descriptor.childSeed
            });
        }
        return candidates;
    }

    getCounts() {
        const debrisCounts = this.debrisField?.getCounts() ?? {};
        return {
            ...EMPTY_COUNTS,
            stars: 1,
            planets: this.planets.length,
            debrisFields: debrisCounts.debrisFields ?? 0,
            asteroids: debrisCounts.asteroids ?? 0,
            ringParticles: debrisCounts.ringParticles ?? 0
        };
    }

    getHazardState(shipPosition, velocity) {
        return this.debrisField?.getHazardState(shipPosition, velocity);
    }

    getCurrentNode() {
        return {
            name: this.anchor.name,
            theme: 'stellar system',
            radius: this.regionRadius
        };
    }

    getDebugState(shipPosition = new THREE.Vector3()) {
        return {
            seed: this.seed,
            counts: this.getCounts(),
            currentNode: this.getCurrentNode(shipPosition),
            attractors: this.getAttractors().length,
            system: {
                name: this.anchor.name,
                planets: this.planets.length,
                starRadius: this.star.radius
            }
        };
    }

    setRuntimeConfig(config = {}) {
        this.runtimeConfig = { ...this.runtimeConfig, ...config };
        const lighting = config.lighting ?? {};
        if (this.star?.light) {
            this.star.light.intensity = (lighting.intensity ?? 2.35) * 2.1 * Math.max(0.7, this.star.luminosity);
            this.star.light.distance = Math.max(lighting.range ?? 175000, this.star.radius * 16);
        }
        this.debrisField?.setRuntimeConfig(config.debris ?? {});
    }

    setVisualGlow({ sceneGlow = 1, landmarkGlow = 1 } = {}) {
        this.visualGlow = { sceneGlow, landmarkGlow };
        if (this.star?.corona) {
            this.star.corona.material.uniforms.uColor.value.copy(this.star.color).multiplyScalar(Math.max(0.8, sceneGlow * landmarkGlow));
        }
    }

    _create() {
        const color = this.anchor.color?.clone?.() ?? new THREE.Color('#ffd89a');
        const luminosity = this.anchor.luminosity ?? 1;
        // Derived from the same luminosity the parent impostor used for its
        // `systemRadius`, so the star you saw and the star you entered agree in
        // size (scale-architecture §5; see starColor.starBodyRadius).
        const starRadius = starBodyRadius(luminosity);
        this.star = new StarBody({
            name: this.anchor.name,
            radius: starRadius,
            color,
            temperatureK: this.anchor.temperatureK ?? 5800,
            luminosity,
            rng: this._rng
        });
        this.group.add(this.star.group);

        this._createPlanets(starRadius);
        this._createDebris(starRadius);
        this.group.add(this._createBackdrop());
    }

    _createPlanets(starRadius) {
        const planetCount = 4 + Math.floor(this._rng() * 4);
        let orbit = starRadius * 3.2 + randomRange(this._rng, 6500, 10500);
        let guaranteedRing = false;

        for (let i = 0; i < planetCount; i++) {
            const gas = i > 1 && this._rng() < 0.48;
            const radius = gas
                ? randomRange(this._rng, 2200, 4700)
                : randomRange(this._rng, 720, 1850);
            const hasRings = gas && (!guaranteedRing || this._rng() < 0.5);
            guaranteedRing = guaranteedRing || hasRings;
            const planet = new PlanetBody({
                name: `${gas ? 'Gas giant' : 'World'} ${i + 1}`,
                kind: gas ? 'gas' : 'terrestrial',
                radius,
                orbitRadius: orbit,
                orbitSpeed: randomRange(this._rng, 0.004, 0.018) * (this._rng() < 0.5 ? -1 : 1),
                spinSpeed: randomRange(this._rng, 0.04, 0.18),
                phase: this._rng() * Math.PI * 2,
                palette: planetPalette(gas ? 'gas' : 'terrestrial', i + Math.floor(this._rng() * 3)),
                hasRings
            });
            planet.pivot.rotation.x = randomRange(this._rng, -0.09, 0.09);
            planet.pivot.rotation.z = randomRange(this._rng, -0.16, 0.16);
            this.planets.push(planet);
            this.group.add(planet.pivot);
            orbit += randomRange(this._rng, gas ? 12500 : 9000, gas ? 19500 : 14500);
            orbit = Math.min(orbit, this.regionRadius * 0.86);
        }
    }

    _createDebris(starRadius) {
        this.debrisField = new DebrisField({
            seed: this.seed,
            config: this.runtimeConfig.debris,
            planets: this.planets,
            starRadius,
            regionRadius: this.regionRadius
        });
        this.group.add(this.debrisField.group);
    }

    _createBackdrop() {
        const count = 2600;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const color = new THREE.Color();
        for (let i = 0; i < count; i++) {
            const v = randomUnitVector(this._rng, this._scratch).multiplyScalar(this.regionRadius * randomRange(this._rng, 0.82, 0.98));
            const index = i * 3;
            positions[index] = v.x;
            positions[index + 1] = v.y;
            positions[index + 2] = v.z;
            color.set(this._rng() < 0.72 ? '#d8ecff' : '#ffd7a0').multiplyScalar(randomRange(this._rng, 0.45, 1.15));
            colors[index] = color.r;
            colors[index + 1] = color.g;
            colors[index + 2] = color.b;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const points = new THREE.Points(geometry, new THREE.PointsMaterial({
            size: 120,
            vertexColors: true,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        }));
        points.name = 'SystemBackdropStars';
        points.frustumCulled = false;
        return points;
    }
}

function randomUnitVector(rng, target) {
    const z = rng() * 2 - 1;
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    return target.set(Math.cos(a) * r, z, Math.sin(a) * r);
}
