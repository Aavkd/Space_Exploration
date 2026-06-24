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
        this.generate();
    }

    generate() {
        const radius = this.config.global.regionRadius;
        const nodeCount = Math.max(4, Math.floor(this.config.global.nodeCount));
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
    }

    sample(rng, bias = {}) {
        const voidScatter = bias.voidScatter ?? this.config.global.voidScatter;
        const nodeBias = bias.nodeBias ?? 0.68;
        const filamentBias = bias.filamentBias ?? 0.28;

        if (rng() < voidScatter) {
            return { position: randomPointInSphere(rng, this.config.global.regionRadius * 0.96), source: 'void', node: null };
        }

        if (rng() < nodeBias / Math.max(nodeBias + filamentBias, 0.001)) {
            const node = weightedChoice(rng, this.nodes.map((value) => ({
                value,
                weight: Math.max(0.05, value.density) * value.radius
            })));
            const spread = node.radius * (bias.spread ?? 0.58);
            const offset = new THREE.Vector3(gaussian(rng), gaussian(rng) * 0.7, gaussian(rng)).multiplyScalar(spread);
            return {
                position: node.position.clone().add(offset).clampLength(0, this.config.global.regionRadius * 0.98),
                source: 'node',
                node
            };
        }

        const filament = weightedChoice(rng, this.filaments.map((value) => ({ value, weight: value.length })));
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
