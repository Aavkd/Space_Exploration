import * as THREE from 'three';
import { UNIVERSE_CONFIG, cloneUniverseConfig } from '../config/universePresets.js';
import { CosmicWeb } from './universe/CosmicWeb.js';
import { GalaxyField } from './universe/GalaxyField.js';
import { GalaxyInteriorField } from './universe/GalaxyInteriorField.js';
import { Landmarks } from './universe/Landmarks.js';
import { NebulaField } from './universe/NebulaField.js';
import { SpatialIndex } from './universe/SpatialIndex.js';
import { StarField } from './universe/StarField.js';
import { UniverseEvents } from './universe/UniverseEvents.js';
import { calculateSystemPoiLimit } from './universe/poiAllocation.js';
import { UniverseLighting } from './universe/UniverseLighting.js';
import { disposeObject3D } from './universe/dispose.js';
import { createSeededRandom, deriveSeed } from './universe/rng.js';

export class Universe {
    constructor({ config = UNIVERSE_CONFIG, seed } = {}) {
        this.group = new THREE.Group();
        this.group.name = 'ProceduralUniverse';
        this.config = cloneUniverseConfig(config);
        if (seed) this.config.global.seed = seed;
        this.runtimeConfig = {};
        this.visualGlow = { sceneGlow: 1, landmarkGlow: 1 };
        this._emptyCounts = {
            stars: 0,
            galaxies: 0,
            blackHoles: 0,
            pulsars: 0,
            anomalies: 0,
            nebulae: 0,
            clusters: 0,
            nodes: 0,
            filaments: 0
        };
        this.regenerate(this.config);
    }

    update(shipPosition, dt, cameraPosition = shipPosition) {
        this.starField?.update(dt, cameraPosition);
        this.galaxyInterior?.update(dt);
        this.galaxyField?.update(shipPosition, dt);
        this.landmarks?.update(shipPosition, dt);
        this.nebulaField?.update(dt);
        const pois = this.getPOIs(shipPosition, 16);
        this.events?.update(dt, { shipPosition, pois });
        this.lighting?.update(shipPosition, this._heroLights(), dt);
    }

    regenerate(config = this.config) {
        const next = cloneUniverseConfig(this.config);
        mergeConfig(next, config);
        this.config = next;
        this.baseConfig = cloneUniverseConfig(this.config);
        this.runtimeConfig = flattenRuntimeConfig(this.config);

        disposeObject3D(this.group);
        this.group.clear();

        const seed = this.config.global.seed;
        this.web = new CosmicWeb({
            rng: createSeededRandom(deriveSeed(seed, 'cosmic-web')),
            config: this.config
        });
        this.starField = new StarField({
            rng: createSeededRandom(deriveSeed(seed, 'stars')),
            web: this.web,
            config: this.config
        });
        this.galaxyField = new GalaxyField({
            rng: createSeededRandom(deriveSeed(seed, 'galaxies')),
            web: this.web,
            config: this.config
        });
        this.galaxyInterior = this.config.galaxyInterior?.enabled
            ? new GalaxyInteriorField({ config: this.config })
            : null;
        this.landmarks = new Landmarks({
            rng: createSeededRandom(deriveSeed(seed, 'landmarks')),
            web: this.web,
            config: this.config
        });
        this.nebulaField = new NebulaField({
            rng: createSeededRandom(deriveSeed(seed, 'nebulae')),
            web: this.web,
            config: this.config
        });
        this.lighting = new UniverseLighting({ config: this.config });
        this.events = new UniverseEvents({
            rng: createSeededRandom(deriveSeed(seed, 'events')),
            config: this.config
        });

        this.group.add(
            this.starField.group,
            ...(this.galaxyInterior ? [this.galaxyInterior.group] : []),
            this.nebulaField.group,
            this.galaxyField.group,
            this.landmarks.group,
            this.events.group,
            this.lighting.group
        );
        this._updateCompatibilityAliases();

        this.spatialIndex = new SpatialIndex({
            cellSize: Math.max(15000, this.config.global.regionRadius / 12)
        });
        this._rebuildIndex();
        this.setVisualGlow(this.visualGlow);
        return this;
    }

    getAttractors() {
        return [
            ...this.landmarks.getAttractors(),
            ...this.galaxyField.getPOIs().map((galaxy) => ({
                type: 'galaxy',
                name: galaxy.name,
                position: galaxy.position,
                mass: galaxy.mass
            }))
        ];
    }

    setRuntimeConfig(config) {
        this.runtimeConfig = { ...this.runtimeConfig, ...config };
        const mapped = mapLegacyRuntimeConfig(this.config, config);
        mergeConfig(this.config, mapped);

        this.starField?.setRuntimeConfig(this.config.stars);
        this.galaxyField?.setRuntimeConfig(this.config.galaxies);
        this.galaxyInterior?.setRuntimeConfig(this.config.galaxyInterior);
        this.landmarks?.setRuntimeConfig(this.config.blackHoles);
        this.nebulaField?.setRuntimeConfig(this.config.nebulae);
        this.lighting?.setRuntimeConfig(this.config.lighting);
        this.events?.setRuntimeConfig(this.config.events);
    }

    setVisualGlow({ sceneGlow = 1, landmarkGlow = 1 } = {}) {
        this.visualGlow = { sceneGlow, landmarkGlow };
        this.landmarks?.setVisualGlow(this.visualGlow);
    }

    setRelativisticState(state) {
        this.starField?.setRelativisticState(state);
    }

    getPOIs(shipPosition = new THREE.Vector3(), limit = 12) {
        const nodes = this.web.nodes.map((node) => ({
            type: 'node',
            name: node.name,
            position: node.position,
            radius: node.radius,
            theme: node.theme,
            isSpawn: node.isSpawn
        }));
        const structures = [
            ...nodes,
            ...this.galaxyField.getPOIs(),
            ...this.landmarks.getPOIs(),
            ...this.nebulaField.getPOIs()
        ]
            .map((poi) => ({ ...poi, distance: shipPosition.distanceTo(poi.position) }))
            .sort((a, b) => a.distance - b.distance);

        const authoredSystems = this.starField.getAuthoredSystemPOIs({ position: shipPosition });
        // Authored systems are player-critical destinations and must consume
        // system slots before the procedural-star quota. With three authored
        // markets, the old 35% quota yielded only two slots in the eight-row
        // navigation computer and silently removed Wayfarer Exchange.
        const starLimit = calculateSystemPoiLimit(limit, authoredSystems.length);
        const proceduralStarLimit = Math.max(0, starLimit - authoredSystems.length);
        const stars = proceduralStarLimit > 0
            ? this.starField.getSystemPOIs({
                position: shipPosition,
                limit: proceduralStarLimit,
                maxDistance: this.config.global.regionRadius
            }).filter((star) => !star.isAuthored)
            : [];

        const systemPois = [
            ...authoredSystems,
            ...stars
        ].slice(0, starLimit);
        const structureLimit = Math.max(1, limit - systemPois.length);
        return [...structures.slice(0, structureLimit), ...systemPois]
            .sort((a, b) => a.distance - b.distance)
            .slice(0, limit);
    }

    getAuthoredSystemPOIs(shipPosition = new THREE.Vector3()) {
        return this.starField.getAuthoredSystemPOIs({
            position: shipPosition
        });
    }

    getCounts() {
        if (!this.web) return { ...this._emptyCounts };
        return {
            stars: this.starField.getCounts().stars,
            galaxies: this.galaxyField.galaxies.length,
            blackHoles: this.landmarks.blackHoles.filter((entry) => !entry.isPulsar).length,
            pulsars: this.landmarks.blackHoles.filter((entry) => entry.isPulsar).length,
            anomalies: this.landmarks.anomalies.length,
            nebulae: this.nebulaField.nebulae.length,
            clusters: this.nebulaField.clusters.length,
            nodes: this.web.nodes.length,
            filaments: this.web.filaments.length
        };
    }

    getCurrentNode(shipPosition) {
        return this.web.getCurrentNode(shipPosition);
    }

    getDebugState(shipPosition = new THREE.Vector3()) {
        return {
            seed: this.config.global.seed,
            counts: this.getCounts(),
            currentNode: this.getCurrentNode(shipPosition),
            attractors: this.getAttractors().length,
            authoredSystems: this.getAuthoredSystemPOIs(shipPosition).map((system) => ({
                name: system.name,
                distance: system.distance,
                rpg: system.rpg
            }))
        };
    }

    _rebuildIndex() {
        this.spatialIndex.build([
            ...this.web.nodes.map((node) => ({
                type: 'node',
                name: node.name,
                position: node.position,
                radius: node.radius,
                theme: node.theme
            })),
            ...this.getAttractors(),
            ...this.nebulaField.getPOIs()
        ]);
    }

    _heroLights() {
        return [
            ...this.starField.heroLights,
            ...this.landmarks.getPOIs().filter((poi) => poi.isHeroLight)
        ];
    }

    // Floating-origin rebase: called from App when the ship drifts beyond the
    // precision threshold. Shifts all absolute world-space positions by `offset`
    // so the ship can be placed at (0,0,0) without changing any relative geometry.
    //
    // What moves: web nodes/voids, galaxy meshes + abstract clones, landmark
    // meshes + abstract clones, nebula/cluster mesh positions (which double as
    // the abstract position for POI queries), and the local star layers
    // (near/mid) + their heroLights so they stream past the ship like everything
    // else instead of staying glued to the camera.
    //
    // What stays: the background star layer — it is re-centred on the camera
    // every frame as a quasi-infinite backdrop, so shifting it would be pointless
    // (and immediately overwritten). The dome starfield (SkyDeepSpace) is camera
    // -parented for the same reason and is untouched here.
    rebaseOrigin(offset) {
        this.web.rebaseOrigin(offset);

        // Cheap whole-layer translation: the Float32Array geometry is in layer-
        // local space, so offsetting the Points object keeps every star in sync
        // without touching the buffer. Only near/mid are local; background rides
        // the camera (see StarField.update).
        this.starField.layers.near?.position.sub(offset);
        this.starField.layers.mid?.position.sub(offset);
        for (const light of this.starField.heroLights) light.position.sub(offset);
        this.galaxyInterior?.rebaseOrigin(offset);

        for (const galaxy of this.galaxyField.galaxies) {
            galaxy.position.sub(offset);
            galaxy.points.position.sub(offset);
            galaxy.sprite.position.sub(offset);
        }

        for (const entry of this.landmarks.blackHoles) {
            entry.position.sub(offset);
            entry.blackHole.mesh.position.sub(offset);
            entry.sprite.position.sub(offset);
        }
        for (const entry of this.landmarks.anomalies) {
            entry.position.sub(offset);
            entry.instance.mesh.position.sub(offset);
        }

        for (const nebula of this.nebulaField.nebulae) nebula.position.sub(offset);
        for (const cluster of this.nebulaField.clusters) cluster.position.sub(offset);

        this._rebuildIndex();
    }

    _updateCompatibilityAliases() {
        const firstBlackHole = this.landmarks.blackHoles.find((entry) => !entry.isPulsar) ?? this.landmarks.blackHoles[0];
        const firstAnomaly = this.landmarks.anomalies[0];
        const firstGalaxy = this.galaxyField.galaxies[0];
        this.blackHole = firstBlackHole?.blackHole ?? null;
        this.anomaly = firstAnomaly?.instance ?? null;
        this.galaxy = firstGalaxy?.points ?? firstGalaxy?.sprite ?? null;
    }
}

function flattenRuntimeConfig(config) {
    return {
        starOpacity: config.stars.opacity,
        starBrightness: config.stars.brightness,
        starSize: config.stars.size,
        nebulaOpacity: config.nebulae.opacity,
        nebulaBrightness: config.nebulae.brightness,
        nebulaScale: config.nebulae.scale
    };
}

function mapLegacyRuntimeConfig(current, config) {
    const mapped = {};
    for (const [key, value] of Object.entries(config)) {
        if (key in current && value && typeof value === 'object' && !Array.isArray(value)) {
            mapped[key] = value;
        }
    }

    if ('starOpacity' in config || 'starBrightness' in config || 'starSize' in config) {
        mapped.stars = {
            ...(mapped.stars ?? {}),
            opacity: config.starOpacity ?? current.stars.opacity,
            brightness: config.starBrightness ?? current.stars.brightness,
            size: config.starSize ?? current.stars.size
        };
    }
    if ('nebulaOpacity' in config || 'nebulaBrightness' in config || 'nebulaScale' in config) {
        mapped.nebulae = {
            ...(mapped.nebulae ?? {}),
            opacity: config.nebulaOpacity ?? current.nebulae.opacity,
            brightness: config.nebulaBrightness ?? current.nebulae.brightness,
            scale: config.nebulaScale ?? current.nebulae.scale
        };
    }
    return mapped;
}

function mergeConfig(target, source) {
    for (const [key, value] of Object.entries(source ?? {})) {
        if (value && typeof value === 'object' && !Array.isArray(value) && target[key]) {
            mergeConfig(target[key], value);
        } else {
            target[key] = value;
        }
    }
}
