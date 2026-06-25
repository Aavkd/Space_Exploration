import * as THREE from 'three';
import { Universe } from '../Universe.js';
import { disposeObject3D } from '../universe/dispose.js';
import { deriveSeed } from '../universe/rng.js';
import { SystemContents } from '../universe/SystemContents.js';
import { SCALE_TIERS, DESCENT, buildGalaxyConfig } from '../../config/scaleTiers.js';

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
    getDescentCandidates(shipPosition = null, maxRadiusOverride = null) {
        if (this.tier === SCALE_TIERS.universe.tier) {
            const galaxies = this.universe.galaxyField.getPOIs().map((galaxy) => ({
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
            }));

            const fieldSystems = this.universe.starField.getSystemPOIs({
                position: shipPosition,
                maxDistance: maxRadiusOverride ?? DESCENT.systemEntryRadiusMax
            }).map((star) => createSystemCandidate({
                star,
                parentSeed: this.seed
            }));

            return [...galaxies, ...fieldSystems];
        }

        if (this.tier === SCALE_TIERS.galaxy.tier) {
            return this.universe.starField.getSystemPOIs({
                position: shipPosition,
                maxDistance: maxRadiusOverride ?? DESCENT.systemEntryRadiusMax
            }).map((star) => createSystemCandidate({
                star,
                parentSeed: this.seed
            }));
        }

        return [];
    }

    dispose() {
        disposeObject3D(this.universe.group);
        this.universe.group.clear();
    }
}

function createSystemCandidate({ star, parentSeed }) {
    return {
        id: star.name,
        kind: 'system',
        position: star.position,
        radius: star.radius,
        color: star.color,
        temperatureK: star.temperatureK,
        luminosity: star.luminosity,
        entryRadius: THREE.MathUtils.clamp(
            (star.luminosity ?? 1) * DESCENT.systemEntryRadiusScale,
            DESCENT.systemEntryRadiusMin,
            DESCENT.systemEntryRadiusMax
        ),
        childSeed: deriveSeed(parentSeed, `system:${star.name}`)
    };
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
    return new Level({
        tier: tierDef.tier,
        name: candidate.id,
        universe,
        seed: candidate.childSeed,
        unitScale: tierDef.unitScale,
        exitRadius: tierDef.exitRadius,
        breadcrumb: {
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
            position: candidate.position.clone(),
            entryRadius: candidate.entryRadius
        }
    });
}

export function createChildLevel(candidate, baseConfig) {
    if (candidate.kind === 'galaxy') return createGalaxyLevel(candidate, baseConfig);
    if (candidate.kind === 'system') return createSystemLevel(candidate);
    throw new Error(`Unsupported scale descent kind: ${candidate.kind}`);
}
