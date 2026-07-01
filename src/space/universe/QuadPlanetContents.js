import * as THREE from 'three';
import { planetPalette } from './PlanetBody.js';
import { planetTrueRadius, QUAD_PLANET } from '../../config/scaleTiers.js';
import { createSeededRandom, deriveSeed, randomRange } from './rng.js';
import { createPlanetSurfaceModel, normalizePlanetDescriptor, paletteToLegacyArray } from './planetPresets.js';
import { CubeSphereQuadTree } from './CubeSphereQuadTree.js';
import { GroundCoverManager } from './GroundCoverManager.js';
import {
    atmosphereUniforms,
    buildProjectedSystemSky,
    childFrameQuaternion,
    evaluateParentSystemSnapshot,
    parentFrameQuaternion,
    parentToPlanetLocalDirection,
    planetLocalToParentDirection,
    projectedSkyTelemetry,
    updateProjectedSystemSky
} from './ParentSystemProjection.js';
import {
    directionFromLatLon,
    findSurfacePoisForPlanet
} from '../../rpg/surfaceOutposts.js';
import {
    SURFACE_COMBAT_SITE_ID,
    isSurfaceCombatLineClear
} from '../../rpg/surfaceCombat.js';

// --- Tier 3 rework / Tier 4: true-radius quadtree planet ------------------
//
// The content of a single LANDABLE TERRESTRIAL planet's own level, rendered at
// TRUE radius (a few × 10^6 m) by a continuous-LOD cube-sphere quadtree
// (docs/surface-eva-tier.md §3). Replaces the hero-sphere `PlanetaryContents`
// for these worlds (gas giants keep the hero sphere). Implements the same
// Universe-compatible surface (update / getPOIs / getAttractors / rebaseOrigin /
// getCounts / getCurrentNode / setRuntimeConfig / setVisualGlow /
// setRelativisticState) plus the landing API (collideShip / getLandingState /
// gravityReach), so `ScaleStack` + `App` treat it like any other active level.
//
// THIS SLICE delivers §4 — true-radius rendering PRECISION — which is the
// make-or-break foundation everything else (streaming, landing, EVA) sits on:
//
//   • Camera-relative tile origins. The quadtree stores each tile's vertices
//     relative to the tile's own surface centre (small numbers). Every frame the
//     tiles are anchored at the camera's world position and offset by
//     (planetCentre + tileOrigin − camera) computed in float64, so what reaches
//     the GPU is always near the origin — never absolute planet-scale coords.
//   • Authoritative state in planet-centred float64. `_centerScene` (a THREE
//     Vector3 = float64) is the planet centre in the active scene frame; ship and
//     camera positions are differenced against it for altitude/gravity/collision.
//   • Logarithmic depth buffer (already enabled in App) — the tile material opts
//     into it so a 0.1 m near plane and a multi-thousand-km horizon coexist.
//
// `runJitterTest()` verifies all three numerically (the "flat-horizon jitter
// test at altitude and on the ground"): it pushes a fixed surface point through
// the real float32 placement math under camera-relative vs naive-absolute
// schemes and reports the residual error in metres.
//
// DEFERRED to later phases (§8, §14): fine-octave surface detail,
// atmosphere/biome polish, and on-foot EVA. The coarse height term, precision
// pass, async tile streamer, and ship-vs-terrain contact are the foundation
// those build on.

const FALLBACK_SHIP_CLEARANCE = 2.8; // origin-to-landing-footprint fallback
const LANDED_SPEED = 12;       // |v| below which contact reads as "landed"
const GROUND_FRICTION = 2.4;   // tangential damping while touching down (per second)
const LANDING_EPSILON = 0.25;  // telemetry tolerance around the hull clearance
const NORMAL_SAMPLE_METRES = 80;
const TOUCHDOWN_ALIGN_RATE = 7.5;
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
const LOCAL_FORWARD = new THREE.Vector3(0, 0, -1);
const LOCAL_RIGHT = new THREE.Vector3(1, 0, 0);
const SHIP_CLEARANCE_EXPORT = FALLBACK_SHIP_CLEARANCE;
const SKY_DISTANCE_SCALE = 2.7;

const froundV = (v) => new THREE.Vector3(Math.fround(v.x), Math.fround(v.y), Math.fround(v.z));
// float32 add of two vectors (operands rounded, sum rounded) — mimics the GPU.
const f32add = (a, b) => new THREE.Vector3(
    Math.fround(a.x + b.x), Math.fround(a.y + b.y), Math.fround(a.z + b.z)
);

export class QuadPlanetContents {
    constructor({ seed, descriptor, regionRadius, parentSystem = null }) {
        this.seed = seed;
        this.descriptor = normalizePlanetDescriptor(descriptor);
        this.parentSystem = parentSystem;
        this.kind = this.descriptor?.kind ?? 'terrestrial';
        this.type = this.descriptor?.type ?? 'temperate';
        this.landable = Boolean(this.descriptor?.landable);
        this.name = this.descriptor?.name ?? 'Unnamed world';

        this.radius = planetTrueRadius(this.kind, this.descriptor?.systemRadius ?? 1200);
        // The planetary theatre. region/exit shells are derived from this in
        // Level.createPlanetaryLevel; this is a sane fallback if constructed bare.
        this.regionRadius = regionRadius ?? this.radius * 1.6;
        this.palette = this.descriptor?.palette ?? planetPalette(this.kind, 0);
        this.paletteArray = this.descriptor?.paletteArray ?? (Array.isArray(this.palette) ? this.palette : paletteToLegacyArray(this.palette));

        this.group = new THREE.Group();
        this.group.name = `QuadPlanet:${this.name}`;
        this.runtimeConfig = {};
        this.visualGlow = { sceneGlow: 1, landmarkGlow: 1 };

        // Planet centre in the ACTIVE SCENE FRAME (float64, the source of truth).
        // Starts at the scene origin — ScaleStack drops the planet centre there on
        // descent (child.origin = 0) and spawns the ship at a standoff. The
        // floating-origin rebase then shifts this in lockstep with the world.
        this._centerScene = new THREE.Vector3();

        const rng = createSeededRandom(deriveSeed(seed, 'planetary'));
        // Seeded, fixed sun direction → a clear day/night terminator (a strong
        // "real lit sphere" cue, §6 of the architecture doc).
        this.sunDir = new THREE.Vector3(
            randomRange(rng, -1, 1),
            randomRange(rng, 0.15, 0.7),
            randomRange(rng, -1, 1)
        ).normalize();
        this.sunColor = new THREE.Color('#fff2d6');
        if (this.parentSystem?.star?.color) this.sunColor.set(this.parentSystem.star.color);

        this.basis = createPlanetSurfaceModel(this.descriptor, {
            seed,
            radius: this.radius
        });
        this.groundCover = new GroundCoverManager({
            seed,
            surface: this.basis
        });

        this._material = this._createTileMaterial();
        this.quadtree = new CubeSphereQuadTree({
            basis: this.basis,
            palette: this.palette,
            material: this._material,
            tileRes: QUAD_PLANET.tileRes,
            errorThreshold: QUAD_PLANET.errorThreshold,
            maxDepth: QUAD_PLANET.maxDepth,
            skirtFraction: QUAD_PLANET.skirtFraction,
            streamingBudgetMs: QUAD_PLANET.streamingBudgetMs,
            cacheTiles: QUAD_PLANET.cacheTiles,
            decorateTile: (node, mesh, origin) => this.groundCover.decorateTile(node, mesh, origin)
        });
        this.group.add(this.quadtree.group);
        this.water = this._createWaterSurface();
        if (this.water) this.group.add(this.water);
        this.atmosphere = this._createAtmosphere();
        if (this.atmosphere) this.group.add(this.atmosphere);

        // Scratch reused per-frame.
        this._camLocal = new THREE.Vector3();
        this._tmp = new THREE.Vector3();
        this._dir = new THREE.Vector3();
        this._d = new THREE.Vector3();
        this._tan = new THREE.Vector3();
        this._normal = new THREE.Vector3();
        this._u = new THREE.Vector3();
        this._v = new THREE.Vector3();
        this._forward = new THREE.Vector3();
        this._right = new THREE.Vector3();
        this._back = new THREE.Vector3();
        this._basis = new THREE.Matrix4();
        this._targetQuat = new THREE.Quaternion();
        this._pa = new THREE.Vector3();
        this._pb = new THREE.Vector3();
        this._pc = new THREE.Vector3();
        this._pd = new THREE.Vector3();
        this._skyOrigin = new THREE.Vector3();
        this._skyState = {};

        this._time = 0;
        this._lastAltitude = Infinity;
        this._lastClearance = Infinity;
        this._lastShipClearance = FALLBACK_SHIP_CLEARANCE;
        this._contactSpeed = Infinity;
        this._contact = false;
        this._lastLeafCount = 0;
        this._lastMaxDepth = 0;
        this._lastCamera = new THREE.Vector3();
        this.sunLight = this._createSunLight();
        this.group.add(this.sunLight, this.sunLight.target);
        // Sky/ground fill so instanced cover and surface structures (all
        // MeshStandardMaterial) are never rendered as unlit black silhouettes.
        const skyFill = new THREE.Color(this.descriptor?.atmosphere?.color ?? '#8fb6ff')
            .lerp(new THREE.Color('#ffffff'), 0.4);
        this.fillLight = new THREE.HemisphereLight(skyFill, new THREE.Color('#41372c'), 0.85);
        this.fillLight.name = 'PlanetaryHemisphereFill';
        this.group.add(this.fillLight);
        this.systemSky = buildProjectedSystemSky({
            parentSystem: this.parentSystem,
            sunColor: this.sunColor,
            planetScale: 1,
            moonScale: 1
        });
        if (this.systemSky?.group) this.group.add(this.systemSky.group);
        this.surfaceOutposts = this._createSurfaceOutposts();
        this.surfaceOutpost = this.surfaceOutposts[0] ?? null;
        for (const outpost of this.surfaceOutposts) {
            if (outpost.group) this.group.add(outpost.group);
        }
    }

    // Gravity reach the App widens its field to while this level is active, so a
    // true-radius planet still pulls the ship in from the orbital standoff.
    get gravityReach() {
        return this.regionRadius * 1.4;
    }

    // Far plane the App uses for this level: enough to frame the whole limb plus
    // the entry standoff. The log depth buffer keeps the 0.1 m near plane usable
    // alongside it (§4).
    get cameraFar() {
        return this.radius * QUAD_PLANET.cameraFarScale;
    }

    // World height (radius from planet centre) of the solid surface in unit
    // direction `dir`. Coarse term only this slice; fine octaves on deep tiles are
    // deferred (§3.2). Drives BOTH the tile mesh and collision, so what you see is
    // what you touch.
    heightAt(dir) {
        return this.basis.surfaceRadiusAt(dir);
    }

    getRegions() {
        return this.basis.getRegions();
    }

    getRegion(regionId) {
        return this.basis.getRegion(regionId);
    }

    regionAt(dir) {
        return this.basis.regionAt(dir);
    }

    findRegions(query = {}) {
        return this.basis.findRegions(query);
    }

    resolveRegionPlacement(regionId, options = {}) {
        return this.basis.resolveRegionPlacement(regionId, options);
    }

    teleportShipToRegion(ship, regionId, metres = 1000, options = {}) {
        if (!ship?.position?.isVector3) {
            throw new TypeError('teleportShipToRegion requires a ship with a Vector3 position');
        }
        const placement = this.resolveRegionPlacement(regionId, options);
        ship.position.copy(this._centerScene).addScaledVector(
            new THREE.Vector3().fromArray(placement.direction),
            placement.height + Math.max(0, metres)
        );
        ship.velocity?.set?.(0, 0, 0);
        return placement;
    }

    getRegionWeather(regionId) {
        return this.basis.getRegionWeather(regionId);
    }

    toggleGroundCover(enabled) {
        return this.groundCover.setEnabled(enabled);
    }

    toggleWater(enabled) {
        if (!this.water) return false;
        this.water.visible = Boolean(enabled);
        return this.water.visible;
    }

    getCoverState() {
        return this.groundCover.getState(this.quadtree.leaves);
    }

    getWaterState() {
        return {
            available: Boolean(this.water),
            enabled: Boolean(this.water?.visible),
            radius: this.water ? this.radius + 0.35 : null,
            material: this.descriptor.surface?.liquidMaterial ?? 'water'
        };
    }

    get shipClearance() {
        return SHIP_CLEARANCE_EXPORT;
    }

    getSurfaceSample(position, target = null) {
        const out = target ?? {};
        const toPoint = this._d.copy(position).sub(this._centerScene);
        if (toPoint.lengthSq() < 1e-8) toPoint.set(0.42, 0.55, 0.72);
        const dist = toPoint.length();
        const dir = (out.direction ??= new THREE.Vector3()).copy(toPoint).multiplyScalar(1 / dist);
        const surfaceR = this.heightAt(dir);
        const point = (out.point ??= new THREE.Vector3()).copy(this._centerScene).addScaledVector(dir, surfaceR);
        const normal = (out.normal ??= new THREE.Vector3());
        this._surfaceNormalAt(dir, normal);
        const up = (out.up ??= new THREE.Vector3()).copy(dir);
        this.basis.sampleAt(dir, out, { normal });
        out.altitude = dist - surfaceR;
        out.radius = surfaceR;
        out.slopeDeg = THREE.MathUtils.radToDeg(
            Math.acos(THREE.MathUtils.clamp(normal.dot(up), -1, 1))
        );
        out.slope = THREE.MathUtils.degToRad(out.slopeDeg);
        return out;
    }

    projectToSurface(position, clearance = 0, target = new THREE.Vector3()) {
        const sample = this.getSurfaceSample(position);
        return target.copy(this._centerScene).addScaledVector(sample.direction, sample.radius + clearance);
    }

    update(shipPosition, dt, cameraPosition) {
        this._time += (dt ?? 0);
        const camera = cameraPosition ?? shipPosition ?? this._lastCamera;
        this._lastCamera.copy(camera);

        // Camera in planet-LOCAL float64 coords drives LOD selection.
        this._camLocal.copy(camera).sub(this._centerScene);
        this._lastLeafCount = this.quadtree.update(this._camLocal);

        // Feed the terrain shader the local "up" (for hemispheric ambient) and an
        // altitude-faded aerial-perspective strength (full haze near the ground,
        // none from orbit so the limb stays crisp).
        const camDist = Math.max(this._camLocal.length(), 1);
        const altitude = camDist - this.radius;
        this._material.uniforms.uUpDir.value.copy(this._camLocal).multiplyScalar(1 / camDist);
        this._material.uniforms.uFogStrength.value =
            1 - THREE.MathUtils.smoothstep(altitude, 2_000, 42_000);
        if (this.water?.material?.uniforms?.uFogStrength) {
            this.water.material.uniforms.uFogStrength.value = this._material.uniforms.uFogStrength.value;
            this.water.material.uniforms.uTime.value = this._time;
        }

        // Camera-relative placement pass (§4): anchor the tile root at the camera
        // world position, then offset each visible tile by (centre + tileOrigin −
        // camera) in float64. Both quantities are small near the camera, so the
        // float32 model matrices the GPU sees never carry planet-scale magnitudes.
        this.quadtree.group.position.copy(camera);
        let maxDepth = 0;
        for (const leaf of this.quadtree.leaves) {
            this._tmp.copy(this._centerScene).add(leaf.origin).sub(camera);
            leaf.mesh.position.copy(this._tmp);
            if (leaf.depth > maxDepth) maxDepth = leaf.depth;
        }
        if (this.atmosphere) this.atmosphere.position.copy(this._centerScene);
        if (this.water) this.water.position.copy(this._centerScene);
        this._updateSystemLightingAndSky(camera);
        this._lastMaxDepth = maxDepth;
    }

    rebaseOrigin(offset) {
        // The planet centre is a large float64 offset; shift it with the world.
        // Tiles are re-placed camera-relative every frame, so they follow for free
        // — nothing planet-scale is ever statically parented in the scene frame.
        this._centerScene.sub(offset);
        this._updateSurfaceOutpostPlacement();
    }

    // --- Landing (called by App after ship physics each frame) --------------

    collideShip(ship, dt) {
        const toShip = this._d.copy(ship.position).sub(this._centerScene);
        const dist = toShip.length();
        if (dist < 1e-3) return;

        const dir = this._dir.copy(toShip).multiplyScalar(1 / dist);
        const surfaceR = this.heightAt(dir);
        const shipClearance = this._shipClearance(ship);
        const contactR = surfaceR + shipClearance;
        this._lastAltitude = dist - surfaceR;
        this._lastClearance = dist - contactR;

        if (this._lastClearance >= 0) {
            this._contact = false;
            this._contactSpeed = Infinity;
            return;
        }

        ship.position.copy(this._centerScene).addScaledVector(dir, contactR);
        this._lastAltitude = shipClearance;
        this._lastClearance = 0;

        const vel = ship.velocity;
        const radial = vel.dot(dir);
        if (radial < 0) vel.addScaledVector(dir, -radial); // zero the inward component

        // The terrain is a radial height field, so the altitude constraint is
        // radial. Also respect the local surface normal so a fast sideways skim
        // into a mountain face sheds its into-ground component instead of
        // tunnelling through the next frame.
        const normal = this._surfaceNormalAt(dir, this._normal);
        this._alignShipToSurface(ship, normal, dt);
        const intoGround = vel.dot(normal);
        if (intoGround < 0) vel.addScaledVector(normal, -intoGround);

        this._tan.copy(vel).addScaledVector(normal, -vel.dot(normal));
        vel.addScaledVector(this._tan, -Math.min(1, dt * GROUND_FRICTION));
        this._contactSpeed = vel.length();
        this._contact = true;
    }

    getLandingState(shipPosition = null) {
        let altitude = this._lastAltitude;
        let clearance = this._lastClearance;
        const shipClearance = this._lastShipClearance ?? FALLBACK_SHIP_CLEARANCE;
        if (shipPosition) {
            const toShip = this._d.copy(shipPosition).sub(this._centerScene);
            const dist = toShip.length();
            if (dist > 1e-3) {
                const dir = this._dir.copy(toShip).multiplyScalar(1 / dist);
                const surfaceR = this.heightAt(dir);
                altitude = dist - surfaceR;
                clearance = altitude - shipClearance;
            }
        }
        const settled = this._contact && this._contactSpeed <= LANDED_SPEED;
        return {
            tier: 'planetary',
            name: this.name,
            kind: this.kind,
            planetType: this.type,
            canLand: this.landable,
            altitude,
            clearance,
            contact: this._contact,
            contactSpeed: this._contactSpeed,
            landed: this.landable && settled && clearance <= LANDING_EPSILON
        };
    }

    // --- Universe-compatible surface ---------------------------------------

    getAttractors() {
        const surfaceGravity = 8.5; // m/s^2 at the surface; mass ≈ g·R^2 (G=1)
        return [{
            type: 'planet',
            name: this.name,
            position: this._centerScene.clone(),
            mass: surfaceGravity * this.radius * this.radius,
            dangerProfile: {
                type: 'planet',
                lethalRadius: 0,
                heatRadius: this.radius * 0.4,
                tidalRadius: this.radius * 0.2
            }
        }];
    }

    getPOIs(shipPosition = new THREE.Vector3(), limit = 12) {
        const pois = [{
            type: 'planet',
            name: this.name,
            position: this._centerScene.clone(),
            radius: this.radius,
            distance: shipPosition.distanceTo(this._centerScene)
        }];
        for (const surfaceOutpost of this.surfaceOutposts) {
            pois.unshift({
                type: 'surface outpost',
                name: surfaceOutpost.definition.name,
                position: surfaceOutpost.landingPoint.clone(),
                radius: surfaceOutpost.definition.landingRadiusMetres,
                rpg: {
                    namedSystemId: surfaceOutpost.definition.systemId,
                    planetId: surfaceOutpost.definition.planetId,
                    surfacePoiId: surfaceOutpost.definition.id,
                    markerScale: 'planetary'
                }
            });
        }
        return pois
            .map((poi) => ({ ...poi, distance: shipPosition.distanceTo(poi.position) }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, limit);
    }

    getCounts() {
        return {
            stars: 0, planets: 1, galaxies: 0, blackHoles: 0, pulsars: 0,
            anomalies: 0, nebulae: 0, clusters: 0, debrisFields: 0, asteroids: 0,
            ringParticles: 0, moons: 0, nodes: 0, filaments: 0,
            tiles: this._lastLeafCount
        };
    }

    getCurrentNode() {
        return {
            name: this.name,
            theme: `${this.type} terrestrial world (true radius)`,
            radius: this.regionRadius,
            rpg: this.descriptor.rpg ?? null
        };
    }

    getSurfaceInteraction(position) {
        if (!this.surfaceOutposts.length || !position?.isVector3) return null;
        return this.surfaceOutposts
            .map((outpost) => {
                const distance = position.distanceTo(outpost.interactionPoint);
                return {
                    id: outpost.definition.terminalId,
                    surfacePoiId: outpost.definition.id,
                    name: outpost.definition.hostileEncounterId
                        ? 'stolen Index survey core'
                        : `${outpost.definition.name} terminal`,
                    action: outpost.definition.hostileEncounterId
                        ? 'recoverSurfaceCombatObjective'
                        : 'openSurfaceOutpost',
                    distance,
                    radius: outpost.definition.interactionRadiusMetres,
                    available: distance <= outpost.definition.interactionRadiusMetres
                };
            })
            .sort((a, b) => a.distance - b.distance)[0];
    }

    getSurfaceOutpostPlacement(id = null) {
        const outpost = id
            ? this.surfaceOutposts.find((entry) => entry.definition.id === id)
            : this.surfaceOutpost;
        if (!outpost) return null;
        const landingSample = this.getSurfaceSample(outpost.landingPoint);
        const terminalSurface = this.projectToSurface(outpost.interactionPoint, 0, new THREE.Vector3());
        return {
            id: outpost.definition.id,
            planetId: outpost.definition.planetId,
            latitudeDeg: outpost.definition.latitudeDeg,
            longitudeDeg: outpost.definition.longitudeDeg,
            landingPoint: outpost.landingPoint.toArray(),
            terminalPoint: outpost.interactionPoint.toArray(),
            landingSlopeDeg: landingSample.slopeDeg,
            maxLandingSlopeDeg: outpost.definition.maxLandingSlopeDeg,
            landingAlignmentErrorMetres: Math.abs(landingSample.altitude),
            terminalAlignmentErrorMetres: Math.max(
                0,
                outpost.interactionPoint.distanceTo(terminalSurface) - 1.35
            ),
            landingRadiusMetres: outpost.definition.landingRadiusMetres
        };
    }

    isWithinSurfaceOutpostLandingArea(position) {
        return this.isWithinSurfacePoiLandingArea(this.surfaceOutpost?.definition.id, position);
    }

    isWithinSurfacePoiLandingArea(id, position) {
        const outpost = this.surfaceOutposts.find((entry) => entry.definition.id === id);
        return Boolean(
            outpost
            && position?.isVector3
            && position.distanceTo(outpost.landingPoint)
                <= outpost.definition.landingRadiusMetres
        );
    }

    getSurfaceCombatPlacement() {
        const site = this.surfaceOutposts.find((entry) => entry.definition.id === SURFACE_COMBAT_SITE_ID);
        if (!site) return null;
        site.group.updateWorldMatrix(true, true);
        const structures = (site.structureMeshes ?? []).map((mesh) => {
            const box = new THREE.Box3().setFromObject(mesh);
            return { id: mesh.name, min: box.min.toArray(), max: box.max.toArray() };
        });
        const toWorld = (local) => site.group.localToWorld(local.clone()).toArray();
        const objectivePosition = site.interactionPoint.toArray();
        const spawnCandidates = site.spawnCandidatesLocal.map((entry) => ({
            id: entry.id,
            position: toWorld(entry.position),
            radius: entry.radius
        }));
        const patrolPoints = site.patrolPointsLocal.map(toWorld);
        return {
            id: site.definition.id,
            objectivePosition,
            landingPoint: site.landingPoint.toArray(),
            structures,
            spawnCandidates,
            patrolPoints,
            terrainClear: (position, radius) => {
                const sample = this.getSurfaceSample(new THREE.Vector3().fromArray(position));
                return sample.slopeDeg <= site.definition.maxLandingSlopeDeg + 18
                    && sample.altitude >= -Math.max(0.25, radius);
            },
            lineClear: (start, end) => isSurfaceCombatLineClear({
                start,
                end,
                structures,
                terrainBlocked: (left, right) => this._surfaceCombatTerrainBlocked(left, right)
            })
        };
    }

    resolveSurfaceCombatMovement(current, candidate, radius = 0.45) {
        const placement = this.getSurfaceCombatPlacement();
        if (!placement) return candidate;
        const position = candidate.toArray();
        const blocked = placement.structures.some((box) => sphereIntersectsBox(position, radius, box));
        return blocked ? current : candidate;
    }

    getHazardState() {
        return null;
    }

    getDebugState(shipPosition = new THREE.Vector3()) {
        return {
            seed: this.seed,
            counts: this.getCounts(),
            currentNode: this.getCurrentNode(),
            landing: this.getLandingState(shipPosition),
            planet: this.getPlanetState(shipPosition)
        };
    }

    setRuntimeConfig(config = {}) {
        this.runtimeConfig = { ...this.runtimeConfig, ...config };
        const lighting = config.lighting ?? {};
        this._material.uniforms.uSunColor.value.copy(this.sunColor);
        this._material.uniforms.uAmbient.value = THREE.MathUtils.clamp(0.40 + (lighting.ambient ?? 0), 0.30, 0.72);
        if (this.sunLight) {
            this.sunLight.intensity = (lighting.intensity ?? 3.6) * Math.max(0.9, this.parentSystem?.star?.luminosity ?? 1);
        }
    }

    setVisualGlow({ sceneGlow = 1, landmarkGlow = 1 } = {}) {
        this.visualGlow = { sceneGlow, landmarkGlow };
    }

    setRelativisticState() {
        // No starfield warp inside a planetary theatre.
    }

    getParentFrameQuaternion(target = new THREE.Quaternion()) {
        return parentFrameQuaternion(this.parentSystem?.selected, this._time, target);
    }

    getChildFrameQuaternion(target = new THREE.Quaternion()) {
        return childFrameQuaternion(this.parentSystem?.selected, this._time, target);
    }

    fromParentFrameDirection(direction, target = direction) {
        return parentToPlanetLocalDirection(direction, this.parentSystem?.selected, this._time, target);
    }

    toParentFrameDirection(direction, target = direction) {
        return planetLocalToParentDirection(direction, this.parentSystem?.selected, this._time, target);
    }

    // Jump the ship to `metres` altitude above the surface under its current
    // bearing (or a default direction if it sits at the centre), zeroing velocity
    // — a fast way to validate LOD/precision at a chosen altitude (§13).
    teleportShipAltitude(ship, metres = 1000, direction = null) {
        const toShip = this._d.copy(ship.position).sub(this._centerScene);
        if (direction?.isVector3) {
            toShip.copy(direction);
        } else if (toShip.lengthSq() < 1e-6) {
            toShip.set(0.42, 0.55, 0.72);
        }
        const dir = toShip.normalize();
        const shipClearance = this._shipClearance(ship);
        const target = this.heightAt(dir) + shipClearance + Math.max(0, metres);
        ship.position.copy(this._centerScene).addScaledVector(dir, target);
        ship.velocity.set(0, 0, 0);
        this._contact = false;
        this._contactSpeed = Infinity;
        this._lastAltitude = shipClearance + Math.max(0, metres);
        this._lastClearance = Math.max(0, metres);
        return this.getPlanetState(ship.position);
    }

    teleportShipLatLon(ship, latDeg = 0, lonDeg = 0, metres = 1000) {
        const lat = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(latDeg, -89.999, 89.999));
        const lon = THREE.MathUtils.degToRad(lonDeg);
        const cosLat = Math.cos(lat);
        const dir = this._tmp.set(
            cosLat * Math.cos(lon),
            Math.sin(lat),
            cosLat * Math.sin(lon)
        ).normalize();
        const planet = this.teleportShipAltitude(ship, metres, dir);
        return {
            landing: this.getLandingState(ship.position),
            planet
        };
    }

    teleportLandingSite(ship, kind = 'plain', metres = 1000) {
        const site = this.findLandingSite(kind);
        const planet = this.teleportShipAltitude(ship, metres, site.direction);
        return {
            site: { ...site, direction: site.direction.toArray() },
            landing: this.getLandingState(ship.position),
            planet
        };
    }

    findLandingSite(kind = 'plain', samples = 2048) {
        const wantMountain = kind === 'mountain' || kind === 'mountainside';
        let best = null;
        let bestScore = -Infinity;
        const golden = Math.PI * (3 - Math.sqrt(5));

        for (let i = 0; i < samples; i++) {
            const y = 1 - (2 * (i + 0.5)) / samples;
            const r = Math.sqrt(Math.max(0, 1 - y * y));
            const theta = i * golden;
            const dir = this._tmp.set(Math.cos(theta) * r, y, Math.sin(theta) * r).normalize();
            const sample = this.basis.sampleAt(dir, {}, { includeSlope: true });
            const land = sample.land;
            const surfaceR = this.heightAt(dir);
            const slopeDeg = sample.slopeDeg;
            const elevation = sample.elevation;
            const lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)));
            const lon = THREE.MathUtils.radToDeg(Math.atan2(dir.z, dir.x));

            let score;
            if (wantMountain) {
                score = land * 3 + slopeDeg * 0.16 + elevation / Math.max(this.basis.reliefMetres, 1);
                if (land < 0.35) score -= 5;
            } else {
                score = -slopeDeg * 0.35 - Math.abs(land - 0.16) * 2 + (land > 0.02 ? 0.7 : -1.5);
                if (sample.isLiquid) score -= 3.0;
            }

            if (score > bestScore) {
                bestScore = score;
                best = {
                    kind: wantMountain ? 'mountain' : 'plain',
                    direction: dir.clone(),
                    lat,
                    lon,
                    land,
                    biome: sample.biome,
                    material: sample.material,
                    elevation,
                    slopeDeg,
                    surfaceRadius: surfaceR
                };
            }
        }

        return best;
    }

    // --- §13 debug / telemetry surface --------------------------------------

    // Live precision/streaming readout (docs/surface-eva-tier.md §13).
    getPlanetState(shipPosition = null) {
        const ship = shipPosition ?? this._lastCamera;
        const toShip = this._tmp.copy(ship).sub(this._centerScene);
        const dist = toShip.length();
        const dir = this._dir.copy(toShip);
        if (dist > 1e-6) dir.multiplyScalar(1 / dist);
        else dir.set(0.42, 0.55, 0.72).normalize();
        const lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)));
        const lon = THREE.MathUtils.radToDeg(Math.atan2(dir.z, dir.x));
        const tileStats = this.quadtree.getStats();
        const sample = this.basis.sampleAt(dir, {}, { includeSlope: true });
        const regionId = this.regionAt(dir);
        const region = this.getRegion(regionId);
        const altitude = dist - sample.height;
        return {
            name: this.name,
            kind: this.kind,
            planetType: this.type,
            biome: sample.biome,
            regionId,
            regionBiome: region.dominantBiome,
            material: sample.material,
            slopeDeg: sample.slopeDeg,
            elevation: sample.elevation,
            normalizedElevation: sample.normalizedElevation,
            land: sample.land,
            moisture: sample.moisture,
            temperature: sample.temperature,
            radiusTrue: this.radius,
            centreMagnitude: this._centerScene.length(),
            altitude,
            clearance: altitude - (this._lastShipClearance ?? FALLBACK_SHIP_CLEARANCE),
            subShipLat: lat,
            subShipLon: lon,
            surfaceOutpost: this.getSurfaceOutpostPlacement(),
            leafTiles: this._lastLeafCount,
            maxLodDepth: this._lastMaxDepth,
            builtTiles: tileStats.totalBuilt,
            cover: this.getCoverState(),
            water: this.getWaterState(),
            parentSystemSky: projectedSkyTelemetry(this.systemSky, this._skyState),
            ...tileStats
        };
    }

    _createSurfaceOutposts() {
        const rpg = this.descriptor.rpg ?? {};
        const definitions = findSurfacePoisForPlanet({
            systemId: rpg.namedSystemId,
            planetId: rpg.planetId,
            planetIndex: rpg.planetIndex,
            kind: this.kind,
            landable: this.landable
        });
        return definitions.map((definition) => this._createSurfaceOutpost(definition));
    }

    _createSurfaceOutpost(definition) {
        const landingDirection = new THREE.Vector3().fromArray(
            directionFromLatLon(definition.latitudeDeg, definition.longitudeDeg)
        );
        const tangent = new THREE.Vector3().crossVectors(
            Math.abs(landingDirection.y) > 0.92 ? RIGHT : UP,
            landingDirection
        ).normalize();
        const terminalDirection = landingDirection.clone()
            .addScaledVector(tangent, definition.terminalOffsetMetres / this.radius)
            .normalize();
        const landingPoint = this.projectToSurface(landingDirection, 0, new THREE.Vector3());
        const terminalSurfacePoint = this.projectToSurface(terminalDirection, 0, new THREE.Vector3());
        const landingNormal = this.getSurfaceSample(landingPoint).normal.clone();
        const terminalNormal = this.getSurfaceSample(terminalSurfacePoint).normal.clone();
        const landingRotation = new THREE.Quaternion().setFromUnitVectors(UP, landingNormal);
        const terminalRotation = new THREE.Quaternion().setFromUnitVectors(UP, terminalNormal);

        const group = new THREE.Group();
        group.name = `SurfaceOutpost:${definition.id}`;
        group.position.copy(landingPoint);
        group.quaternion.copy(landingRotation);

        const pad = new THREE.Mesh(
            new THREE.CylinderGeometry(18, 18, 0.45, 24),
            new THREE.MeshStandardMaterial({ color: '#263845', metalness: 0.65, roughness: 0.48 })
        );
        pad.name = 'K7LandingPad';
        pad.position.y = 0.2;
        group.add(pad);

        const mast = new THREE.Mesh(
            new THREE.CylinderGeometry(0.55, 0.8, 14, 8),
            new THREE.MeshStandardMaterial({ color: '#668ca0', emissive: '#163c54', emissiveIntensity: 0.5 })
        );
        mast.name = `${definition.id}:mast`;
        mast.position.set(-9, 7, 6);
        group.add(mast);

        const shelter = new THREE.Mesh(
            new THREE.BoxGeometry(12, 5, 8),
            new THREE.MeshStandardMaterial({ color: '#334d5a', metalness: 0.45, roughness: 0.6 })
        );
        shelter.name = `${definition.id}:shelter`;
        shelter.position.set(10, 2.6, 8);
        group.add(shelter);

        const terminal = new THREE.Group();
        terminal.name = definition.terminalId;
        terminal.position.copy(terminalSurfacePoint).sub(landingPoint)
            .applyQuaternion(landingRotation.clone().invert());
        terminal.quaternion.copy(landingRotation.clone().invert().multiply(terminalRotation));
        const pedestal = new THREE.Mesh(
            new THREE.BoxGeometry(1.6, 2.2, 1.2),
            new THREE.MeshStandardMaterial({ color: '#1b3745', metalness: 0.5, roughness: 0.45 })
        );
        pedestal.position.y = 1.1;
        const screen = new THREE.Mesh(
            new THREE.BoxGeometry(1.25, 0.7, 0.08),
            new THREE.MeshBasicMaterial({ color: '#72e8ff' })
        );
        screen.position.set(0, 1.65, -0.63);
        terminal.add(pedestal, screen);
        group.add(terminal);

        const interactionPoint = terminalSurfacePoint.clone().addScaledVector(terminalNormal, 1.35);
        const coverMeshes = [];
        const structureMeshes = definition.id === SURFACE_COMBAT_SITE_ID
            ? [mast, shelter, terminal]
            : [];
        const spawnCandidatesLocal = [];
        const patrolPointsLocal = [];
        if (definition.id === SURFACE_COMBAT_SITE_ID) {
            screen.material.color.set('#ff735f');
            const objectiveLocal = terminal.position.clone();
            const planar = new THREE.Vector3(objectiveLocal.x, 0, objectiveLocal.z).normalize();
            const side = new THREE.Vector3(-planar.z, 0, planar.x);
            const coverSpecs = [
                { id: 'BlackCacheCoverA', along: 0.48, side: 8, width: 9 },
                { id: 'BlackCacheCoverB', along: 0.72, side: -8, width: 11 }
            ];
            for (const spec of coverSpecs) {
                const cover = new THREE.Mesh(
                    new THREE.BoxGeometry(spec.width, 2.8, 1.4),
                    new THREE.MeshStandardMaterial({
                        color: '#49383a',
                        metalness: 0.58,
                        roughness: 0.62
                    })
                );
                cover.name = spec.id;
                cover.position.copy(objectiveLocal).multiplyScalar(spec.along)
                    .addScaledVector(side, spec.side);
                cover.position.y = 1.4;
                cover.rotation.y = Math.atan2(planar.x, planar.z);
                group.add(cover);
                coverMeshes.push(cover);
                structureMeshes.push(cover);
            }
            const spawnBase = objectiveLocal.clone().addScaledVector(planar, 10);
            spawnCandidatesLocal.push(
                { id: 'black-cache-spawn-a', position: spawnBase.clone().addScaledVector(side, 10).setY(2.2), radius: 1.2 },
                { id: 'black-cache-spawn-b', position: spawnBase.clone().addScaledVector(side, -10).setY(2.2), radius: 1.2 },
                { id: 'black-cache-spawn-c', position: objectiveLocal.clone().addScaledVector(planar, 16).setY(2.2), radius: 1.2 }
            );
            patrolPointsLocal.push(
                objectiveLocal.clone().addScaledVector(side, 13).setY(2.2),
                objectiveLocal.clone().addScaledVector(side, -13).setY(2.2)
            );
        }
        return {
            definition,
            group,
            landingDirection,
            terminalDirection,
            landingPoint,
            terminalSurfacePoint,
            interactionPoint,
            coverMeshes,
            structureMeshes,
            spawnCandidatesLocal,
            patrolPointsLocal
        };
    }

    _updateSurfaceOutpostPlacement() {
        for (const outpost of this.surfaceOutposts) this._updateOneSurfaceOutpostPlacement(outpost);
    }

    _updateOneSurfaceOutpostPlacement(outpost) {
        const landingPoint = this.projectToSurface(outpost.landingDirection, 0, outpost.landingPoint);
        const terminalSurface = this.projectToSurface(
            outpost.terminalDirection,
            0,
            outpost.terminalSurfacePoint
        );
        const landingNormal = this.getSurfaceSample(landingPoint).normal;
        const terminalNormal = this.getSurfaceSample(terminalSurface).normal;
        const landingRotation = new THREE.Quaternion().setFromUnitVectors(UP, landingNormal);
        const terminalRotation = new THREE.Quaternion().setFromUnitVectors(UP, terminalNormal);
        outpost.group.position.copy(landingPoint);
        outpost.group.quaternion.copy(landingRotation);
        const terminal = outpost.group.getObjectByName(outpost.definition.terminalId);
        terminal.position.copy(terminalSurface).sub(landingPoint)
            .applyQuaternion(landingRotation.clone().invert());
        terminal.quaternion.copy(landingRotation.clone().invert().multiply(terminalRotation));
        outpost.interactionPoint.copy(terminalSurface).addScaledVector(terminalNormal, 1.35);
    }

    _surfaceCombatTerrainBlocked(start, end) {
        const left = new THREE.Vector3().fromArray(start);
        const right = new THREE.Vector3().fromArray(end);
        for (let index = 1; index < 16; index += 1) {
            const point = left.clone().lerp(right, index / 16);
            if (this.getSurfaceSample(point).altitude < 0.15) return true;
        }
        return false;
    }

    _slopeDegrees(dir) {
        const normal = this._surfaceNormalAt(dir, this._normal);
        return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(normal.dot(dir), -1, 1)));
    }

    _surfaceNormalAt(dir, target) {
        const ref = Math.abs(dir.y) < 0.92 ? UP : RIGHT;
        this._u.copy(ref).cross(dir);
        if (this._u.lengthSq() < 1e-10) this._u.set(1, 0, 0).cross(dir);
        this._u.normalize();
        this._v.copy(dir).cross(this._u).normalize();

        const eps = THREE.MathUtils.clamp(NORMAL_SAMPLE_METRES / this.radius, 1e-6, 1e-4);
        this._surfacePoint(this._pa.copy(dir).addScaledVector(this._u, eps).normalize(), this._pa);
        this._surfacePoint(this._pb.copy(dir).addScaledVector(this._u, -eps).normalize(), this._pb);
        this._surfacePoint(this._pc.copy(dir).addScaledVector(this._v, eps).normalize(), this._pc);
        this._surfacePoint(this._pd.copy(dir).addScaledVector(this._v, -eps).normalize(), this._pd);

        const tu = this._pa.sub(this._pb);
        const tv = this._pc.sub(this._pd);
        target.copy(tu).cross(tv).normalize();
        if (target.dot(dir) < 0) target.negate();
        if (!Number.isFinite(target.x)) target.copy(dir);
        return target;
    }

    _surfacePoint(dir, target) {
        return target.copy(dir).multiplyScalar(this.heightAt(dir));
    }

    _shipClearance(ship) {
        const clearance = ship?.getLandingClearance?.() ?? FALLBACK_SHIP_CLEARANCE;
        this._lastShipClearance = clearance;
        return clearance;
    }

    _alignShipToSurface(ship, normal, dt) {
        if (!ship?.object3D || dt <= 0) return;

        this._forward.copy(LOCAL_FORWARD).applyQuaternion(ship.object3D.quaternion);
        this._forward.addScaledVector(normal, -this._forward.dot(normal));
        if (this._forward.lengthSq() < 1e-8) {
            this._forward.copy(LOCAL_RIGHT).applyQuaternion(ship.object3D.quaternion);
            this._forward.addScaledVector(normal, -this._forward.dot(normal));
        }
        if (this._forward.lengthSq() < 1e-8) this._forward.copy(this._u);
        this._forward.normalize();

        this._back.copy(this._forward).negate();
        this._right.copy(normal).cross(this._back);
        if (this._right.lengthSq() < 1e-8) return;
        this._right.normalize();
        this._back.copy(this._right).cross(normal).normalize();
        this._basis.makeBasis(this._right, normal, this._back);
        this._targetQuat.setFromRotationMatrix(this._basis);
        ship.object3D.quaternion.slerp(this._targetQuat, 1 - Math.exp(-TOUCHDOWN_ALIGN_RATE * dt));
    }

    // The flat-horizon jitter test (docs/surface-eva-tier.md §4, §11). For each
    // altitude it places a fixed surface vertex and pushes it through the REAL
    // float32 placement math under two schemes, returning residual error (metres):
    //
    //   • cameraRelative — the §4 scheme: tile anchored at the camera, offset
    //     (centre + tileOrigin − camera) in float64, rounded to float32 last.
    //   • absolute — the naive scheme this mitigates: the tile mesh placed at the
    //     planet centre with its vertices stored in ABSOLUTE planet-local coords
    //     (~R ≈ 6×10⁶ m), which quantize to a ≈0.5 m float32 grid on upload — the
    //     classic "swimming terrain" failure.
    //
    // staticErrorMetres   = |rendered − true| for a representative vertex.
    // rebaseJitterMetres  = how far the rendered point jumps across a 1 km
    //                       floating-origin rebase (the visible "swim"/pop).
    //
    // Expect cameraRelative sub-mm on the ground (and only growing with genuine
    // viewing distance, i.e. always sub-pixel); absolute ~decimetres at every
    // altitude regardless of distance — exactly the failure §4 exists to prevent.
    runJitterTest({ altitudes = [2, 2_000, 150_000] } = {}) {
        const groundDir = new THREE.Vector3(0.42, 0.55, 0.72).normalize();
        const results = altitudes.map((altitude) => this._jitterAt(groundDir, altitude));
        return {
            radiusTrue: this.radius,
            note: 'cameraRelative tracks true viewing distance (sub-pixel); absolute is pinned ~0.5 m by the float32 vertex grid at true radius',
            samples: results
        };
    }

    _jitterAt(groundDir, altitude) {
        const surfaceR = this.heightAt(groundDir);
        // Camera near the scene origin (post-rebase reality: ship/camera pinned
        // near 0). The planet centre is therefore a huge float64 offset.
        const cameraScene = new THREE.Vector3(5, 2, 3);
        const camLocal = groundDir.clone().multiplyScalar(surfaceR + altitude);
        const center = cameraScene.clone().sub(camLocal); // |center| ≈ R + altitude

        // The tile under the camera: its origin is the surface centre point, and a
        // representative vertex sits ~120 m tangential from it. In the §4 scheme
        // the vertex is stored RELATIVE to the tile origin (small); in the naive
        // scheme it is stored in ABSOLUTE planet-local coords (~R).
        const tileOrigin = groundDir.clone().multiplyScalar(surfaceR);
        const tangent = new THREE.Vector3(0, 1, 0).cross(groundDir).normalize();
        const vDir = groundDir.clone().addScaledVector(tangent, 120 / surfaceR).normalize();
        const vertexAbsLocal = vDir.clone().multiplyScalar(this.heightAt(vDir)); // ~R
        const vertexLocal = vertexAbsLocal.clone().sub(tileOrigin);              // small

        const trueWorld = center.clone().add(vertexAbsLocal);

        // §4 scheme: tile anchored at the camera, small camera-relative offset,
        // small tile-relative vertices — every operand near the origin.
        const renderCR = (cam, ctr) => {
            const tileRoot = froundV(cam);
            const meshPos = froundV(this._tmp.copy(ctr).add(tileOrigin).sub(cam));
            const vert = froundV(vertexLocal);
            return f32add(f32add(tileRoot, meshPos), vert);
        };
        // Naive scheme: mesh at the planet centre, vertices at full planet-local
        // magnitude — the ~R vertex coords are what quantize to a coarse grid.
        const renderAbsolute = (ctr) => {
            const meshAbs = froundV(ctr);
            const vert = froundV(vertexAbsLocal);
            return f32add(meshAbs, vert);
        };

        const crBefore = renderCR(cameraScene, center);
        const absBefore = renderAbsolute(center);
        const crStatic = crBefore.distanceTo(trueWorld);
        const absStatic = absBefore.distanceTo(trueWorld);

        // Floating-origin rebase: App shifts everything by the ship's displacement
        // (< 1 km) so the ship returns to (0,0,0). Emulate an 800 m shift.
        const offset = new THREE.Vector3(700, 120, -380);
        const center2 = center.clone().sub(offset);
        const camera2 = cameraScene.clone().sub(offset);
        const trueWorld2 = trueWorld.clone().sub(offset);

        const crAfter = renderCR(camera2, center2);
        const absAfter = renderAbsolute(center2);
        // Residual error after rebase, minus the legitimate shift = the jump.
        const crErrBefore = crBefore.clone().sub(trueWorld);
        const crErrAfter = crAfter.clone().sub(trueWorld2);
        const absErrBefore = absBefore.clone().sub(trueWorld);
        const absErrAfter = absAfter.clone().sub(trueWorld2);

        return {
            altitude,
            cameraRelative: {
                staticErrorMetres: crStatic,
                rebaseJitterMetres: crErrAfter.sub(crErrBefore).length()
            },
            absolute: {
                staticErrorMetres: absStatic,
                rebaseJitterMetres: absErrAfter.sub(absErrBefore).length()
            }
        };
    }

    // --- Construction -------------------------------------------------------

    _createTileMaterial() {
        // Ambient/fog tints derived from the atmosphere so the ground sits in the
        // same light as the sky. Output is authored in display space (no tonemap
        // include), so all lit values are kept in a controlled range here.
        const atmo = new THREE.Color(this.descriptor?.atmosphere?.color ?? '#8fb6ff');
        const skyColor = atmo.clone().lerp(new THREE.Color('#ffffff'), 0.34);
        const groundColor = new THREE.Color('#39322a');
        const fogColor = atmo.clone().lerp(new THREE.Color('#cdd9e6'), 0.32);
        return new THREE.ShaderMaterial({
            side: THREE.FrontSide,
            uniforms: {
                uSunDir: { value: this.sunDir.clone() },
                uSunColor: { value: this.sunColor.clone() },
                uAmbient: { value: 0.42 },
                uSkyColor: { value: skyColor },
                uGroundColor: { value: groundColor },
                uUpDir: { value: new THREE.Vector3(0, 1, 0) },
                uFogColor: { value: fogColor },
                uFogNear: { value: this.radius * 0.0005 },
                uFogFar: { value: this.radius * 0.02 },
                uFogStrength: { value: 0 }
            },
            vertexShader: `
                #include <common>
                #include <logdepthbuf_pars_vertex>
                attribute vec3 aColor;
                attribute vec3 aMaterialData;
                varying vec3 vColor;
                varying vec3 vMaterialData;
                varying vec3 vWorldNormal;
                varying vec3 vViewDir;
                varying float vViewDist;
                void main() {
                    vColor = aColor;
                    vMaterialData = aMaterialData;
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldNormal = normalize(mat3(modelMatrix) * normal);
                    vec3 toCam = cameraPosition - worldPos.xyz;
                    vViewDir = normalize(toCam);
                    vViewDist = length(toCam);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    #include <logdepthbuf_vertex>
                }
            `,
            fragmentShader: `
                #include <common>
                #include <logdepthbuf_pars_fragment>
                varying vec3 vColor;
                varying vec3 vMaterialData;
                varying vec3 vWorldNormal;
                varying vec3 vViewDir;
                varying float vViewDist;
                uniform vec3 uSunDir;
                uniform vec3 uSunColor;
                uniform float uAmbient;
                uniform vec3 uSkyColor;
                uniform vec3 uGroundColor;
                uniform vec3 uUpDir;
                uniform vec3 uFogColor;
                uniform float uFogNear;
                uniform float uFogFar;
                uniform float uFogStrength;
                void main() {
                    vec3 N = normalize(vWorldNormal);
                    vec3 L = normalize(uSunDir);
                    vec3 V = normalize(vViewDir);
                    vec3 albedo = vColor;
                    float rough = clamp(vMaterialData.x, 0.0, 1.0);

                    float ndl = max(dot(N, L), 0.0);
                    float terminator = smoothstep(-0.12, 0.16, dot(N, L));

                    // Hemispheric ambient: sky tint above, warm bounce below.
                    float hemi = clamp(dot(N, normalize(uUpDir)) * 0.5 + 0.5, 0.0, 1.0);
                    vec3 ambient = mix(uGroundColor, uSkyColor, hemi) * uAmbient;

                    vec3 direct = uSunColor * (1.2 * ndl) * terminator;

                    // Crevice/slope self-shadowing from the baked slope angle.
                    float slopeShade = mix(1.0, 0.7, clamp(vMaterialData.z / 55.0, 0.0, 1.0));

                    vec3 color = albedo * (ambient + direct) * slopeShade;

                    // Subtle sun specular, stronger on smooth/wet materials.
                    vec3 H = normalize(L + V);
                    float spec = pow(max(dot(N, H), 0.0), 28.0) * (1.0 - rough) * 0.35 * ndl;
                    color += uSunColor * spec;

                    // Emissive channels (lava, acid) glow through.
                    color += albedo * vMaterialData.y * 1.6;

                    // Aerial perspective: distant ground fades into atmospheric haze
                    // near the surface; disabled at altitude so the limb stays crisp.
                    float fog = uFogStrength * smoothstep(uFogNear, uFogFar, vViewDist);
                    color = mix(color, uFogColor, fog);

                    gl_FragColor = vec4(color, 1.0);
                    #include <logdepthbuf_fragment>
                }
            `
        });
    }

    _createWaterSurface() {
        if (!this.landable || !this.basis.hasWater) return null;
        const isToxic = this.descriptor.surface?.liquidMaterial === 'acid' || this.type === 'toxic';
        const color = new THREE.Color(
            this.descriptor.palette?.water ?? (isToxic ? '#8aa72c' : '#1d5f91')
        );
        const atmo = new THREE.Color(this.descriptor?.atmosphere?.color ?? '#8fb6ff');
        const skyColor = atmo.clone().lerp(new THREE.Color('#ffffff'), 0.4);
        const fogColor = atmo.clone().lerp(new THREE.Color('#cdd9e6'), 0.32);
        // Finer tessellation so the near-camera sea and the horizon line stay
        // smooth rather than reading as a faceted low-poly disc.
        const geometry = new THREE.SphereGeometry(this.radius + 0.35, 192, 96);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: color },
                uSunColor: { value: this.sunColor.clone() },
                uSunDir: { value: this.sunDir.clone() },
                uSkyColor: { value: skyColor },
                uFogColor: { value: fogColor },
                uFogNear: { value: this.radius * 0.0006 },
                uFogFar: { value: this.radius * 0.02 },
                uFogStrength: { value: 0 },
                uToxic: { value: isToxic ? 1 : 0 },
                uTime: { value: 0 }
            },
            vertexShader: `
                #include <common>
                #include <logdepthbuf_pars_vertex>
                varying vec3 vNormalWorld;
                varying vec3 vViewDir;
                varying vec3 vDir;
                varying float vViewDist;
                void main() {
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vNormalWorld = normalize(mat3(modelMatrix) * normal);
                    vec3 toCam = cameraPosition - worldPos.xyz;
                    vViewDir = normalize(toCam);
                    vViewDist = length(toCam);
                    vDir = normalize(position);
                    gl_Position = projectionMatrix * viewMatrix * worldPos;
                    #include <logdepthbuf_vertex>
                }
            `,
            fragmentShader: `
                #include <common>
                #include <logdepthbuf_pars_fragment>
                varying vec3 vNormalWorld;
                varying vec3 vViewDir;
                varying vec3 vDir;
                varying float vViewDist;
                uniform vec3 uColor;
                uniform vec3 uSunColor;
                uniform vec3 uSunDir;
                uniform vec3 uSkyColor;
                uniform vec3 uFogColor;
                uniform float uFogNear;
                uniform float uFogFar;
                uniform float uFogStrength;
                uniform float uToxic;
                uniform float uTime;
                void main() {
                    vec3 N = normalize(vNormalWorld);
                    vec3 L = normalize(uSunDir);
                    vec3 V = normalize(vViewDir);

                    // Animated micro-normal for a living, glinting surface. vDir is a
                    // stable unit coordinate so the ripple phase never swims.
                    float r1 = sin(vDir.x * 520.0 + uTime * 0.7) * cos(vDir.z * 470.0 - uTime * 0.5);
                    float r2 = sin(vDir.y * 610.0 - uTime * 0.4) * cos(vDir.x * 560.0 + uTime * 0.6);
                    vec3 Np = normalize(N + vec3(r1, 0.0, r2) * 0.05);

                    float diff = max(dot(N, L), 0.0);
                    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 4.0);

                    vec3 deep = uColor * (0.32 + diff * 0.42);
                    vec3 skyTint = mix(uColor, uSkyColor, 0.62);
                    vec3 base = mix(deep, skyTint, clamp(fresnel * 0.75, 0.0, 0.75));

                    // Sharp sun glint plus a broader sheen off the rippled normal.
                    vec3 H = normalize(L + V);
                    float ndh = max(dot(Np, H), 0.0);
                    float glint = pow(ndh, 200.0) * 1.7 + pow(ndh, 36.0) * 0.14;
                    vec3 color = base + uSunColor * glint * diff;

                    // Toxic seas glow faintly instead of reflecting sky.
                    color += uColor * uToxic * 0.12;

                    float fog = uFogStrength * smoothstep(uFogNear, uFogFar, vViewDist);
                    color = mix(color, uFogColor, fog);

                    float alpha = mix(0.78, 0.97, clamp(diff + 0.35, 0.0, 1.0));
                    alpha = mix(alpha, 1.0, fog);
                    gl_FragColor = vec4(color, alpha);
                    #include <logdepthbuf_fragment>
                }
            `,
            transparent: true,
            depthWrite: true,
            side: THREE.FrontSide,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = isToxic ? 'AcidSeaLevelSurface' : 'WaterSeaLevelSurface';
        mesh.frustumCulled = false;
        return mesh;
    }

    _createSunLight() {
        const light = new THREE.DirectionalLight(this.sunColor, 4.2 * Math.max(0.9, this.parentSystem?.star?.luminosity ?? 1));
        light.name = 'PlanetaryParentStarLight';
        light.target.name = 'PlanetaryParentStarLightTarget';
        return light;
    }

    _updateSystemLightingAndSky(cameraPosition = this._lastCamera) {
        const state = evaluateParentSystemSnapshot(this.parentSystem, this._time, this._skyState);
        this.sunDir.copy(state.sunDirLocal);
        this._material.uniforms.uSunDir.value.copy(this.sunDir);
        this._material.uniforms.uSunColor.value.copy(this.sunColor);
        if (this.water?.material?.uniforms?.uSunDir) {
            this.water.material.uniforms.uSunDir.value.copy(this.sunDir);
        }
        if (this.atmosphere?.material?.uniforms?.uSunDir) {
            this.atmosphere.material.uniforms.uSunDir.value.copy(this.sunDir);
        }

        const lightDistance = Math.max(this.radius * 0.35, 50_000);
        this.sunLight.position.copy(this._centerScene).addScaledVector(this.sunDir, lightDistance);
        this.sunLight.target.position.copy(this._centerScene);
        this.sunLight.color.copy(this.sunColor);

        if (!this.systemSky) return;
        const skyDistance = this.radius * SKY_DISTANCE_SCALE;
        this._skyOrigin.copy(cameraPosition ?? this._lastCamera);
        updateProjectedSystemSky(this.systemSky, {
            parentSystem: this.parentSystem,
            elapsedTime: this._time,
            skyOrigin: this._skyOrigin,
            skyDistance,
            sunColor: this.sunColor,
            systemState: state,
            occluderCenter: this._centerScene,
            occluderRadius: this.radius
        });
    }

    _selectedSpinAngle() {
        return this._skyState?.selectedSpinAngle ?? 0;
    }

    _createAtmosphere() {
        const atmosphere = this.descriptor?.atmosphere;
        if (!atmosphere || (atmosphere.density ?? 0) <= 0.02) return null;
        const geometry = new THREE.SphereGeometry(this.radius * (1.012 + atmosphere.density * 0.035), 64, 32);
        const horizonUniforms = atmosphereUniforms(atmosphere, this.sunDir);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                ...horizonUniforms,
                uDensity: { value: atmosphere.density ?? 0.35 },
                uRimStrength: { value: atmosphere.rimStrength ?? 1.0 }
            },
            vertexShader: `
                varying vec3 vWorldNormal;
                varying vec3 vViewDir;
                void main() {
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWorldNormal = normalize(mat3(modelMatrix) * normal);
                    vViewDir = normalize(cameraPosition - wp.xyz);
                    gl_Position = projectionMatrix * viewMatrix * wp;
                }
            `,
            fragmentShader: `
                varying vec3 vWorldNormal;
                varying vec3 vViewDir;
                uniform vec3 uColor;
                uniform vec3 uDayColor;
                uniform vec3 uSunsetColor;
                uniform vec3 uNightColor;
                uniform vec3 uSunDir;
                uniform float uDensity;
                uniform float uRimStrength;
                void main() {
                    vec3 N = normalize(vWorldNormal);
                    float rim = pow(1.0 - abs(dot(N, normalize(vViewDir))), 2.4);
                    float sunDot = dot(N, normalize(uSunDir));
                    float day = smoothstep(-0.10, 0.26, sunDot);
                    float sunset = smoothstep(-0.30, 0.04, sunDot) * (1.0 - smoothstep(0.06, 0.34, sunDot));
                    float night = 1.0 - smoothstep(-0.42, -0.06, sunDot);
                    vec3 tint = mix(uNightColor, uDayColor, day);
                    tint = mix(tint, uSunsetColor, sunset * 0.72);
                    float haze = 0.42 + day * 1.18 + night * 0.22;
                    float alpha = rim * haze * uDensity * 0.82;
                    gl_FragColor = vec4(tint * rim * haze * uRimStrength * 1.25, alpha);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            side: THREE.BackSide,
            depthWrite: false
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'QuadPlanetAtmosphere';
        mesh.frustumCulled = false;
        return mesh;
    }

    dispose() {
        this.quadtree.dispose();
        this.groundCover.dispose();
        this._material.dispose();
        if (this.water) {
            this.water.geometry.dispose();
            this.water.material.dispose();
        }
        if (this.atmosphere) {
            this.atmosphere.geometry.dispose();
            this.atmosphere.material.dispose();
        }
        if (this.systemSky) {
            disposeProjectedSky(this.systemSky.group);
        }
    }
}

function disposeProjectedSky(root) {
    root?.traverse?.((object) => {
        object.geometry?.dispose?.();
        object.material?.dispose?.();
    });
}

function sphereIntersectsBox(position, radius, box) {
    let distanceSquared = 0;
    for (let axis = 0; axis < 3; axis += 1) {
        const nearest = Math.max(box.min[axis], Math.min(box.max[axis], position[axis]));
        distanceSquared += (position[axis] - nearest) ** 2;
    }
    return distanceSquared < radius * radius;
}
