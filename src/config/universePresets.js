const universeDefault = {
    global: {
        seed: 'deep-space-vr-foundation',
        regionRadius: 500000,
        masterDensity: 1,
        nodeCount: 18,
        filamentStrength: 1,
        voidScatter: 0.06,
        themeVariety: 1,
        gravityScale: 1,
        fogDensity: 0.0000015
    },
    stars: {
        enabled: true,
        nearCount: 5000,
        midCount: 25000,
        bgCount: 60000,
        brightness: 2.4,
        size: 8,
        opacity: 1,
        twinkleSpeed: 1,
        temperatureBias: 0.5,
        saturation: 1.1
    },
    galaxies: {
        enabled: true,
        count: 45,
        spiralRatio: 0.5,
        ellipticalRatio: 0.3,
        irregularRatio: 0.2,
        sizeMin: 3000,
        sizeMax: 30000,
        opacity: 0.82,
        brightness: 1,
        rotationSpeed: 1,
        pointSize: 24,
        colorInner: '#88ccff',
        colorOuter: '#ff44cc'
    },
    blackHoles: {
        enabled: true,
        blackHoleCount: 6,
        pulsarCount: 3,
        anomalyCount: 10,
        bloomIntensity: 1.6,
        distortion: 0.18,
        diskRadius: 6,
        scale: 115,
        colorInner: '#ffc880',
        colorOuter: '#ff5050'
    },
    nebulae: {
        enabled: true,
        nebulaCount: 14,
        clusterCount: 20,
        dust: true,
        opacity: 0.72,
        brightness: 2.1,
        scale: 1.18,
        driftSpeed: 1
    },
    lighting: {
        intensity: 1,
        range: 120000,
        temperatureInfluence: 1,
        lerpSpeed: 1.5,
        ambientLevel: 0.3
    },
    events: {
        eventRate: 0.05,
        supernova: true,
        pulsarSweep: true,
        comet: true,
        ionStorm: true,
        intensity: 1
    }
};

const denseCluster = cloneConfig(universeDefault);
Object.assign(denseCluster.global, {
    seed: 'dense-cluster',
    regionRadius: 250000,
    masterDensity: 1.35,
    nodeCount: 24,
    voidScatter: 0.03,
    fogDensity: 0.000002
});
Object.assign(denseCluster.stars, { nearCount: 8000, midCount: 38000, bgCount: 70000, brightness: 2.8 });
Object.assign(denseCluster.galaxies, { count: 60, sizeMin: 4500, sizeMax: 32000 });
Object.assign(denseCluster.nebulae, { nebulaCount: 20, clusterCount: 30 });

const deepVoid = cloneConfig(universeDefault);
Object.assign(deepVoid.global, {
    seed: 'deep-void',
    masterDensity: 0.52,
    nodeCount: 12,
    filamentStrength: 0.55,
    voidScatter: 0.16,
    fogDensity: 0.000001
});
Object.assign(deepVoid.stars, { nearCount: 2500, midCount: 14000, bgCount: 52000, brightness: 2 });
Object.assign(deepVoid.galaxies, { count: 24, opacity: 0.68 });
Object.assign(deepVoid.blackHoles, { blackHoleCount: 3, pulsarCount: 1, anomalyCount: 4 });
Object.assign(deepVoid.nebulae, { nebulaCount: 6, clusterCount: 8, opacity: 0.45 });

const blackHoleGraveyard = cloneConfig(universeDefault);
Object.assign(blackHoleGraveyard.global, {
    seed: 'black-hole-graveyard',
    nodeCount: 20,
    themeVariety: 1.4
});
Object.assign(blackHoleGraveyard.blackHoles, {
    blackHoleCount: 10,
    pulsarCount: 6,
    anomalyCount: 16,
    bloomIntensity: 2,
    colorInner: '#cce8ff',
    colorOuter: '#9b4dff'
});
Object.assign(blackHoleGraveyard.nebulae, { nebulaCount: 9, clusterCount: 12 });

const stellarNursery = cloneConfig(universeDefault);
Object.assign(stellarNursery.global, {
    seed: 'stellar-nursery',
    nodeCount: 22,
    filamentStrength: 1.25
});
Object.assign(stellarNursery.stars, {
    nearCount: 7600,
    midCount: 32000,
    temperatureBias: 0.25,
    saturation: 1.28
});
Object.assign(stellarNursery.nebulae, {
    nebulaCount: 22,
    clusterCount: 34,
    brightness: 2.6,
    opacity: 0.86
});
Object.assign(stellarNursery.galaxies, { count: 36 });

export const UNIVERSE_CONFIG = cloneConfig(universeDefault);

export const UNIVERSE_PRESETS = {
    default: cloneConfig(universeDefault),
    dense_cluster: denseCluster,
    deep_void: deepVoid,
    black_hole_graveyard: blackHoleGraveyard,
    stellar_nursery: stellarNursery
};

export const UNIVERSE_PRESET_NAMES = Object.freeze({
    default: 'default',
    denseCluster: 'dense_cluster',
    deepVoid: 'deep_void',
    blackHoleGraveyard: 'black_hole_graveyard',
    stellarNursery: 'stellar_nursery'
});

const NAME_TO_KEY = {
    default: 'default',
    dense_cluster: 'dense_cluster',
    denseCluster: 'dense_cluster',
    deep_void: 'deep_void',
    deepVoid: 'deep_void',
    black_hole_graveyard: 'black_hole_graveyard',
    blackHoleGraveyard: 'black_hole_graveyard',
    stellar_nursery: 'stellar_nursery',
    stellarNursery: 'stellar_nursery'
};

export function resolveUniversePresetName(name) {
    return NAME_TO_KEY[name] ?? null;
}

export function cloneUniverseConfig(value) {
    return cloneConfig(value);
}

function cloneConfig(value) {
    return JSON.parse(JSON.stringify(value));
}
