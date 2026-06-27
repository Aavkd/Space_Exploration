import * as THREE from 'three';
import { Universe } from '../Universe.js';
import { disposeObject3D } from '../universe/dispose.js';
import { deriveSeed } from '../universe/rng.js';
import { SystemContents } from '../universe/SystemContents.js';
import { PlanetaryContents } from '../universe/PlanetaryContents.js';
import { QuadPlanetContents } from '../universe/QuadPlanetContents.js';
import { SCALE_TIERS, DESCENT, buildGalaxyConfig, planetHeroRadius, planetTrueRadius, USE_QUAD_PLANET } from '../../config/scaleTiers.js';
import {
    descentEntryRadiusForTarget,
    LOCKED_TARGET_SEARCH_RADIUS
} from './descentTargeting.js';

// One node in the scale stack (docs/universe-scale-architecture.md §6). A level
// owns a `Universe` as its contents, its own local floating-origin frame, and
// the geometry of its boundary shells. The same wrapper serves every tier; the
// only differences are seed, config, scale, and which child objects you can
// descend into.
export class Level {
    constructor({ tier, name, universe, seed, unitScale = 1, exitRadius = Infinity, breadcrumb = null, entryPosition = null }) {
        this.tier = tier;
        this.name = name;
        this.universe = universe;
        this.seed = seed;
        this.unitScale = unitScale;
        this.exitRadius = exitRadius;

        // The level centre, expressed in this level's *current* (rebased) frame.
        // Starts at the origin; the floating-origin rebase shifts it alongside
        // the contents so "distance from centre" (the exit test) stays correct
        // even as the world streams past a ship pinned near (0,0,0).
        this.origin = new THREE.Vector3();

        // How this level was entered from its parent, captured at descent so the
        // ascent can drop the ship back where it came from, in the parent's frame
        // (§8.5). { position: Vector3 (parent frame), entryRadius: number }.
        this.breadcrumb = breadcrumb;
        this.entryPosition = entryPosition;
    }

    get group() {
        return this.universe.group;
    }

    update(shipPosition, dt, cameraPosition) {
        this.universe.update(shipPosition, dt, cameraPosition);
    }

    // Distance from the ship to this level's centre, used by the exit shell test.
    exitDistance(shipPosition) {
        return shipPosition.distanceTo(this.origin);
    }

    // Shift this level's frame so the ship returns to the origin after a
    // floating-origin rebase. Mirrors Universe.rebaseOrigin for the level centre.
    rebaseOrigin(offset) {
        this.universe.rebaseOrigin(offset);
        this.origin.sub(offset);
    }

    // Objects in this level the ship can descend into, each carrying the seed
    // for its child level (§5). Universe publishes galaxies plus all local
    // field-star systems; Galaxy publishes all local star systems. System is
    // currently a leaf until Planetary ships.
    getDescentCandidates(shipPosition = null, maxRadiusOverride = null, lockedTargetId = null, lockedTargetPosition = null) {
        if (this.tier === SCALE_TIERS.universe.tier) {
            const galaxies = this.universe.galaxyField.getPOIs().map((galaxy) => {
                const candidate = {
                    id: galaxy.name,
                    kind: 'galaxy',
                    // Live reference: rebased in lockstep with the rest of the universe,
                    // so it is always valid in the current frame.
                    position: galaxy.position,
                    radius: galaxy.radius,
                    entryRadius: THREE.MathUtils.clamp(
                        galaxy.radius * DESCENT.entryRadiusScale,
                        DESCENT.entryRadiusMin,
                        DESCENT.entryRadiusMax
                    ),
                    descriptor: galaxy.descriptor,
                    childSeed: galaxy.descriptor?.seed ?? deriveSeed(this.seed, `galaxy:${galaxy.name}`)
                };
                candidate.entryRadius = descentEntryRadiusForTarget(
                    candidate,
                    candidate.entryRadius,
                    lockedTargetId,
                    lockedTargetPosition
                );
                return candidate;
            });

            const fieldSystems = this.universe.starField.getSystemPOIs({
                position: shipPosition,
                maxDistance: lockedTargetId !== null
                    ? LOCKED_TARGET_SEARCH_RADIUS
                    : (maxRadiusOverride ?? DESCENT.systemEntryRadiusMax)
            }).map((star) => createSystemCandidate({
                star,
                parentSeed: this.seed,
                lockedTargetId,
                lockedTargetPosition
            }));

            return [...galaxies, ...fieldSystems];
        }

        if (this.tier === SCALE_TIERS.galaxy.tier) {
            return this.universe.starField.getSystemPOIs({
                position: shipPosition,
                maxDistance: lockedTargetId !== null
                    ? LOCKED_TARGET_SEARCH_RADIUS
                    : (maxRadiusOverride ?? DESCENT.systemEntryRadiusMax)
            }).map((star) => createSystemCandidate({
                star,
                parentSeed: this.seed,
                lockedTargetId,
                lockedTargetPosition
            }));
        }

        // Inside a System: the planets are the descent objects. SystemContents
        // builds each candidate (seed-derived descriptor + entry shell) since it
        // owns the live, orbiting planet positions.
        if (this.tier === SCALE_TIERS.system.tier) {
            return this.universe.getDescentCandidates?.(shipPosition ?? new THREE.Vector3(), maxRadiusOverride) ?? [];
        }

        // Planetary is currently a leaf (Tier 4 Surface/EVA is deferred — see
        // PlanetaryContents). Descend stops here; ascend still works.
        return [];
    }

    dispose() {
        disposeObject3D(this.universe.group);
        this.universe.group.clear();
    }
}

function createSystemCandidate({ star, parentSeed, lockedTargetId = null, lockedTargetPosition = null }) {
    const candidate = {
        id: star.name,
        kind: 'system',
        position: star.position,
        radius: star.radius,
        color: star.color,
        temperatureK: star.temperatureK,
        luminosity: star.luminosity,
        isAuthored: Boolean(star.isAuthored),
        rpg: star.rpg ? { ...star.rpg } : null,
        entryRadius: THREE.MathUtils.clamp(
            (star.luminosity ?? 1) * DESCENT.systemEntryRadiusScale,
            DESCENT.systemEntryRadiusMin,
            DESCENT.systemEntryRadiusMax
        ),
        childSeed: star.childSeed ?? deriveSeed(parentSeed, `system:${star.name}`)
    };
    candidate.entryRadius = descentEntryRadiusForTarget(
        candidate,
        candidate.entryRadius,
        lockedTargetId,
        lockedTargetPosition
    );
    return candidate;
}

// Adopt an already-built root Universe as the tier-0 level (so all of App's
// existing wiring — gravity, navigation, XR halos — keeps its references).
export function createRootLevel(universe) {
    return new Level({
        tier: SCALE_TIERS.universe.tier,
        name: SCALE_TIERS.universe.name,
        universe,
        seed: universe.config.global.seed,
        unitScale: SCALE_TIERS.universe.unitScale,
        exitRadius: SCALE_TIERS.universe.exitRadius
    });
}

// Generate a galaxy level purely from a descent candidate's seed (§5). `breadcrumb`
// records where, in the parent frame, the ship descended from so it can be
// restored on ascent.
export function createGalaxyLevel(candidate, baseConfig) {
    const tierDef = SCALE_TIERS.galaxy;
    const config = buildGalaxyConfig(baseConfig, { seed: candidate.childSeed, descriptor: candidate.descriptor });
    const universe = new Universe({ config, seed: candidate.childSeed });
    // Scenic standoff instead of spawning blind at the galaxy core (audit 6a).
    // The interior disk lies in the XZ plane (its normal is +Y), so lift the ship
    // above the plane and pull it back along +Z: from here the spiral arms /
    // elliptical bulge are framed in view on arrival rather than swallowed by the
    // uniform haze at (0,0,0). ~0.67 x regionRadius out, comfortably inside the
    // 130k exit shell so it does not immediately ascend.
    const regionRadius = tierDef.regionRadius;
    const entryPosition = new THREE.Vector3(0, regionRadius * 0.42, regionRadius * 0.52);
    return new Level({
        tier: tierDef.tier,
        name: candidate.id,
        universe,
        seed: candidate.childSeed,
        unitScale: tierDef.unitScale,
        exitRadius: tierDef.exitRadius,
        entryPosition,
        breadcrumb: {
            id: candidate.id,
            kind: candidate.kind,
            position: candidate.position.clone(),
            entryRadius: candidate.entryRadius
        }
    });
}

export function createSystemLevel(candidate) {
    const tierDef = SCALE_TIERS.system;
    const contents = new SystemContents({
        seed: candidate.childSeed,
        anchor: candidate,
        regionRadius: tierDef.regionRadius
    });
    const spawnDistance = THREE.MathUtils.clamp(
        contents.star.radius * 5.0,
        contents.star.radius * 4.2,
        tierDef.regionRadius * 0.58
    );
    return new Level({
        tier: tierDef.tier,
        name: candidate.id,
        universe: contents,
        seed: candidate.childSeed,
        unitScale: tierDef.unitScale,
        exitRadius: tierDef.exitRadius,
        entryPosition: new THREE.Vector3(0, 0, spawnDistance),
        breadcrumb: {
            id: candidate.id,
            kind: candidate.kind,
            position: candidate.position.clone(),
            entryRadius: candidate.entryRadius
        }
    });
}

// Generate a planet's own level (Tier 3) from a System descent candidate. The
// planet is rebuilt at a heroic, curved-horizon radius (planetHeroRadius); the
// theatre's region/exit shells and the orbital spawn standoff scale from it. The
// ship enters at a scenic standoff so the lit sphere is framed on arrival, then
// it falls under gravity toward the surface.
export function createPlanetaryLevel(candidate) {
    const descriptor = candidate.descriptor;
    // Landable terrestrial worlds are rebuilt at TRUE radius by the continuous-LOD
    // quadtree planet (docs/surface-eva-tier.md §3); gas giants and (flag off) the
    // legacy path keep the heroic-radius hero sphere.
    if (USE_QUAD_PLANET && descriptor.landable && descriptor.kind === 'terrestrial') {
        return createQuadPlanetLevel(candidate);
    }

    const tierDef = SCALE_TIERS.planetary;
    const heroRadius = planetHeroRadius(descriptor.kind, descriptor.systemRadius);
    const regionRadius = THREE.MathUtils.clamp(heroRadius * 3, 120_000, 1_000_000);
    // Tight exit shell: the planet dominates the theatre, so ascend back to the
    // System as soon as the ship pulls a couple of radii clear — leaving should
    // feel quick, not a long climb out (must stay > the spawn standoff for the
    // hysteresis gap).
    const exitRadius = heroRadius * 2.2;

    const contents = new PlanetaryContents({
        seed: candidate.childSeed,
        descriptor,
        regionRadius,
        parentSystem: candidate.parentSystem
    });

    // Spawn where the ship entered: keep the same direction it approached the
    // planet from in the System frame, dropped just above the (now huge) surface
    // so arrival is continuous with the approach rather than a teleport to a
    // canned standoff. Falls back to a scenic angle for scripted/debug descents.
    const approachParent = candidate.approachDir && candidate.approachDir.lengthSq() > 1e-6
        ? candidate.approachDir.clone().normalize()
        : new THREE.Vector3(0, 0.35, 1).normalize();
    const approach = contents.fromParentFrameDirection?.(approachParent.clone()) ?? approachParent;
    const standoff = heroRadius * 1.25;
    const entryPosition = approach.multiplyScalar(standoff);

    return new Level({
        tier: tierDef.tier,
        name: candidate.id,
        universe: contents,
        seed: candidate.childSeed,
        unitScale: tierDef.unitScale,
        exitRadius,
        entryPosition,
        breadcrumb: {
            id: candidate.id,
            kind: candidate.kind,
            position: candidate.position.clone(),
            entryRadius: candidate.entryRadius
        }
    });
}

// Generate a landable terrestrial planet's own level at TRUE radius
// (docs/surface-eva-tier.md §3, §4). Same approach-direction entry as the hero
// path, but the standoff/region/exit shells scale off the true radius (a few ×
// 10^6 m). Precision is held by camera-relative tile origins + float64 state
// inside QuadPlanetContents, so the huge working range is safe (§4).
export function createQuadPlanetLevel(candidate) {
    const tierDef = SCALE_TIERS.planetary;
    const descriptor = candidate.descriptor;
    const trueRadius = planetTrueRadius(descriptor.kind, descriptor.systemRadius);
    const regionRadius = trueRadius * 1.8;
    // Tight exit shell so leaving feels quick once the ship pulls clear, but
    // comfortably outside the spawn standoff for the hysteresis gap.
    const exitRadius = trueRadius * 1.55;

    const contents = new QuadPlanetContents({
        seed: candidate.childSeed,
        descriptor,
        regionRadius,
        parentSystem: candidate.parentSystem
    });

    const approachParent = candidate.approachDir && candidate.approachDir.lengthSq() > 1e-6
        ? candidate.approachDir.clone().normalize()
        : new THREE.Vector3(0, 0.35, 1).normalize();
    const approach = contents.fromParentFrameDirection?.(approachParent.clone()) ?? approachParent;
    // Spawn in low orbit: a fraction of the radius above the surface, so the LOD
    // is already resolving terrain on arrival and gravity draws the ship down.
    const entryPosition = approach.multiplyScalar(trueRadius * 1.18);

    return new Level({
        tier: tierDef.tier,
        name: candidate.id,
        universe: contents,
        seed: candidate.childSeed,
        unitScale: tierDef.unitScale,
        exitRadius,
        entryPosition,
        breadcrumb: {
            id: candidate.id,
            kind: candidate.kind,
            position: candidate.position.clone(),
            entryRadius: candidate.entryRadius
        }
    });
}

export function createChildLevel(candidate, baseConfig) {
    if (candidate.kind === 'galaxy') return createGalaxyLevel(candidate, baseConfig);
    if (candidate.kind === 'system') return createSystemLevel(candidate);
    if (candidate.kind === 'planet') return createPlanetaryLevel(candidate);
    throw new Error(`Unsupported scale descent kind: ${candidate.kind}`);
}
