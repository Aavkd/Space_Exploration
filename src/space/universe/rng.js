export function createSeededRandom(seedText) {
    let seed = hashString(seedText);

    return () => {
        seed += 0x6d2b79f5;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function deriveSeed(masterSeed, namespace) {
    return `${masterSeed}:${namespace}:${hashString(`${masterSeed}:${namespace}`).toString(16)}`;
}

export function randomRange(rng, min, max) {
    return min + (max - min) * rng();
}

export function randomInt(rng, min, max) {
    return Math.floor(randomRange(rng, min, max + 1));
}

export function randomSign(rng) {
    return rng() < 0.5 ? -1 : 1;
}

export function weightedChoice(rng, entries) {
    const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
    if (total <= 0) return entries[0]?.value;

    let cursor = rng() * total;
    for (const entry of entries) {
        cursor -= Math.max(0, entry.weight);
        if (cursor <= 0) return entry.value;
    }
    return entries[entries.length - 1]?.value;
}

export function gaussian(rng) {
    const u = Math.max(rng(), 1e-7);
    const v = Math.max(rng(), 1e-7);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function hashString(text) {
    let seed = 2166136261;
    for (let i = 0; i < text.length; i++) {
        seed ^= text.charCodeAt(i);
        seed = Math.imul(seed, 16777619);
    }
    return seed >>> 0;
}
