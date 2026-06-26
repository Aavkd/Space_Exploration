import * as THREE from 'three';
import { planetPalette } from './PlanetBody.js';
import { normalizePlanetDescriptor } from './planetPresets.js';
import { planetHeroRadius } from '../../config/scaleTiers.js';
import { createSeededRandom, deriveSeed, randomRange } from './rng.js';
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

// --- Tier 3 (Planetary / Orbit) -------------------------------------------
//
// The content of a single planet's own level (docs/universe-scale-architecture.md
// §3 tier 3, §6). The planet you saw as a small sphere in the System is rebuilt
// here at a HEROIC radius so the horizon curves believably from low altitude
// (the #1 "feels huge" cue), while staying inside the proven ~10^5 working band
// so float/depth precision hold and the gravity field can actually pull the ship
// down to the surface.
//
// Terrestrial worlds get a procedural heightfield surface you can set the ship
// down on; the SAME JS height function drives both the displaced mesh and the
// collision query (`surfaceRadiusAt`), so what you see is what you land on. Gas
// giants are a cloud deck only — approachable in orbit, no touchdown (§ scope).
//
// It implements the same surface as `Universe` / `SystemContents`
// (update / getPOIs / getAttractors / rebaseOrigin / get*Config) so the
// `ScaleStack` + `App` treat it like any other active level, plus a small
// landing API (`collideShip`, `getLandingState`) the App calls after physics.
//
// DEFERRED — Tier 4 (Surface / EVA): once landed, a further descent into a local
// ground frame (walk/EVA at true 1 m scale) repeats the uniform transition rule.
// `surfaceRadiusAt` + the landing state are the seam that tier will build on;
// `getDescentCandidates` returns [] until it ships.

const SHIP_CLEARANCE = 14;        // rest the hull slightly above the ground plane
const LANDED_SPEED = 9;           // |v| below which contact reads as "landed" (HUD/audio)
const GROUND_FRICTION = 2.4;      // tangential damping while touching down (per second)
const RELIEF = 0.045;             // mountain height as a fraction of planet radius
const SEA_LEVEL = 0.5;            // fbm threshold below which terrain is flat ocean
const TERRAIN_DETAIL = 6;         // icosphere subdivisions (20 * 4^6 ≈ 82k tris)
const BASE_FREQ = 2.2;            // continent-scale noise frequency
const SKY_DISTANCE_SCALE = 2.65;

export class PlanetaryContents {
    constructor({ seed, descriptor, regionRadius, parentSystem = null }) {
        this.seed = seed;
        this.descriptor = normalizePlanetDescriptor(descriptor);
        this.parentSystem = parentSystem;
        this.kind = this.descriptor?.kind ?? 'terrestrial';
        this.landable = Boolean(this.descriptor?.landable);
        this.name = this.descriptor?.name ?? 'Unnamed world';
        this.regionRadius = regionRadius;

        this.radius = planetHeroRadius(this.kind, this.descriptor?.systemRadius ?? 1200);
        this.palette = this.descriptor?.paletteArray ?? planetPalette(this.kind, 0);

        this.group = new THREE.Group();
        this.group.name = `Planetary:${this.name}`;
        this.runtimeConfig = {};
        this.visualGlow = { sceneGlow: 1, landmarkGlow: 1 };

        this._rng = createSeededRandom(deriveSeed(seed, 'planetary'));
        this._noiseSeed = hashToInt(deriveSeed(seed, 'terrain'));
        this._noiseOffset = new THREE.Vector3(
            randomRange(this._rng, -50, 50),
            randomRange(this._rng, -50, 50),
            randomRange(this._rng, -50, 50)
        );

        // Scratch vectors reused by the per-frame collision query.
        this._c = new THREE.Vector3();
        this._d = new THREE.Vector3();
        this._dir = new THREE.Vector3();
        this._tan = new THREE.Vector3();
        this._skyOrigin = new THREE.Vector3();
        this._skyState = {};

        this.moons = [];
        this._spin = this.kind === 'gas'; // only the non-collidable gas deck spins
        this._time = 0;
        this._lastAltitude = Infinity;
        this._contact = false;

        // A seeded, fixed sunlight direction gives a clear day/night terminator —
        // a strong cue that you are looking at a real, lit sphere (§6).
        this.sunDir = new THREE.Vector3(
            randomRange(this._rng, -1, 1),
            randomRange(this._rng, 0.15, 0.7),
            randomRange(this._rng, -1, 1)
        ).normalize();
        this.sunColor = new THREE.Color('#fff2d6');
        if (this.parentSystem?.star?.color) this.sunColor.set(this.parentSystem.star.color);

        this._create();
    }

    // Gravity reach the App widens its field to while this level is active, so a
    // planet at the centre still pulls a ship out at the orbital standoff (the
    // default 70k field reach is far smaller than a planetary theatre).
    get gravityReach() {
        return this.regionRadius * 1.15;
    }

    update(shipPosition, dt, cameraPosition = shipPosition) {
        this._time += dt;
        if (this._spin && this.body) this.body.rotation.y += dt * 0.02;
        if (this.clouds) this.clouds.rotation.y += dt * 0.012;
        if (this.atmosphere) this.atmosphere.material.uniforms.uTime.value = this._time;
        for (const moon of this.moons) {
            moon.pivot.rotation.y += dt * moon.orbitSpeed;
            moon.mesh.rotation.y += dt * moon.spinSpeed;
        }
        this._updateParentSystemLightingAndSky(cameraPosition ?? shipPosition);
    }

    rebaseOrigin(offset) {
        this.group.position.sub(offset);
    }

    // --- Landing (called by App after ship physics each frame) --------------

    // World radius of the solid (terrestrial) or cloud-deck (gas) surface in the
    // given unit direction from the planet centre. Terrestrial uses the shared
    // fbm height field so the mesh and the collision agree exactly.
    surfaceRadiusAt(dir) {
        if (this.kind !== 'terrestrial') return this.radius * 1.03; // gas cloud deck
        const n = this._fbm(
            dir.x * BASE_FREQ + this._noiseOffset.x,
            dir.y * BASE_FREQ + this._noiseOffset.y,
            dir.z * BASE_FREQ + this._noiseOffset.z
        );
        const land = Math.max(0, n - SEA_LEVEL) / (1 - SEA_LEVEL);
        return this.radius * (1 + RELIEF * land);
    }

    // Resolve ship-vs-surface contact. Pushes a penetrating ship back to the
    // surface and cancels only the INWARD radial velocity, so gravity rests the
    // hull on the ground while outward thrust still lifts off cleanly (no hard
    // "landed" lock that would fight the controls).
    collideShip(ship, dt) {
        const center = this.group.getWorldPosition(this._c);
        const toShip = this._d.copy(ship.position).sub(center);
        const dist = toShip.length();
        if (dist < 1e-3) return;

        const dir = this._dir.copy(toShip).multiplyScalar(1 / dist);
        const surfaceR = this.surfaceRadiusAt(dir) + SHIP_CLEARANCE;
        this._lastAltitude = dist - surfaceR;

        if (this._lastAltitude >= 0) {
            this._contact = false;
            return;
        }

        ship.position.copy(center).addScaledVector(dir, surfaceR);

        const vel = ship.velocity;
        const radial = vel.dot(dir);
        if (radial < 0) vel.addScaledVector(dir, -radial); // zero the inward component

        // Skid friction so the ship settles instead of sliding the surface forever.
        this._tan.copy(vel).addScaledVector(dir, -vel.dot(dir));
        vel.addScaledVector(this._tan, -Math.min(1, dt * GROUND_FRICTION));

        this._contact = true;
    }

    getLandingState(shipPosition = null) {
        let altitude = this._lastAltitude;
        if (shipPosition) {
            const center = this.group.getWorldPosition(this._c);
            const toShip = this._d.copy(shipPosition).sub(center);
            const dist = toShip.length();
            if (dist > 1e-3) {
                const dir = this._dir.copy(toShip).multiplyScalar(1 / dist);
                altitude = dist - (this.surfaceRadiusAt(dir) + SHIP_CLEARANCE);
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
        const center = this.group.getWorldPosition(new THREE.Vector3());
        // mass ≈ targetSurfaceGravity * R^2 (G = 1, gravityScale ≈ 1), so the pull
        // at the surface lands near a playable few m/s^2 (capped by the field).
        const surfaceGravity = this.kind === 'gas' ? 11 : 8.5;
        return [{
            type: 'planet',
            name: this.name,
            position: center,
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
        const center = this.group.getWorldPosition(new THREE.Vector3());
        const pois = [{
            type: this.kind === 'gas' ? 'gas giant' : 'planet',
            name: this.name,
            position: center,
            radius: this.radius
        }];
        for (const moon of this.moons) {
            pois.push({
                type: 'moon',
                name: moon.name,
                position: moon.mesh.getWorldPosition(new THREE.Vector3()),
                radius: moon.radius
            });
        }
        return pois
            .map((poi) => ({ ...poi, distance: shipPosition.distanceTo(poi.position) }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, limit);
    }

    getCounts() {
        return {
            stars: 0,
            planets: 1,
            galaxies: 0,
            blackHoles: 0,
            pulsars: 0,
            anomalies: 0,
            nebulae: 0,
            clusters: 0,
            debrisFields: 0,
            asteroids: 0,
            ringParticles: this.descriptor?.hasRings ? 1 : 0,
            moons: this.moons.length,
            nodes: 0,
            filaments: 0
        };
    }

    getCurrentNode() {
        return {
            name: this.name,
            theme: this.kind === 'gas' ? 'gas giant' : 'terrestrial world',
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
        if (this.sun) {
            this.sun.intensity = (lighting.intensity ?? 3.6) * 1.45 * Math.max(0.9, this.parentSystem?.star?.luminosity ?? 1);
            this.sun.color.copy(this.sunColor);
        }
    }

    setVisualGlow({ sceneGlow = 1, landmarkGlow = 1 } = {}) {
        this.visualGlow = { sceneGlow, landmarkGlow };
        if (this.atmosphere) {
            this.atmosphere.material.uniforms.uIntensity.value = Math.max(0.6, sceneGlow * landmarkGlow);
        }
    }

    setRelativisticState() {
        // No starfield warp inside a planetary theatre.
    }

    getPlanetState(shipPosition = null) {
        const center = this.group.getWorldPosition(this._c);
        const ship = shipPosition ?? center;
        const toShip = this._d.copy(ship).sub(center);
        const dist = toShip.length();
        return {
            name: this.name,
            kind: this.kind,
            radius: this.radius,
            altitude: dist - this.radius,
            parentSystemSky: projectedSkyTelemetry(this.systemSky, this._skyState)
        };
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

    // --- Construction -------------------------------------------------------

    _create() {
        this.body = this.kind === 'terrestrial' ? this._createTerrain() : this._createGasBody();
        this.group.add(this.body);

        this.atmosphere = this._createAtmosphere();
        this.group.add(this.atmosphere);

        if (this.kind === 'terrestrial') {
            this.clouds = this._createClouds();
            this.group.add(this.clouds);
        }
        if (this.descriptor?.hasRings) this.group.add(this._createRings());

        this._createMoons();

        // Sunlight: a real directional light for the ship hull / moons / rings,
        // aligned with the same `sunDir` the terrain shader shades from.
        this.sun = new THREE.DirectionalLight(this.sunColor, 3.0);
        this.sun.position.copy(this.sunDir).multiplyScalar(this.regionRadius);
        this.sun.target.position.set(0, 0, 0);
        this.group.add(this.sun, this.sun.target);

        this.systemSky = buildProjectedSystemSky({
            parentSystem: this.parentSystem,
            sunColor: this.sunColor,
            planetScale: 0.88,
            moonScale: 0.9
        });
        this.group.add(this.systemSky.group);
        this.group.add(this._createBackdrop());
    }

    _createTerrain() {
        const geometry = new THREE.IcosahedronGeometry(this.radius, TERRAIN_DETAIL);
        const position = geometry.attributes.position;
        const colors = new Float32Array(position.count * 3);
        const dir = new THREE.Vector3();
        const color = new THREE.Color();
        const ocean = new THREE.Color(this.palette[0]);
        const land = new THREE.Color(this.palette[1]);
        const high = new THREE.Color(this.palette[2]);
        const ice = new THREE.Color('#dcecff');

        for (let i = 0; i < position.count; i++) {
            dir.set(position.getX(i), position.getY(i), position.getZ(i)).normalize();
            const n = this._fbm(
                dir.x * BASE_FREQ + this._noiseOffset.x,
                dir.y * BASE_FREQ + this._noiseOffset.y,
                dir.z * BASE_FREQ + this._noiseOffset.z
            );
            const landAmt = Math.max(0, n - SEA_LEVEL) / (1 - SEA_LEVEL);
            const r = this.radius * (1 + RELIEF * landAmt);
            position.setXYZ(i, dir.x * r, dir.y * r, dir.z * r);

            if (n < SEA_LEVEL) {
                color.copy(ocean).multiplyScalar(0.55 + n * 0.6);
            } else {
                color.copy(land).lerp(high, THREE.MathUtils.smoothstep(landAmt, 0.45, 1));
            }
            // Polar ice caps by latitude, plus snow on the highest peaks.
            const lat = Math.abs(dir.y);
            const icing = THREE.MathUtils.smoothstep(lat, 0.78, 0.95) + (landAmt > 0.82 ? 0.6 : 0);
            color.lerp(ice, Math.min(0.85, icing));

            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }

        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
        geometry.computeVertexNormals();

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uSunDir: { value: this.sunDir.clone() },
                uSunColor: { value: this.sunColor.clone() },
                uAmbient: { value: 0.38 }
            },
            vertexShader: `
                attribute vec3 aColor;
                varying vec3 vColor;
                varying vec3 vWorldNormal;
                void main() {
                    vColor = aColor;
                    vWorldNormal = normalize(mat3(modelMatrix) * normal);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                varying vec3 vWorldNormal;
                uniform vec3 uSunDir;
                uniform vec3 uSunColor;
                uniform float uAmbient;
                void main() {
                    float ndl = max(dot(normalize(vWorldNormal), normalize(uSunDir)), 0.0);
                    // Soft terminator so the day/night edge is a band, not a line.
                    float skyFill = 0.24 * smoothstep(-0.35, 0.45, dot(normalize(vWorldNormal), normalize(uSunDir)));
                    float day = uAmbient + skyFill + smoothstep(-0.04, 0.42, ndl) * (1.15 + ndl * 0.68);
                    vec3 sunlight = mix(vec3(1.0), uSunColor, 0.72);
                    gl_FragColor = vec4(vColor * day * sunlight, 1.0);
                }
            `
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `Terrain:${this.name}`;
        return mesh;
    }

    _createGasBody() {
        const geometry = new THREE.SphereGeometry(this.radius, 96, 48);
        const a = new THREE.Color(this.palette[0]);
        const b = new THREE.Color(this.palette[1]);
        const c = new THREE.Color(this.palette[2]);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                uA: { value: a }, uB: { value: b }, uC: { value: c },
                uSunDir: { value: this.sunDir.clone() }
            },
            vertexShader: `
                varying vec3 vLocal;
                varying vec3 vWorldNormal;
                void main() {
                    vLocal = position;
                    vWorldNormal = normalize(mat3(modelMatrix) * normal);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec3 vLocal;
                varying vec3 vWorldNormal;
                uniform vec3 uA; uniform vec3 uB; uniform vec3 uC;
                uniform vec3 uSunDir;
                void main() {
                    float lat = normalize(vLocal).y;
                    float bands = sin(lat * 30.0) * 0.5 + 0.5;
                    float storm = smoothstep(0.985, 1.0, sin(vLocal.x * 0.00025 + lat * 8.0));
                    vec3 col = mix(uA, uB, bands);
                    col = mix(col, uC, smoothstep(0.2, 0.5, abs(lat)) * 0.35) + uC * storm * 0.4;
                    float ndl = max(dot(normalize(vWorldNormal), normalize(uSunDir)), 0.0);
                    float skyFill = 0.24 * smoothstep(-0.35, 0.45, dot(normalize(vWorldNormal), normalize(uSunDir)));
                    gl_FragColor = vec4(col * (0.38 + skyFill + smoothstep(-0.04, 0.42, ndl) * (1.1 + ndl * 0.5)), 1.0);
                }
            `
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = `GasBody:${this.name}`;
        return mesh;
    }

    _createAtmosphere() {
        const tint = this.kind === 'gas'
            ? new THREE.Color(this.palette[1]).lerp(new THREE.Color('#ffffff'), 0.2)
            : new THREE.Color('#7fb6ff');
        const geometry = new THREE.SphereGeometry(this.radius * 1.035, 64, 32);
        const horizonUniforms = atmosphereUniforms({ color: `#${tint.getHexString()}`, density: 1 }, this.sunDir);
        const material = new THREE.ShaderMaterial({
            uniforms: {
                ...horizonUniforms,
                uIntensity: { value: 1 },
                uTime: { value: 0 }
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
                uniform float uIntensity;
                void main() {
                    vec3 N = normalize(vWorldNormal);
                    float rim = pow(1.0 - abs(dot(N, normalize(vViewDir))), 3.0);
                    float sunDot = dot(N, normalize(uSunDir));
                    float day = smoothstep(-0.10, 0.26, sunDot);
                    float sunset = smoothstep(-0.30, 0.04, sunDot) * (1.0 - smoothstep(0.06, 0.34, sunDot));
                    float night = 1.0 - smoothstep(-0.44, -0.08, sunDot);
                    vec3 tint = mix(uNightColor, uDayColor, day);
                    tint = mix(tint, uSunsetColor, sunset * 0.68);
                    float haze = 0.42 + day * 1.12 + night * 0.20;
                    gl_FragColor = vec4(tint * rim * haze * uIntensity * 2.0, rim * haze);
                }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            side: THREE.BackSide,
            depthWrite: false
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = 'Atmosphere';
        return mesh;
    }

    _createClouds() {
        const geometry = new THREE.SphereGeometry(this.radius * 1.012, 48, 24);
        const material = new THREE.MeshPhongMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.16,
            depthWrite: false
        });
        const clouds = new THREE.Mesh(geometry, material);
        clouds.name = 'PlanetaryClouds';
        return clouds;
    }

    _createRings() {
        const geometry = new THREE.RingGeometry(this.radius * 1.5, this.radius * 2.5, 128, 8);
        const color = new THREE.Color(this.palette[2] ?? '#d8c38a');
        const material = new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.4,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const rings = new THREE.Mesh(geometry, material);
        rings.name = 'PlanetaryRings';
        rings.rotation.x = Math.PI * 0.5;
        rings.rotation.z = Math.PI * 0.08;
        return rings;
    }

    _createMoons() {
        const count = Math.floor(randomRange(this._rng, 0, this.kind === 'gas' ? 3.99 : 2.99));
        for (let i = 0; i < count; i++) {
            const radius = randomRange(this._rng, this.radius * 0.06, this.radius * 0.16);
            const orbit = randomRange(this._rng, this.radius * 1.8, this.radius * 3.0);
            const pivot = new THREE.Group();
            pivot.rotation.x = randomRange(this._rng, -0.4, 0.4);
            pivot.rotation.y = this._rng() * Math.PI * 2;
            const mesh = new THREE.Mesh(
                new THREE.SphereGeometry(radius, 32, 16),
                new THREE.MeshStandardMaterial({
                    color: new THREE.Color().setHSL(0, 0, randomRange(this._rng, 0.45, 0.72)),
                    roughness: 0.95,
                    metalness: 0
                })
            );
            mesh.position.set(orbit, 0, 0);
            pivot.add(mesh);
            this.group.add(pivot);
            this.moons.push({
                name: `Moon ${i + 1}`,
                radius,
                pivot,
                mesh,
                orbitSpeed: randomRange(this._rng, 0.03, 0.09) * (this._rng() < 0.5 ? -1 : 1),
                spinSpeed: randomRange(this._rng, 0.05, 0.2)
            });
        }
    }

    _updateParentSystemLightingAndSky(cameraPosition = null) {
        const state = evaluateParentSystemSnapshot(this.parentSystem, this._time, this._skyState);
        this.sunDir.copy(state.sunDirLocal);

        this._updateMaterialSun(this.body?.material);
        this._updateMaterialSun(this.clouds?.material);
        if (this.atmosphere?.material?.uniforms?.uSunDir) {
            this.atmosphere.material.uniforms.uSunDir.value.copy(this.sunDir);
        }

        if (this.sun) {
            this.sun.position.copy(this.sunDir).multiplyScalar(this.regionRadius);
            this.sun.color.copy(this.sunColor);
            this.sun.intensity = (this.runtimeConfig.lighting?.intensity ?? 3.6) * 1.45 * Math.max(0.9, this.parentSystem?.star?.luminosity ?? 1);
        }

        if (!this.systemSky) return;
        this._skyOrigin.copy(cameraPosition ?? this.group.getWorldPosition(this._c));
        updateProjectedSystemSky(this.systemSky, {
            parentSystem: this.parentSystem,
            elapsedTime: this._time,
            skyOrigin: this._skyOrigin,
            skyDistance: this.regionRadius * SKY_DISTANCE_SCALE,
            sunColor: this.sunColor,
            systemState: state,
            occluderCenter: this.group.getWorldPosition(this._c),
            occluderRadius: this.radius
        });
    }

    _updateMaterialSun(material) {
        if (material?.uniforms?.uSunDir) material.uniforms.uSunDir.value.copy(this.sunDir);
        if (material?.uniforms?.uSunColor) material.uniforms.uSunColor.value.copy(this.sunColor);
    }

    _createBackdrop() {
        const count = 2400;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const v = new THREE.Vector3();
        const color = new THREE.Color();
        for (let i = 0; i < count; i++) {
            randomUnitVector(this._rng, v).multiplyScalar(this.regionRadius * randomRange(this._rng, 0.85, 0.99));
            positions[i * 3] = v.x;
            positions[i * 3 + 1] = v.y;
            positions[i * 3 + 2] = v.z;
            color.set(this._rng() < 0.72 ? '#d8ecff' : '#ffd7a0').multiplyScalar(randomRange(this._rng, 0.4, 1.1));
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const points = new THREE.Points(geometry, new THREE.PointsMaterial({
            size: this.regionRadius * 0.0012,
            vertexColors: true,
            transparent: true,
            opacity: 0.7,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        }));
        points.name = 'PlanetaryBackdrop';
        points.frustumCulled = false;
        return points;
    }

    // Deterministic value-noise fbm (CPU-only). Drives BOTH the displaced mesh
    // and `surfaceRadiusAt`, so collision matches the visible terrain exactly.
    _fbm(x, y, z) {
        let value = 0;
        let amplitude = 0.5;
        let fx = x, fy = y, fz = z;
        for (let i = 0; i < 5; i++) {
            value += valueNoise(fx, fy, fz, this._noiseSeed) * amplitude;
            fx = fx * 2.03 + 7.1;
            fy = fy * 2.03 + 3.4;
            fz = fz * 2.03 + 5.8;
            amplitude *= 0.5;
        }
        return value; // ~[0,1)
    }
}

function valueNoise(x, y, z, seed) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const uz = fz * fz * (3 - 2 * fz);

    const c000 = latticeHash(ix, iy, iz, seed);
    const c100 = latticeHash(ix + 1, iy, iz, seed);
    const c010 = latticeHash(ix, iy + 1, iz, seed);
    const c110 = latticeHash(ix + 1, iy + 1, iz, seed);
    const c001 = latticeHash(ix, iy, iz + 1, seed);
    const c101 = latticeHash(ix + 1, iy, iz + 1, seed);
    const c011 = latticeHash(ix, iy + 1, iz + 1, seed);
    const c111 = latticeHash(ix + 1, iy + 1, iz + 1, seed);

    const x00 = c000 + (c100 - c000) * ux;
    const x10 = c010 + (c110 - c010) * ux;
    const x01 = c001 + (c101 - c001) * ux;
    const x11 = c011 + (c111 - c011) * ux;
    const y0 = x00 + (x10 - x00) * uy;
    const y1 = x01 + (x11 - x01) * uy;
    return y0 + (y1 - y0) * uz;
}

function latticeHash(ix, iy, iz, seed) {
    let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 1274126177) + Math.imul(seed, 2246822519)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hashToInt(text) {
    let seed = 2166136261;
    for (let i = 0; i < text.length; i++) {
        seed ^= text.charCodeAt(i);
        seed = Math.imul(seed, 16777619);
    }
    return seed >>> 0;
}

function randomUnitVector(rng, target) {
    const z = rng() * 2 - 1;
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    return target.set(Math.cos(a) * r, z, Math.sin(a) * r);
}
