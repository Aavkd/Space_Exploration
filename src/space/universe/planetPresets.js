import { deriveSeed, createSeededRandom, randomRange } from './rng.js';
import { PlanetSurfaceModel } from './PlanetSurfaceModel.js';

export const PLANET_TYPES = Object.freeze({
    TEMPERATE: 'temperate',
    ICE: 'ice',
    DESERT: 'desert',
    VOLCANIC: 'volcanic',
    BARREN: 'barren',
    TOXIC: 'toxic',
    GAS: 'gas'
});

export const TERRESTRIAL_TYPES = Object.freeze([
    PLANET_TYPES.TEMPERATE,
    PLANET_TYPES.ICE,
    PLANET_TYPES.DESERT,
    PLANET_TYPES.VOLCANIC,
    PLANET_TYPES.BARREN,
    PLANET_TYPES.TOXIC
]);

const PRESETS = Object.freeze({
    temperate: Object.freeze({
        label: 'Temperate',
        palette: {
            water: '#1d5f91',
            lowland: '#4f9b58',
            midland: '#9a7b45',
            highland: '#60635f',
            snow: '#e7f2f4',
            rock: '#343a36',
            accent: '#d8c98b',
            emissive: '#5fd6ff'
        },
        atmosphere: { color: '#6fb4ff', density: 0.42, rimStrength: 1.3 },
        clouds: { enabled: true, opacity: 0.18, color: '#ffffff', coverage: 0.5 },
        surface: {
            seaLevel: 0.5,
            hasWater: true,
            reliefMetres: 18_000,
            baseFreq: 2.25,
            detailAmplitude: 560,
            detailFreq: 360,
            ridgeAmplitude: 3400,
            ridgeFreq: 640,
            microAmplitude: 120,
            microFreq: 4800,
            shelfExponent: 1.8,
            ruggednessFreq: 1.7,
            moistureFreq: 5.5,
            temperatureBias: 0.03
        }
    }),
    ice: Object.freeze({
        label: 'Ice',
        palette: {
            water: '#153f5c',
            lowland: '#b9e4f0',
            midland: '#e4f6fb',
            highland: '#7c8f98',
            snow: '#f6fbff',
            rock: '#20272d',
            accent: '#58c7ff',
            emissive: '#9fe8ff'
        },
        atmosphere: { color: '#a9ddff', density: 0.28, rimStrength: 1.0 },
        clouds: { enabled: true, opacity: 0.1, color: '#f8fdff', coverage: 0.34 },
        surface: {
            seaLevel: 0.36,
            hasWater: false,
            reliefMetres: 9500,
            baseFreq: 2.6,
            detailAmplitude: 260,
            detailFreq: 420,
            ridgeAmplitude: 2200,
            ridgeFreq: 1100,
            microAmplitude: 55,
            microFreq: 6200,
            crackStrength: 0.9,
            moistureFreq: 7.0,
            temperatureBias: -0.42
        }
    }),
    desert: Object.freeze({
        label: 'Desert',
        palette: {
            water: '#6f624a',
            lowland: '#d0a354',
            midland: '#9b5930',
            highland: '#6a4635',
            snow: '#f2d98f',
            rock: '#3e332c',
            accent: '#f0c66b',
            emissive: '#ffb25d'
        },
        atmosphere: { color: '#d6a05a', density: 0.34, rimStrength: 1.05 },
        clouds: { enabled: false, opacity: 0.04, color: '#f1d39a', coverage: 0.12 },
        surface: {
            seaLevel: 0.31,
            hasWater: false,
            reliefMetres: 13_500,
            baseFreq: 2.05,
            detailAmplitude: 420,
            detailFreq: 260,
            ridgeAmplitude: 2900,
            ridgeFreq: 620,
            microAmplitude: 80,
            microFreq: 5300,
            duneStrength: 0.75,
            moistureFreq: 4.2,
            temperatureBias: 0.36
        }
    }),
    volcanic: Object.freeze({
        label: 'Volcanic',
        palette: {
            water: '#2a1915',
            lowland: '#1b1a19',
            midland: '#554943',
            highland: '#8b8378',
            snow: '#b9b1a6',
            rock: '#060606',
            accent: '#b63a1e',
            emissive: '#ff5b1f'
        },
        atmosphere: { color: '#ff6b3b', density: 0.46, rimStrength: 1.55 },
        clouds: { enabled: true, opacity: 0.09, color: '#6d514b', coverage: 0.22 },
        surface: {
            seaLevel: 0.28,
            hasWater: false,
            reliefMetres: 20_000,
            baseFreq: 2.35,
            detailAmplitude: 540,
            detailFreq: 330,
            ridgeAmplitude: 4400,
            ridgeFreq: 720,
            microAmplitude: 120,
            microFreq: 5600,
            channelStrength: 0.9,
            moistureFreq: 6.4,
            temperatureBias: 0.48
        }
    }),
    barren: Object.freeze({
        label: 'Barren Moon',
        palette: {
            water: '#56514a',
            lowland: '#9a8d77',
            midland: '#6b6259',
            highland: '#d0c3aa',
            snow: '#ebe2d1',
            rock: '#2f2d2a',
            accent: '#c8b57c',
            emissive: '#d9c48a'
        },
        atmosphere: { color: '#b8a783', density: 0.05, rimStrength: 0.28 },
        clouds: { enabled: false, opacity: 0, color: '#ffffff', coverage: 0 },
        surface: {
            seaLevel: 0.27,
            hasWater: false,
            reliefMetres: 11_500,
            baseFreq: 2.75,
            detailAmplitude: 300,
            detailFreq: 450,
            ridgeAmplitude: 1800,
            ridgeFreq: 1000,
            microAmplitude: 70,
            microFreq: 5000,
            craterDensity: 24,
            craterStrength: 1.0,
            moistureFreq: 5.0,
            temperatureBias: -0.06
        }
    }),
    toxic: Object.freeze({
        label: 'Toxic',
        palette: {
            water: '#8aa72c',
            lowland: '#38402a',
            midland: '#708236',
            highland: '#b6b166',
            snow: '#d7e982',
            rock: '#121d18',
            accent: '#d7ff49',
            emissive: '#a6ff21'
        },
        atmosphere: { color: '#c8f24a', density: 0.58, rimStrength: 1.7 },
        clouds: { enabled: true, opacity: 0.22, color: '#d9f27d', coverage: 0.62 },
        surface: {
            seaLevel: 0.46,
            hasWater: true,
            liquidMaterial: 'acid',
            reliefMetres: 12_000,
            baseFreq: 2.15,
            detailAmplitude: 320,
            detailFreq: 390,
            ridgeAmplitude: 2400,
            ridgeFreq: 780,
            microAmplitude: 90,
            microFreq: 5600,
            channelStrength: 0.45,
            moistureFreq: 8.0,
            temperatureBias: 0.16
        }
    }),
    gas: Object.freeze({
        label: 'Gas Giant',
        palette: {
            water: '#d8b37d',
            lowland: '#8d5f43',
            midland: '#f3dcac',
            highland: '#fff1c9',
            snow: '#f7e8cc',
            rock: '#6d4f3a',
            accent: '#f7d78a',
            emissive: '#fff0bb'
        },
        atmosphere: { color: '#e8c184', density: 0.72, rimStrength: 1.5 },
        clouds: { enabled: true, opacity: 0.45, color: '#f8dfb2', coverage: 1 },
        surface: { hasWater: false, reliefMetres: 0, seaLevel: 0.5, baseFreq: 2.2 }
    })
});

const GAS_PALETTES = Object.freeze([
    ['#d8b37d', '#8d5f43', '#f3dcac'],
    ['#a7b7d8', '#536a9f', '#efe6d0'],
    ['#d6c9a8', '#6f8f96', '#f5e4b8']
]);

export function createPlanetDescriptor({
    seed,
    index = 0,
    name = null,
    kind = 'terrestrial',
    type: forcedType = null,
    systemRadius = 1200,
    hasRings = false,
    starProfile = null
} = {}) {
    const childSeed = deriveSeed(seed, `planet:${index}`);
    const rng = createSeededRandom(deriveSeed(childSeed, 'descriptor'));
    const type = kind === 'gas'
        ? PLANET_TYPES.GAS
        : forcedType ?? chooseTerrestrialType({ rng, index, starProfile });
    const preset = PRESETS[type] ?? PRESETS.temperate;
    const palette = clonePalette(preset.palette);

    if (kind === 'gas') {
        const gas = GAS_PALETTES[index % GAS_PALETTES.length];
        palette.water = gas[0];
        palette.lowland = gas[1];
        palette.midland = gas[2];
        palette.highland = gas[2];
        palette.accent = gas[2];
    }

    return {
        name: name ?? `${kind === 'gas' ? 'Gas giant' : preset.label} ${index + 1}`,
        kind,
        type,
        label: preset.label,
        palette,
        paletteArray: paletteToLegacyArray(palette),
        atmosphere: { ...preset.atmosphere },
        clouds: { ...preset.clouds },
        surface: jitterSurface(preset.surface, rng),
        hasRings,
        landable: kind === 'terrestrial',
        systemRadius,
        childSeed,
        seed: childSeed
    };
}

export function createPlanetSurfaceModel(descriptor, options = {}) {
    return new PlanetSurfaceModel({ descriptor: normalizePlanetDescriptor(descriptor), ...options });
}

export function normalizePlanetDescriptor(descriptor = {}) {
    const kind = descriptor.kind ?? 'terrestrial';
    const type = descriptor.type ?? (kind === 'gas' ? PLANET_TYPES.GAS : PLANET_TYPES.TEMPERATE);
    const preset = PRESETS[type] ?? PRESETS.temperate;
    const palette = normalizePalette(descriptor.palette ?? descriptor.paletteArray ?? preset.palette, preset.palette);
    return {
        ...descriptor,
        kind,
        type,
        label: descriptor.label ?? preset.label,
        palette,
        paletteArray: descriptor.paletteArray ?? paletteToLegacyArray(palette),
        atmosphere: { ...preset.atmosphere, ...(descriptor.atmosphere ?? {}) },
        clouds: { ...preset.clouds, ...(descriptor.clouds ?? {}) },
        surface: { ...preset.surface, ...(descriptor.surface ?? {}) },
        landable: descriptor.landable ?? kind === 'terrestrial'
    };
}

export function planetPaletteArray(kind = 'terrestrial', index = 0) {
    if (kind === 'gas') return GAS_PALETTES[index % GAS_PALETTES.length];
    const type = TERRESTRIAL_TYPES[index % TERRESTRIAL_TYPES.length];
    return paletteToLegacyArray(PRESETS[type].palette);
}

export function paletteToLegacyArray(palette) {
    return [
        palette.water ?? '#406080',
        palette.lowland ?? '#8fb37a',
        palette.highland ?? palette.midland ?? '#d8c38a'
    ];
}

function chooseTerrestrialType({ rng, index, starProfile }) {
    const roll = rng();
    const temperatureK = starProfile?.temperatureK ?? 5800;
    if (temperatureK > 6900 && roll < 0.22) return PLANET_TYPES.DESERT;
    if (temperatureK < 4500 && roll < 0.22) return PLANET_TYPES.ICE;
    const shifted = (index + Math.floor(roll * TERRESTRIAL_TYPES.length)) % TERRESTRIAL_TYPES.length;
    return TERRESTRIAL_TYPES[shifted];
}

function jitterSurface(surface, rng) {
    const out = { ...surface };
    out.seaLevel = clamp((surface.seaLevel ?? 0.5) + randomRange(rng, -0.035, 0.035), 0.2, 0.68);
    out.baseFreq = (surface.baseFreq ?? 2.2) * randomRange(rng, 0.9, 1.12);
    out.reliefMetres = (surface.reliefMetres ?? 14_000) * randomRange(rng, 0.86, 1.18);
    out.detailAmplitude = (surface.detailAmplitude ?? 260) * randomRange(rng, 0.82, 1.2);
    out.ridgeAmplitude = (surface.ridgeAmplitude ?? 980) * randomRange(rng, 0.78, 1.25);
    out.microAmplitude = (surface.microAmplitude ?? 90) * randomRange(rng, 0.75, 1.15);
    return out;
}

function normalizePalette(value, fallback) {
    if (Array.isArray(value)) {
        return {
            ...clonePalette(fallback),
            water: value[0] ?? fallback.water,
            lowland: value[1] ?? fallback.lowland,
            midland: value[2] ?? fallback.midland,
            highland: value[2] ?? fallback.highland
        };
    }
    return { ...clonePalette(fallback), ...(value ?? {}) };
}

function clonePalette(palette) {
    return { ...palette };
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
