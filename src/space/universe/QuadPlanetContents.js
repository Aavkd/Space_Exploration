import * as THREE from 'three';
import { planetPalette } from './PlanetBody.js';
import { planetTrueRadius, QUAD_PLANET } from '../../config/scaleTiers.js';
import { createSeededRandom, deriveSeed, randomRange } from './rng.js';
import { PlanetHeightBasis } from './planetHeightBasis.js';
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
// DEFERRED to later phases (§5, §8, §14): dynamic streaming queue + LRU cache
// (this slice generates tiles synchronously), fine-octave surface detail,
// atmosphere/biome polish, ship landing tuning, and on-foot EVA. The coarse
// height term and the precision pass built here are the seam those build on.

const SHIP_CLEARANCE = 20;     // rest the hull slightly above the ground
const LANDED_SPEED = 12;       // |v| below which contact reads as "landed"
const GROUND_FRICTION = 2.4;   // tangential damping while touching down (per second)

const froundV = (v) => new THREE.Vector3(Math.fround(v.x), Math.fround(v.y), Math.fround(v.z));
// float32 add of two vectors (operands rounded, sum rounded) — mimics the GPU.
const f32add = (a, b) => new THREE.Vector3(
    Math.fround(a.x + b.x), Math.fround(a.y + b.y), Math.fround(a.z + b.z)
);

export class QuadPlanetContents {
    constructor({ seed, descriptor, regionRadius }) {
        this.seed = seed;
        this.descriptor = descriptor;
        this.kind = descriptor?.kind ?? 'terrestrial';
        this.landable = Boolean(descriptor?.landable);
        this.name = descriptor?.name ?? 'Unnamed world';

        this.radius = planetTrueRadius(this.kind, descriptor?.systemRadius ?? 1200);
        // The planetary theatre. region/exit shells are derived from this in
        // Level.createPlanetaryLevel; this is a sane fallback if constructed bare.
        this.regionRadius = regionRadius ?? this.radius * 1.6;
        this.palette = descriptor?.palette ?? planetPalette(this.kind, 0);

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

        this.basis = new PlanetHeightBasis({
            seed,
            radius: this.radius,
            relief: QUAD_PLANET.relief,
            seaLevel: QUAD_PLANET.seaLevel,
            baseFreq: QUAD_PLANET.baseFreq
        });

        this._material = this._createTileMaterial();
        this.quadtree = new CubeSphereQuadTree({
            basis: this.basis,
            palette: this.palette,
            material: this._material,
            tileRes: QUAD_PLANET.tileRes,
            errorThreshold: QUAD_PLANET.errorThreshold,
            maxDepth: QUAD_PLANET.maxDepth,
            skirtFraction: QUAD_PLANET.skirtFraction
        });
        this.group.add(this.quadtree.group);

        // Scratch reused per-frame.
        this._camLocal = new THREE.Vector3();
        this._tmp = new THREE.Vector3();
        this._dir = new THREE.Vector3();
        this._d = new THREE.Vector3();
        this._tan = new THREE.Vector3();

        this._time = 0;
        this._lastAltitude = Infinity;
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
        const surfaceR = this.heightAt(dir) + SHIP_CLEARANCE;
        this._lastAltitude = dist - surfaceR;

        if (this._lastAltitude >= 0) {
            this._contact = false;
            return;
        }

        ship.position.copy(this._centerScene).addScaledVector(dir, surfaceR);

        const vel = ship.velocity;
        const radial = vel.dot(dir);
        if (radial < 0) vel.addScaledVector(dir, -radial); // zero the inward component

        this._tan.copy(vel).addScaledVector(dir, -vel.dot(dir));
        vel.addScaledVector(this._tan, -Math.min(1, dt * GROUND_FRICTION));
        this._contact = true;
    }

    getLandingState(shipPosition = null) {
        let altitude = this._lastAltitude;
        if (shipPosition) {
            const toShip = this._d.copy(shipPosition).sub(this._centerScene);
            const dist = toShip.length();
            if (dist > 1e-3) {
                const dir = this._dir.copy(toShip).multiplyScalar(1 / dist);
                altitude = dist - (this.heightAt(dir) + SHIP_CLEARANCE);
            }
        }
        return {
            tier: 'planetary',
            name: this.name,
            kind: this.kind,
            canLand: this.landable,
            altitude,
            contact: this._contact,
            landed: this.landable && this._contact && altitude < SHIP_CLEARANCE
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
            theme: 'terrestrial world (true radius)',
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
        this._material.uniforms.uAmbient.value = THREE.MathUtils.clamp(0.12 + (lighting.ambient ?? 0), 0.06, 0.4);
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
    teleportShipAltitude(ship, metres = 1000) {
        const toShip = this._d.copy(ship.position).sub(this._centerScene);
        if (toShip.lengthSq() < 1e-6) toShip.set(0.42, 0.55, 0.72);
        const dir = toShip.normalize();
        const target = this.heightAt(dir) + SHIP_CLEARANCE + Math.max(0, metres);
        ship.position.copy(this._centerScene).addScaledVector(dir, target);
        ship.velocity.set(0, 0, 0);
        return this.getPlanetState(ship.position);
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
        return {
            radiusTrue: this.radius,
            centreMagnitude: this._centerScene.length(),
            altitude: dist - this.heightAt(dir),
            subShipLat: lat,
            subShipLon: lon,
            leafTiles: this._lastLeafCount,
            maxLodDepth: this._lastMaxDepth,
            builtTiles: this.quadtree.getStats().builtCount
        };
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
            uniforms: {
                uSunDir: { value: this.sunDir.clone() },
                uSunColor: { value: this.sunColor.clone() },
                uAmbient: { value: 0.14 }
            },
            vertexShader: `
                #include <common>
                #include <logdepthbuf_pars_vertex>
                attribute vec3 aColor;
                varying vec3 vColor;
                varying vec3 vWorldNormal;
                void main() {
                    vColor = aColor;
                    vWorldNormal = normalize(mat3(modelMatrix) * normal);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    #include <logdepthbuf_vertex>
                }
            `,
            fragmentShader: `
                #include <common>
                #include <logdepthbuf_pars_fragment>
                varying vec3 vColor;
                varying vec3 vWorldNormal;
                uniform vec3 uSunDir;
                uniform vec3 uSunColor;
                uniform float uAmbient;
                void main() {
                    float ndl = max(dot(normalize(vWorldNormal), normalize(uSunDir)), 0.0);
                    float day = uAmbient + smoothstep(0.0, 0.25, ndl) * (0.85 + ndl * 0.4);
                    gl_FragColor = vec4(vColor * day * uSunColor, 1.0);
                    #include <logdepthbuf_fragment>
                }
            `
        });
    }

    dispose() {
        this.quadtree.dispose();
        this._material.dispose();
    }
}
