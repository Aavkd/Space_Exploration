const universeDefault = {
    global: {
        seed: 'deep-space-vr-foundation',
        regionRadius: 670000,
        masterDensity: 1.88,
        nodeCount: 31,
        filamentStrength: 1.74,
        voidScatter: 0.02,
        themeVariety: 1.83,
        gravityScale: 1,
        fogDensity: 0.0000026
    },
    stars: {
        enabled: true,
        nearCount: 3000,
        midCount: 25000,
        bgCount: 0,
        brightness: 6,
        size: 15.5,
        opacity: 1,
        twinkleSpeed: 3.35,
        temperatureBias: 0.64,
        saturation: 0.95,
        bloom: 4
    },
    galaxies: {
        enabled: true,
        count: 40,
        spiralRatio: 0.33,
        ellipticalRatio: 0.43,
        irregularRatio: 0.36,
        sizeMin: 3000,
        sizeMax: 47500,
        opacity: 0.25,
        brightness: 2.01,
        rotationSpeed: 2.09,
        pointSize: 20,
        bloom: 2.1,
        colorInner: '#88ccff',
        colorOuter: '#c49f17'
    },
    blackHoles: {
        enabled: true,
        blackHoleCount: 9,
        pulsarCount: 3,
        anomalyCount: 14,
        bloomIntensity: 0.4,
        distortion: 0.24,
        diskRadius: 9.1,
        beaming: 2,
        photonGlow: 0.9,
        photonWidth: 0.25,
        photonRadius: 1.35,
        scale: 64,
        colorInner: '#ffc880',
        colorOuter: '#ff5050'
    },
    nebulae: {
        enabled: true,
        nebulaCount: 8,
        clusterCount: 21,
        dust: true,
        opacity: 0.25,
        brightness: 5.25,
        scale: 2.14,
        driftSpeed: 2.7,
        bloom: 1.3
    },
    debris: {
        enabled: true,
        systemBelts: true,
        beltCount: 2,
        density: 1,
        opacity: 0.74,
        brightness: 1,
        driftSpeed: 1,
        hazardIntensity: 1.4
    },
    lighting: {
        intensity: 2.87,
        range: 175000,
        temperatureInfluence: 1,
        lerpSpeed: 4.1,
        ambientLevel: 0.69
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
Object.assign(denseCluster.debris, { density: 1.15 });

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
Object.assign(deepVoid.debris, { density: 0.62, hazardIntensity: 0.8 });

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
Object.assign(blackHoleGraveyard.debris, { density: 1.2, hazardIntensity: 1.8 });

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
Object.assign(stellarNursery.debris, { density: 1.1, brightness: 1.12 });

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
