import * as THREE from 'three';
import { planetPalette } from './PlanetBody.js';
import { planetTrueRadius, QUAD_PLANET } from '../../config/scaleTiers.js';
import { createSeededRandom, deriveSeed, randomRange } from './rng.js';
import { createPlanetSurfaceModel, normalizePlanetDescriptor, paletteToLegacyArray } from './planetPresets.js';
import { CubeSphereQuadTree } from './CubeSphereQuadTree.js';

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

const froundV = (v) => new THREE.Vector3(Math.fround(v.x), Math.fround(v.y), Math.fround(v.z));
// float32 add of two vectors (operands rounded, sum rounded) — mimics the GPU.
const f32add = (a, b) => new THREE.Vector3(
    Math.fround(a.x + b.x), Math.fround(a.y + b.y), Math.fround(a.z + b.z)
);

export class QuadPlanetContents {
    constructor({ seed, descriptor, regionRadius }) {
        this.seed = seed;
        this.descriptor = normalizePlanetDescriptor(descriptor);
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

        this.basis = createPlanetSurfaceModel(this.descriptor, {
            seed,
            radius: this.radius
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
            cacheTiles: QUAD_PLANET.cacheTiles
        });
        this.group.add(this.quadtree.group);
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

        this._time = 0;
        this._lastAltitude = Infinity;
        this._lastClearance = Infinity;
        this._lastShipClearance = FALLBACK_SHIP_CLEARANCE;
        this._contactSpeed = Infinity;
        this._contact = false;
        this._lastLeafCount = 0;
        this._lastMaxDepth = 0;
        this._lastCamera = new THREE.Vector3();
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
        this._lastMaxDepth = maxDepth;
    }

    rebaseOrigin(offset) {
        // The planet centre is a large float64 offset; shift it with the world.
        // Tiles are re-placed camera-relative every frame, so they follow for free
        // — nothing planet-scale is ever statically parented in the scene frame.
        this._centerScene.sub(offset);
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
        return [{
            type: 'planet',
            name: this.name,
            position: this._centerScene.clone(),
            radius: this.radius,
            distance: shipPosition.distanceTo(this._centerScene)
        }].slice(0, limit);
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
            radius: this.regionRadius
        };
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
        this._material.uniforms.uAmbient.value = THREE.MathUtils.clamp(0.22 + (lighting.ambient ?? 0), 0.16, 0.48);
    }

    setVisualGlow({ sceneGlow = 1, landmarkGlow = 1 } = {}) {
        this.visualGlow = { sceneGlow, landmarkGlow };
    }

    setRelativisticState() {
        // No starfield warp inside a planetary theatre.
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
        const dir = this._dir.copy(toShip).multiplyScalar(dist > 1e-6 ? 1 / dist : 0);
        const lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)));
        const lon = THREE.MathUtils.radToDeg(Math.atan2(dir.z, dir.x));
        const tileStats = this.quadtree.getStats();
        const sample = this.basis.sampleAt(dir, {}, { includeSlope: true });
        const altitude = dist - sample.height;
        return {
            name: this.name,
            kind: this.kind,
            planetType: this.type,
            biome: sample.biome,
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
            leafTiles: this._lastLeafCount,
            maxLodDepth: this._lastMaxDepth,
            builtTiles: tileStats.totalBuilt,
            ...tileStats
        };
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
        return new THREE.ShaderMaterial({
            side: THREE.DoubleSide,
            uniforms: {
                uSunDir: { value: this.sunDir.clone() },
                uSunColor: { value: this.sunColor.clone() },
                uAmbient: { value: 0.22 }
            },
            vertexShader: `
                #include <common>
                #include <logdepthbuf_pars_vertex>
                attribute vec3 aColor;
                attribute vec3 aMaterialData;
                varying vec3 vColor;
                varying vec3 vMaterialData;
                varying vec3 vWorldNormal;
                varying vec3 vWorldPos;
                void main() {
                    vColor = aColor;
                    vMaterialData = aMaterialData;
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    vWorldPos = worldPos.xyz;
                    vWorldNormal = normalize(mat3(modelMatrix) * normal);
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
                varying vec3 vWorldPos;
                uniform vec3 uSunDir;
                uniform vec3 uSunColor;
                uniform float uAmbient;
                float hash31(vec3 p) {
                    p = fract(p * 0.1031);
                    p += dot(p, p.yzx + 33.33);
                    return fract((p.x + p.y) * p.z);
                }
                void main() {
                    float ndl = max(dot(normalize(vWorldNormal), normalize(uSunDir)), 0.0);
                    float day = uAmbient + smoothstep(0.0, 0.25, ndl) * (0.85 + ndl * 0.4);
                    vec3 cell = floor(vWorldPos * 0.65);
                    float grain = hash31(cell);
                    float rough = clamp(vMaterialData.x, 0.0, 1.0);
                    float micro = mix(0.86, 0.68, rough) + grain * mix(0.18, 0.42, rough);
                    float pebble = smoothstep(0.82, 1.0, grain) * mix(0.06, 0.24, rough);
                    float slopeShade = mix(1.0, 0.78, clamp(vMaterialData.z / 48.0, 0.0, 1.0));
                    vec3 terrainColor = vColor * (micro + pebble) * slopeShade;
                    vec3 emissive = vColor * vMaterialData.y * (1.4 + grain * 0.5);
                    gl_FragColor = vec4(terrainColor * day * uSunColor + emissive, 1.0);
                    #include <logdepthbuf_fragment>
                }
            `
        });
    }

    _createAtmosphere() {
        const atmosphere = this.descriptor?.atmosphere;
        if (!atmosphere || (atmosphere.density ?? 0) <= 0.02) return null;
        const geometry = new THREE.SphereGeometry(this.radius * (1.012 + atmosphere.density * 0.035), 64, 32);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uColor: { value: new THREE.Color(atmosphere.color ?? '#7fb6ff') },
                uSunDir: { value: this.sunDir.clone() },
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
                uniform vec3 uSunDir;
                uniform float uDensity;
                uniform float uRimStrength;
                void main() {
                    vec3 N = normalize(vWorldNormal);
                    float rim = pow(1.0 - abs(dot(N, normalize(vViewDir))), 2.4);
                    float day = 0.28 + 0.72 * max(dot(N, normalize(uSunDir)), 0.0);
                    float alpha = rim * day * uDensity * 0.65;
                    gl_FragColor = vec4(uColor * rim * day * uRimStrength, alpha);
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
        this._material.dispose();
        if (this.atmosphere) {
            this.atmosphere.geometry.dispose();
            this.atmosphere.material.dispose();
        }
    }
}
