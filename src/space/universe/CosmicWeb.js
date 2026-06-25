import * as THREE from 'three';
import { gaussian, randomRange, weightedChoice } from './rng.js';

const THEMES = ['nursery', 'graveyard', 'galactic', 'mixed', 'deep_void'];
const NAME_PREFIX = ['Aster', 'Vela', 'Orion', 'Lyra', 'Kepler', 'Cygni', 'Erebus', 'Nadir', 'Mira', 'Helix'];
const NAME_SUFFIX = ['Reach', 'Crown', 'Drift', 'Haven', 'Gate', 'Veil', 'Cradle', 'Bastion', 'Spindle', 'Choir'];

export class CosmicWeb {
    constructor({ rng, config }) {
        this.rng = rng;
        this.config = config;
        this.nodes = [];
        this.filaments = [];
        this.voids = [];
        this.fieldOrigin = new THREE.Vector3();
        this._fieldSeed = 0;
        this.generate();
    }

    generate() {
        const radius = this.config.global.regionRadius;
        const nodeCount = Math.max(4, Math.floor(this.config.global.nodeCount));
        this.fieldOrigin.set(0, 0, 0);
        this._fieldSeed = Math.floor(this.rng() * 100000);
        this.nodes = [this._createSpawnNode()];

        for (let i = 1; i < nodeCount; i++) {
            const position = randomPointInSphere(this.rng, radius * 0.88);
            const density = randomRange(this.rng, 0.45, 1.35) * this.config.global.masterDensity;
            const nodeRadius = randomRange(this.rng, radius * 0.035, radius * 0.095);
            this.nodes.push({
                id: `node-${i}`,
                name: this._nodeName(i),
                position,
                radius: nodeRadius,
                density,
                theme: this._theme(i),
                isSpawn: false
            });
        }

        this.filaments = this._buildFilaments();
        this.voids = this._buildVoids();
        this._updateFieldMetrics();
    }

    sample(rng, bias = {}) {
        const voidScatter = bias.voidScatter ?? this.config.global.voidScatter;
        const nodeBias = bias.nodeBias ?? 0.68;
        const filamentBias = bias.filamentBias ?? 0.28;
        const attempts = bias.densityAttempts ?? 4;

        if (rng() < voidScatter) {
            return this._bestDensitySample(rng, 'void', attempts, bias);
        }

        if (rng() < nodeBias / Math.max(nodeBias + filamentBias, 0.001)) {
            return this._bestDensitySample(rng, 'node', attempts, bias);
        }

        return this._bestDensitySample(rng, 'filament', attempts, bias);
    }

    densityAt(position) {
        const radius = this.config.global.regionRadius;
        const local = position.clone().sub(this.fieldOrigin);
        const edgeFade = 1 - smoothstep(radius * 0.88, radius, local.length());

        let nodeDensity = 0;
        let nearestNode = null;
        let nearestNodeScore = Infinity;
        for (const node of this.nodes) {
            const distance = position.distanceTo(node.position);
            const normalized = distance / Math.max(node.radius, 1);
            const contribution = Math.exp(-normalized * normalized * 1.85) * node.density;
            nodeDensity += contribution;
            if (normalized < nearestNodeScore) {
                nearestNodeScore = normalized;
                nearestNode = node;
            }
        }

        let filamentDensity = 0;
        let nearestFilament = null;
        let nearestFilamentScore = Infinity;
        for (const filament of this.filaments) {
            const distance = distanceToSegment(position, filament.a.position, filament.b.position);
            const thickness = Math.max(1, Math.min(filament.a.radius, filament.b.radius) * 0.28 * this.config.global.filamentStrength);
            const normalized = distance / thickness;
            const density = (filament.a.density + filament.b.density) * 0.5;
            filamentDensity += Math.exp(-normalized * normalized * 1.7) * density;
            if (normalized < nearestFilamentScore) {
                nearestFilamentScore = normalized;
                nearestFilament = filament;
            }
        }

        let voidDensity = 0;
        let nearestVoid = null;
        let nearestVoidScore = Infinity;
        for (const voidRegion of this.voids) {
            const distance = position.distanceTo(voidRegion.position);
            const normalized = distance / Math.max(voidRegion.radius, 1);
            const contribution = 1 - smoothstep(0.35, 1.1, normalized);
            voidDensity += contribution;
            if (normalized < nearestVoidScore) {
                nearestVoidScore = normalized;
                nearestVoid = voidRegion;
            }
        }

        const noisePosition = local.multiplyScalar(1 / Math.max(radius, 1));
        const structureNoise = fbm3(noisePosition.x * 5.6, noisePosition.y * 5.6, noisePosition.z * 5.6, this._fieldSeed);
        const fineNoise = fbm3(noisePosition.x * 17.0 + 11.3, noisePosition.y * 17.0 - 4.7, noisePosition.z * 17.0 + 2.1, this._fieldSeed + 91);
        const webDensity = nodeDensity * 0.58 + filamentDensity * 0.46;
        const turbulentDensity = structureNoise * 0.36 + fineNoise * 0.12;
        const rawDensity = Math.max(0, (webDensity + turbulentDensity) * edgeFade - voidDensity * 0.92);
        const density = Math.min(3, rawDensity * this.config.global.masterDensity);

        return {
            density,
            occupancy: smoothstep(0.08, 1.4, density),
            nodeDensity,
            filamentDensity,
            voidDensity,
            nearestNode,
            nearestFilament,
            nearestVoid
        };
    }

    getCurrentNode(position) {
        let best = null;
        let bestScore = Infinity;
        for (const node of this.nodes) {
            const distance = position.distanceTo(node.position);
            const score = distance / Math.max(node.radius, 1);
            if (score < bestScore) {
                best = { ...node, distance };
                bestScore = score;
            }
        }
        return best;
    }

    rebaseOrigin(offset) {
        for (const node of this.nodes) node.position.sub(offset);
        for (const voidRegion of this.voids) voidRegion.position.sub(offset);
        this.fieldOrigin.sub(offset);
    }

    _createSpawnNode() {
        return {
            id: 'node-spawn',
            name: 'Origin Cradle',
            position: new THREE.Vector3(0, 0, 0),
            radius: Math.max(22000, this.config.global.regionRadius * 0.07),
            density: 1.6 * this.config.global.masterDensity,
            theme: 'mixed',
            isSpawn: true
        };
    }

    _buildFilaments() {
        const filaments = [];
        const seen = new Set();
        for (const node of this.nodes) {
            const nearest = this.nodes
                .filter((other) => other !== node)
                .map((other) => ({ other, distance: node.position.distanceTo(other.position) }))
                .sort((a, b) => a.distance - b.distance)
                .slice(0, 3);

            for (const { other, distance } of nearest) {
                const key = [node.id, other.id].sort().join(':');
                if (seen.has(key)) continue;
                seen.add(key);
                filaments.push({ id: `filament-${filaments.length}`, a: node, b: other, length: distance });
            }
        }
        return filaments;
    }

    _buildVoids() {
        return Array.from({ length: Math.max(3, Math.floor(this.nodes.length / 4)) }, (_, index) => ({
            id: `void-${index}`,
            position: randomPointInSphere(this.rng, this.config.global.regionRadius * 0.85),
            radius: randomRange(this.rng, this.config.global.regionRadius * 0.08, this.config.global.regionRadius * 0.18)
        }));
    }

    _updateFieldMetrics() {
        for (const node of this.nodes) {
            node.fieldDensity = this.densityAt(node.position).density;
        }
        for (const filament of this.filaments) {
            const midpoint = filament.a.position.clone().lerp(filament.b.position, 0.5);
            filament.fieldDensity = this.densityAt(midpoint).density;
        }
    }

    _bestDensitySample(rng, source, attempts, bias) {
        let best = null;
        let bestScore = source === 'void' ? Infinity : -Infinity;
        const count = Math.max(1, Math.floor(attempts));
        for (let i = 0; i < count; i++) {
            const candidate = this._candidateSample(rng, source, bias);
            const field = this.densityAt(candidate.position);
            const jitter = 0.82 + rng() * 0.36;
            const densityPower = bias.densityPower ?? (source === 'node' ? 1.25 : 1.05);
            const score = source === 'void'
                ? field.density * jitter
                : Math.pow(Math.max(field.density, 0.001), densityPower) * jitter;
            if ((source === 'void' && score < bestScore) || (source !== 'void' && score > bestScore)) {
                best = { ...candidate, field };
                bestScore = score;
            }
        }
        return best;
    }

    _candidateSample(rng, source, bias) {
        if (source === 'void') {
            return {
                position: randomPointInSphere(rng, this.config.global.regionRadius * 0.96),
                source: 'void',
                node: null
            };
        }

        if (source === 'node') {
            const node = weightedChoice(rng, this.nodes.map((value) => ({
                value,
                weight: Math.max(0.05, value.fieldDensity ?? value.density) * value.radius
            })));
            const spread = node.radius * (bias.spread ?? 0.58);
            const offset = new THREE.Vector3(gaussian(rng), gaussian(rng) * 0.7, gaussian(rng)).multiplyScalar(spread);
            return {
                position: node.position.clone().add(offset).clampLength(0, this.config.global.regionRadius * 0.98),
                source: 'node',
                node
            };
        }

        const filament = weightedChoice(rng, this.filaments.map((value) => ({
            value,
            weight: value.length * Math.max(0.05, value.fieldDensity ?? 1)
        })));
        const t = rng();
        const core = filament.a.position.clone().lerp(filament.b.position, t);
        const thickness = Math.min(filament.a.radius, filament.b.radius) * 0.24 * this.config.global.filamentStrength;
        const offset = randomPointInSphere(rng, thickness);
        return {
            position: core.add(offset).clampLength(0, this.config.global.regionRadius * 0.98),
            source: 'filament',
            node: t < 0.5 ? filament.a : filament.b,
            filament
        };
    }

    _theme(index) {
        const variety = this.config.global.themeVariety;
        return weightedChoice(this.rng, THEMES.map((theme) => ({
            value: theme,
            weight: theme === 'mixed' ? 0.65 : variety
        }))) ?? THEMES[index % THEMES.length];
    }

    _nodeName(index) {
        const prefix = NAME_PREFIX[Math.floor(this.rng() * NAME_PREFIX.length)];
        const suffix = NAME_SUFFIX[Math.floor(this.rng() * NAME_SUFFIX.length)];
        return `${prefix} ${suffix} ${index.toString().padStart(2, '0')}`;
    }
}

export function randomPointInSphere(rng, radius) {
    const u = rng();
    const v = rng();
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v - 1);
    const r = Math.cbrt(rng()) * radius;
    return new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta) * r,
        Math.cos(phi) * r,
        Math.sin(phi) * Math.sin(theta) * r
    );
}

function distanceToSegment(point, a, b) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const apx = point.x - a.x;
    const apy = point.y - a.y;
    const apz = point.z - a.z;
    const lengthSq = abx * abx + aby * aby + abz * abz;
    const t = lengthSq > 0
        ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / lengthSq))
        : 0;
    const dx = apx - abx * t;
    const dy = apy - aby * t;
    const dz = apz - abz * t;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function fbm3(x, y, z, seed) {
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1;
    for (let i = 0; i < 4; i++) {
        value += valueNoise3(x * frequency, y * frequency, z * frequency, seed + i * 37) * amplitude;
        frequency *= 2.03;
        amplitude *= 0.5;
    }
    return value;
}

function valueNoise3(x, y, z, seed) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const fx = fade(x - ix);
    const fy = fade(y - iy);
    const fz = fade(z - iz);

    const x00 = lerp(hash3(ix, iy, iz, seed), hash3(ix + 1, iy, iz, seed), fx);
    const x10 = lerp(hash3(ix, iy + 1, iz, seed), hash3(ix + 1, iy + 1, iz, seed), fx);
    const x01 = lerp(hash3(ix, iy, iz + 1, seed), hash3(ix + 1, iy, iz + 1, seed), fx);
    const x11 = lerp(hash3(ix, iy + 1, iz + 1, seed), hash3(ix + 1, iy + 1, iz + 1, seed), fx);
    const y0 = lerp(x00, x10, fy);
    const y1 = lerp(x01, x11, fy);
    return lerp(y0, y1, fz);
}

function hash3(x, y, z, seed) {
    let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function fade(t) {
    return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function smoothstep(edge0, edge1, value) {
    const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(edge1 - edge0, 1e-7)));
    return t * t * (3 - 2 * t);
}
