import * as THREE from 'three';
import { createSeededRandom, deriveSeed, randomRange } from './rng.js';

// Shared planet height basis (docs/surface-eva-tier.md §2, §3.2).
//
// The COARSE term of a planet's surface — the continent/mountain shape you see
// from orbit — is a deterministic value-noise fbm of the surface direction. This
// is the exact same algorithm the hero-sphere `PlanetaryContents` uses for its
// displaced mesh and `surfaceRadiusAt` collision query, lifted into one module
// so the true-radius quadtree planet (`QuadPlanetContents`) reuses a single
// source of truth: the shape you see from orbit is the shape you land on, and
// re-entry is reproducible (the §5 determinism contract of the architecture doc).
//
// CPU-only float64 math. Drives mesh vertices AND collision, so what you see is
// what you touch — no raycasting the mesh.
export class PlanetHeightBasis {
    // `seed` is the planet seed; `radius` is the true radius the coarse shape is
    // re-expressed at. reliefMetres keeps true-radius mountains in real-world
    // metre ranges; seaLevel/baseFreq preserve the deterministic land layout.
    constructor({
        seed,
        radius,
        relief = 0.018,
        reliefMetres = null,
        seaLevel = 0.5,
        baseFreq = 2.2,
        detailAmplitude = 0,
        detailFreq = 180
    }) {
        this.seed = seed;
        this.radius = radius;
        this.reliefMetres = Number.isFinite(reliefMetres) ? reliefMetres : radius * relief;
        this.relief = this.reliefMetres / Math.max(radius, 1);
        this.seaLevel = seaLevel;
        this.baseFreq = baseFreq;
        this.detailAmplitude = detailAmplitude;
        this.detailFreq = detailFreq;

        // Identical derivation to PlanetaryContents (`'terrain'` sub-seed + an
        // offset drawn from the `'planetary'` rng stream) so a given planet seed
        // produces the same continents in both providers.
        const rng = createSeededRandom(deriveSeed(seed, 'planetary'));
        this._noiseSeed = hashToInt(deriveSeed(seed, 'terrain'));
        this._noiseOffset = new THREE.Vector3(
            randomRange(rng, -50, 50),
            randomRange(rng, -50, 50),
            randomRange(rng, -50, 50)
        );
    }

    // Normalised land amount in [0,1]: 0 at/below sea level, rising over land.
    // Pure function of the unit surface direction — the deterministic core.
    landAt(dir) {
        const n = this._fbm(
            dir.x * this.baseFreq + this._noiseOffset.x,
            dir.y * this.baseFreq + this._noiseOffset.y,
            dir.z * this.baseFreq + this._noiseOffset.z
        );
        return { n, land: Math.max(0, n - this.seaLevel) / (1 - this.seaLevel) };
    }

    // World radius of the solid surface in unit direction `dir` from the planet
    // centre, at true radius. The coarse relief is metre-based; fine detail sits
    // on top only over land so oceans remain flat and collision matches render.
    surfaceRadiusAt(dir) {
        const { land } = this.landAt(dir);
        const coarse = this.radius + this.reliefMetres * land;
        if (this.detailAmplitude <= 0 || land <= 0) return coarse;
        return coarse + this.detailAt(dir) * this.detailAmplitude * Math.min(1, land * 1.35);
    }

    detailAt(dir) {
        if (this.detailAmplitude <= 0) return 0;
        const n = this._fbm(
            dir.x * this.detailFreq + this._noiseOffset.z * 1.7,
            dir.y * this.detailFreq + this._noiseOffset.x * 1.7,
            dir.z * this.detailFreq + this._noiseOffset.y * 1.7
        );
        return (n - 0.5) * 2;
    }

    // Deterministic value-noise fbm (CPU-only), identical to
    // PlanetaryContents._fbm so the coarse shape matches exactly. ~[0,1).
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
        return value;
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
