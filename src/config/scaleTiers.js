import { cloneUniverseConfig } from './universePresets.js';

// Nested scale levels (docs/universe-scale-architecture.md). This first slice
// ships three tiers — Universe (0), Galaxy (1), and System (2) — and proves the
// uniform transition rule + reparent/rescale handoff end to end. Universe and
// Galaxy are rendered by `Universe` instances configured for each tier; System
// is rendered by dedicated star/planet content.
//
// Shell + gate values (§4, §13): descend when inside an object's entry shell
// AND slow (PRECISION); ascend when past the level's exit shell. R_out > R_in
// provides the hysteresis gap that stops boundary flicker.
export const SCALE_TIERS = Object.freeze({
    universe: Object.freeze({
        tier: 0,
        name: 'Universe',
        // The root never ascends, so its exit shell is unbounded.
        exitRadius: Infinity,
        unitScale: 1
    }),
    galaxy: Object.freeze({
        tier: 1,
        name: 'Galaxy',
        // Local working extent of a galaxy level. Stars/nebulae are normalised
        // into this range so float + depth precision stay comfortable (§6).
        regionRadius: 80_000,
        // Fly past this distance from the level centre to ascend back out.
        // Comfortably larger than the populated region for hysteresis.
        exitRadius: 130_000,
        // Same unit meaning as the universe for this slice, so carried velocity
        // is continuous with no rescale (§8.4). Differs once tiers compress gaps.
        unitScale: 1
    }),
    system: Object.freeze({
        tier: 2,
        name: 'System',
        // A compact solar-system theatre: star + planetary orbits remain within
        // the existing camera/floating-origin comfort range while bodies are
        // rendered as true nearby spheres, not billboards.
        regionRadius: 115_000,
        exitRadius: 150_000,
        unitScale: 1
    })
});

// Descent gate: the spool level below which the speed gate is "slow enough" to
// sink into an object instead of blasting past it. Maps onto the hyperdrive
// gears (§4.1) — PRECISION sinks in, HYPERDRIVE flies over.
export const DESCENT = Object.freeze({
    speedGateLevel: 0.2,
    // Entry shell radius for a galaxy, derived from its impostor radius and
    // clamped so tiny/huge galaxies still get a sane, reachable shell.
    entryRadiusMin: 30_000,
    entryRadiusMax: 120_000,
    entryRadiusScale: 3,
    // Star-system entry shells inside a Galaxy level. These are smaller than
    // galaxy shells so precision flight can intentionally sink into a bright
    // nearby star without every star grabbing the ship at cruise speed.
    systemEntryRadiusMin: 30,
    systemEntryRadiusMax: 90,
    systemEntryRadiusScale: 45
});

// Build a full universe config for a galaxy level, seeded from the descended
// galaxy so the level we ENTER is reproducible from the impostor we SAW (§5).
// Derived from the active base config so live universe tweaks (brightness,
// glow...) carry inward, then overridden for an "inside a galaxy" feel:
// denser nearby stars, more nebulae, only a few faint distant galaxies as
// backdrop rather than a full extragalactic field.
export function buildGalaxyConfig(baseConfig, { seed, descriptor = null }) {
    const config = cloneUniverseConfig(baseConfig);
    config.global.seed = seed;
    config.global.scaleTier = SCALE_TIERS.galaxy.tier;
    config.global.parentGalaxy = descriptor;
    config.global.regionRadius = SCALE_TIERS.galaxy.regionRadius;
    config.global.masterDensity = 1.4;
    config.global.nodeCount = 9;
    config.global.filamentStrength = 1.1;
    config.global.voidScatter = 0.05;

    Object.assign(config.stars, {
        nearCount: 9_800,
        midCount: 32_000,
        bgCount: 48_000,
        brightness: Math.max(config.stars.brightness * 0.5, 2.6),
        size: config.stars.size * 0.9,
        bloom: Math.min(config.stars.bloom ?? 1, 0.58)
    });

    Object.assign(config.galaxies, {
        // Tiny distant galaxies as backdrop only; never local pull/POI targets
        // inside the galaxy we just entered.
        count: 4,
        spawnGuarantee: 0,
        backdropOnly: true,
        minDistanceFromOrigin: SCALE_TIERS.galaxy.regionRadius * 0.72,
        opacity: config.galaxies.opacity * 0.34,
        brightness: config.galaxies.brightness * 0.48,
        bloom: Math.min(config.galaxies.bloom ?? 1, 0.42),
        maxGlow: 0.58,
        sizeMin: 700,
        sizeMax: 2600
    });

    Object.assign(config.nebulae, {
        nebulaCount: 14,
        clusterCount: 24,
        opacity: config.nebulae.opacity * 0.68,
        brightness: config.nebulae.brightness * 0.48,
        bloom: Math.min(config.nebulae.bloom ?? 1, 0.52)
    });

    Object.assign(config.blackHoles, {
        blackHoleCount: 3,
        pulsarCount: 2,
        anomalyCount: 8
    });

    config.galaxyInterior = {
        enabled: true,
        descriptor,
        regionRadius: SCALE_TIERS.galaxy.regionRadius,
        opacity: 0.26,
        brightness: 0.78,
        bloom: 0.42,
        gasOpacity: 0.22,
        gasBrightness: 0.72,
        gasBloom: 0.28,
        particleCount: 9200,
        gasCount: 1250,
        hiiCount: 150
    };

    return config;
}
