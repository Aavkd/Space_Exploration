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
    }),
    planetary: Object.freeze({
        tier: 3,
        name: 'Planetary',
        // A single planet rendered at a heroic, curved-horizon radius (see
        // planetHeroRadius) with its moons/rings. regionRadius and exitRadius are
        // derived per-planet at descent from that radius (createPlanetaryLevel);
        // these are fallbacks. The hero radius stays inside the proven ~10^5
        // working band so float + depth precision are never stressed, and inside
        // gravity reach so the planet actually pulls the ship down (§6, §8).
        regionRadius: 160_000,
        exitRadius: 210_000,
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
    systemEntryRadiusScale: 45,
    // Planet entry shells inside a System level. Derived from the in-system
    // planet radius (small spheres, ~700-4700 units) so precision flight can
    // sink into a specific world the ship is closing on without every planet in
    // the system grabbing it at orbital cruise speed.
    planetEntryRadiusMin: 2_500,
    planetEntryRadiusMax: 14_000,
    planetEntryRadiusScale: 6
});

// Map a planet's small in-system radius (the sphere you SEE while flying the
// System level, ~700-4700 units) onto the heroic radius it is REBUILT at inside
// its own Planetary level (the sphere you LAND on). The hero radius is large
// enough that the horizon curves believably from low altitude (the #1 "feels
// huge" cue, §6) yet stays inside the proven ~10^5 working band and inside the
// gravity field's reach, so precision holds and the planet pulls the ship down.
export function planetHeroRadius(kind, systemRadius = 1200) {
    if (kind === 'gas') return clamp(systemRadius * 55, 180_000, 420_000);
    return clamp(systemRadius * 70, 90_000, 240_000);
}

// --- Tier 3 rework / Tier 4: true-radius quadtree planet ------------------
// (docs/surface-eva-tier.md §3.1, §4). Landable terrestrial worlds are rebuilt
// at a TRUE radius — a few × 10^6 m — large enough that the horizon sits at a
// realistic distance and curvature reads correctly from altitude, while the
// ground is locally flat underfoot. This is far beyond float32 vertex/matrix
// precision, so it is rendered with camera-relative tile origins + float64 CPU
// state + the log depth buffer (§4). The value need not be astronomically real,
// only CONSISTENT (deterministic re-entry).
//
// Mapped off the same in-system radius the hero sphere used, scaled up by ~1e3
// from the heroic ~10^5 band into the true ~10^6 band. Clamped so a tiny moon
// and a super-earth both land in a sane, renderable range.
export function planetTrueRadius(kind, systemRadius = 1200) {
    // Gas giants keep the hero sphere (orbit-only); this is terrestrial-only,
    // but answer sanely if ever asked for a gas radius.
    if (kind === 'gas') return clamp(systemRadius * 5_200, 12_000_000, 36_000_000);
    return clamp(systemRadius * 4_200, 3_000_000, 9_500_000);
}

// Feature flag: route landable terrestrial worlds through the true-radius
// quadtree planet (QuadPlanetContents) instead of the legacy hero sphere
// (PlanetaryContents). Kept as a single switch so the shipped hero-sphere path
// can be restored instantly if the quadtree regresses (docs/surface-eva-tier.md
// §11 risk: true-radius precision is make-or-break).
export const USE_QUAD_PLANET = true;

// Continuous-LOD quadtree tuning (docs/surface-eva-tier.md §3.3, §5). A tile is
// subdivided while its on-sphere edge length, divided by the camera's distance
// to it, exceeds `errorThreshold` (a screen-space-error proxy) — so only quads
// near the ground-track reach deep LOD and the far hemisphere stays coarse.
export const QUAD_PLANET = Object.freeze({
    // Verts per tile edge (grid is tileRes × tileRes quads → (tileRes+1)^2 verts).
    tileRes: 16,
    // Subdivide when (tileEdgeMetres / distanceToCamera) > this. Larger = coarser.
    errorThreshold: 0.95,
    // Hard cap on recursion depth. At R≈6.4e6 m, depth 16 → ~190 m tiles, whose
    // vertices sit within ±100 m of the tile centre — comfortably inside float32
    // precision once the tile is placed camera-relative (§4).
    maxDepth: 17,
    // Skirt drop as a fraction of a tile's edge length: border verts are pulled
    // radially inward to hide cracks between adjacent LOD levels (§3.3). Cheap
    // first cut; geomorph/edge-stitch is deferred (§14).
    skirtFraction: 0.5,
    // Main-thread streaming budget for terrain geometry generation. One tile is
    // allowed to finish even if it slightly exceeds the budget; additional tiles
    // wait for later frames.
    streamingBudgetMs: 2.0,
    // Inactive generated tiles retained for repeated passes before their
    // geometry is disposed.
    cacheTiles: 512,
    // Coarse terrain shape at true radius. Relief is expressed in real metres so
    // a 6-9 Mm planet gets kilometre-scale mountains, not radius-fraction walls.
    // seaLevel = fbm threshold below which the surface is flat ocean;
    // baseFreq = continent-scale noise frequency.
    reliefMetres: 14_000,
    seaLevel: 0.5,
    baseFreq: 2.2,
    detailAmplitude: 260,
    detailFreq: 380,
    localReliefAmplitude: 980,
    localReliefFreq: 980,
    microReliefAmplitude: 110,
    microReliefFreq: 5200,
    // Camera-far multiple of the true radius, so the whole limb + a standoff are
    // inside the frustum. The log depth buffer keeps the 0.1 m near plane usable
    // alongside this (§4).
    cameraFarScale: 4.0
});

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

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

    // Tune the dominant visual mass (the ~90k stars, plus nebulae/HII) to the
    // galaxy's type so an old red elliptical does not share a young blue
    // starfield with a spiral (audit 6b). The seed-carried palette still drives
    // the interior structure; this varies the population on top of it.
    const profile = galaxyTypeProfile(descriptor?.type ?? 'spiral');

    Object.assign(config.stars, {
        nearCount: 9_800,
        midCount: 32_000,
        bgCount: 48_000,
        // Stars are concentrated into the galaxy disk/arms/bulge (galaxyShape), so
        // the per-star brightness that suited the sparse universe now overlaps
        // under additive blending and clips to white — worst in an elliptical's
        // tight bulge. Dim and de-bloom (per-type) so the palette tint survives
        // instead of blowing out.
        brightness: Math.max(config.stars.brightness * 0.42 * profile.brightness, 1.5),
        size: config.stars.size * 0.82,
        bloom: Math.min(config.stars.bloom ?? 1, 0.36),
        // Higher bias = redder/older field, lower = bluer/younger (starColor.js).
        temperatureBias: profile.temperatureBias,
        saturation: clamp01to2(config.stars.saturation * profile.saturation)
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
        nebulaCount: profile.nebulaCount,
        clusterCount: profile.clusterCount,
        opacity: config.nebulae.opacity * profile.nebulaOpacity,
        brightness: config.nebulae.brightness * 0.48,
        bloom: Math.min(config.nebulae.bloom ?? 1, 0.52)
    });

    Object.assign(config.blackHoles, {
        blackHoleCount: 3,
        pulsarCount: 2,
        anomalyCount: 8
    });

    // The interior field (arms, disk, dust, core) is the element that actually
    // carries type + palette, so lift it from a faint haze to the defining
    // feature of the level (audit 6c) — and let HII/gas counts follow type
    // (audit 6b: gas-rich irregulars glow, gas-poor ellipticals stay sparse).
    config.galaxyInterior = {
        enabled: true,
        descriptor,
        regionRadius: SCALE_TIERS.galaxy.regionRadius,
        opacity: 0.52,
        brightness: 1.18,
        bloom: 0.5,
        gasOpacity: 0.4 * profile.gasScale,
        gasBrightness: 1.0,
        gasBloom: 0.34,
        particleScale: 1.5,
        particleCount: 11000,
        gasCount: Math.round(1250 * profile.gasScale),
        hiiCount: profile.hiiCount
    };

    return config;
}

// Clamp a saturation multiplier result into a sane visible band.
function clamp01to2(value) {
    return Math.min(1.7, Math.max(0.45, value));
}

// Per-type tuning of the population that dominates a galaxy interior's look.
// elliptical -> old, red, gas-poor; irregular -> young, blue, gas-rich and
// clumpy; spiral -> mixed population with star-forming arms.
function galaxyTypeProfile(type) {
    switch (type) {
        case 'elliptical':
            return {
                temperatureBias: 0.86,
                saturation: 0.82,
                // Dense compact bulge: dim hard so the overlap reads as a warm
                // glow rather than a blown-out white core.
                brightness: 0.58,
                nebulaCount: 5,
                clusterCount: 12,
                nebulaOpacity: 0.42,
                gasScale: 0.45,
                hiiCount: 26
            };
        case 'irregular':
            return {
                temperatureBias: 0.34,
                saturation: 1.22,
                brightness: 1.0,
                nebulaCount: 22,
                clusterCount: 30,
                nebulaOpacity: 0.9,
                gasScale: 1.45,
                hiiCount: 320
            };
        case 'spiral':
        default:
            return {
                temperatureBias: 0.6,
                saturation: 1.0,
                brightness: 1.0,
                nebulaCount: 16,
                clusterCount: 26,
                nebulaOpacity: 0.68,
                gasScale: 1.0,
                hiiCount: 180
            };
    }
}
