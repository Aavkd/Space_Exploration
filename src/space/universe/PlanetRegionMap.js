import { createSeededRandom, deriveSeed } from './rng.js';

export const REGION_GRID = Object.freeze({
    latitudeBands: 12,
    longitudeBands: 24
});

const KIND_ORDER = Object.freeze({
    continent: 0,
    sea: 1,
    ice_cap: 2,
    region: 3
});

/**
 * Streaming-independent, seed-derived aggregation of a PlanetSurfaceModel.
 *
 * The fixed latitude/longitude lattice is deliberately unrelated to render LOD.
 * Its cells are connected once, then grouped into landmasses and biome zones.
 * Public records are plain data so callers cannot mutate the cached map.
 */
export class PlanetRegionMap {
    constructor({ seed, surface, latitudeBands, longitudeBands } = {}) {
        if (!surface?.sampleAt) {
            throw new TypeError('PlanetRegionMap requires a surface with sampleAt(dir)');
        }
        this.seed = String(seed ?? surface.seed ?? 'planet');
        this.surface = surface;
        this.latitudeBands = positiveInteger(latitudeBands, REGION_GRID.latitudeBands);
        this.longitudeBands = positiveInteger(longitudeBands, REGION_GRID.longitudeBands);
        this._cells = [];
        this._records = [];
        this._recordById = new Map();
        this._build();
    }

    getRegions() {
        return this._records.map(cloneRecord);
    }

    getRegion(regionId) {
        const record = this._recordById.get(regionId);
        if (!record) throw new RangeError(`Unknown planet region "${regionId}"`);
        return cloneRecord(record);
    }

    regionAt(direction) {
        const dir = normalizedDirection(direction);
        const sample = this.surface.sampleAt(dir, {});
        const cell = this._cellAtDirection(dir);
        if (cell.biome === sample.biome && cell.regionId) return cell.regionId;

        // A point close to a coarse lattice boundary can classify differently
        // from its cell centre. Select the nearest cell in the same landmass
        // class and biome so regionAt always agrees with the surface authority.
        let best = null;
        let bestDot = -Infinity;
        for (const candidate of this._cells) {
            if (candidate.biome !== sample.biome || candidate.isLiquid !== sample.isLiquid) continue;
            const dot = dotVector(candidate.direction, dir);
            if (dot > bestDot) {
                best = candidate;
                bestDot = dot;
            }
        }
        if (!best?.regionId) {
            throw new Error(`No region represents biome "${sample.biome}" on planet "${this.seed}"`);
        }
        return best.regionId;
    }

    findRegions({ biome, kind, minArea = 0 } = {}) {
        const minimum = Number.isFinite(Number(minArea)) ? Math.max(0, Number(minArea)) : 0;
        return this._records
            .filter((record) => !biome || record.dominantBiome === biome)
            .filter((record) => !kind || record.kind === kind)
            .filter((record) => record.areaFraction >= minimum)
            .map(cloneRecord);
    }

    getWeather(regionId) {
        const region = this.getRegion(regionId);
        return weatherForBiome(region.dominantBiome, this.surface.type);
    }

    resolvePlacement(regionId, {
        seed = 'placement',
        maxSlopeDeg = 24,
        attempts = 48
    } = {}) {
        const region = this._recordById.get(regionId);
        if (!region) throw new RangeError(`Unknown planet region "${regionId}"`);
        if (region.kind === 'continent') {
            throw new RangeError(`Region "${regionId}" is an aggregate continent; choose one of its biome regions`);
        }
        const cells = region._cellIndices.map((index) => this._cells[index]);
        if (!cells.length) throw new Error(`Region "${regionId}" has no placement cells`);

        const rng = createSeededRandom(deriveSeed(this.seed, `region-placement:${regionId}:${seed}`));
        let best = null;
        for (let index = 0; index < Math.max(1, attempts); index += 1) {
            const cell = cells[Math.floor(rng() * cells.length)];
            const lat = lerp(cell.lat0, cell.lat1, 0.12 + rng() * 0.76);
            const lon = lerp(cell.lon0, cell.lon1, 0.12 + rng() * 0.76);
            const direction = directionFromRadians(lat, lon);
            if (this.regionAt(direction) !== regionId) continue;
            const sample = this.surface.sampleAt(direction, {}, { includeSlope: true });
            const candidate = {
                regionId,
                direction: vectorToArray(direction),
                biome: sample.biome,
                height: sample.height,
                slopeDeg: sample.slopeDeg
            };
            if (!best || candidate.slopeDeg < best.slopeDeg) best = candidate;
            if (candidate.slopeDeg <= maxSlopeDeg) return candidate;
        }
        if (best) return best;
        throw new Error(`Could not resolve deterministic terrain inside region "${regionId}"`);
    }

    _build() {
        this._buildCells();
        const landComponents = connectedComponents(this._cells, (cell) => !cell.isLiquid, this.longitudeBands);
        const seaComponents = connectedComponents(this._cells, (cell) => cell.isLiquid, this.longitudeBands);
        const pending = [];

        landComponents.forEach((indices, componentIndex) => {
            const continentKey = `continent:${componentIndex}`;
            pending.push(makePendingRecord(continentKey, 'continent', null, indices, this._cells));
            const byBiome = groupIndicesByBiome(indices, this._cells);
            for (const [biome, biomeIndices] of [...byBiome].sort(([a], [b]) => a.localeCompare(b))) {
                const kind = isIceCapBiome(biome) ? 'ice_cap' : 'region';
                pending.push(makePendingRecord(
                    `${continentKey}:biome:${biome}`,
                    kind,
                    continentKey,
                    biomeIndices,
                    this._cells
                ));
            }
        });

        seaComponents.forEach((indices, componentIndex) => {
            const byBiome = groupIndicesByBiome(indices, this._cells);
            for (const [biome, biomeIndices] of [...byBiome].sort(([a], [b]) => a.localeCompare(b))) {
                pending.push(makePendingRecord(
                    `sea:${componentIndex}:biome:${biome}`,
                    'sea',
                    null,
                    biomeIndices,
                    this._cells
                ));
            }
        });

        pending.sort(comparePendingRecords);
        const idByKey = new Map();
        pending.forEach((record, index) => {
            record.id = `region:${this.seed}:${index}`;
            idByKey.set(record._key, record.id);
        });
        for (const record of pending) {
            record.parentContinentId = record._parentKey ? idByKey.get(record._parentKey) ?? null : null;
            for (const cellIndex of record._cellIndices) {
                if (record.kind !== 'continent') this._cells[cellIndex].regionId = record.id;
            }
            delete record._key;
            delete record._parentKey;
            this._recordById.set(record.id, record);
        }
        this._records = pending;
    }

    _buildCells() {
        const latStep = Math.PI / this.latitudeBands;
        const lonStep = Math.PI * 2 / this.longitudeBands;
        for (let row = 0; row < this.latitudeBands; row += 1) {
            const lat0 = -Math.PI / 2 + row * latStep;
            const lat1 = lat0 + latStep;
            const lat = (lat0 + lat1) * 0.5;
            for (let column = 0; column < this.longitudeBands; column += 1) {
                const lon0 = -Math.PI + column * lonStep;
                const lon1 = lon0 + lonStep;
                const lon = (lon0 + lon1) * 0.5;
                const direction = directionFromRadians(lat, lon);
                const sample = this.surface.sampleAt(direction, {}, { includeSlope: true });
                this._cells.push({
                    row,
                    column,
                    lat0,
                    lat1,
                    lon0,
                    lon1,
                    direction,
                    areaFraction: (Math.sin(lat1) - Math.sin(lat0)) / (2 * this.longitudeBands),
                    biome: sample.biome,
                    isLiquid: Boolean(sample.isLiquid),
                    elevation: sample.elevation,
                    slopeDeg: sample.slopeDeg,
                    regionId: null
                });
            }
        }
    }

    _cellAtDirection(dir) {
        const lat = Math.asin(clamp(dir.y, -1, 1));
        const lon = Math.atan2(dir.z, dir.x);
        const row = Math.min(
            this.latitudeBands - 1,
            Math.max(0, Math.floor(((lat + Math.PI / 2) / Math.PI) * this.latitudeBands))
        );
        const column = Math.min(
            this.longitudeBands - 1,
            Math.max(0, Math.floor(((lon + Math.PI) / (Math.PI * 2)) * this.longitudeBands))
        );
        return this._cells[row * this.longitudeBands + column];
    }
}

function connectedComponents(cells, accepts, columns) {
    const visited = new Uint8Array(cells.length);
    const components = [];
    const rows = cells.length / columns;
    for (let start = 0; start < cells.length; start += 1) {
        if (visited[start] || !accepts(cells[start])) continue;
        const component = [];
        const queue = [start];
        visited[start] = 1;
        for (let cursor = 0; cursor < queue.length; cursor += 1) {
            const index = queue[cursor];
            component.push(index);
            const row = Math.floor(index / columns);
            const column = index % columns;
            const neighbours = [
                row > 0 ? index - columns : -1,
                row + 1 < rows ? index + columns : -1,
                row * columns + (column + columns - 1) % columns,
                row * columns + (column + 1) % columns
            ];
            for (const neighbour of neighbours) {
                if (neighbour < 0 || visited[neighbour] || !accepts(cells[neighbour])) continue;
                visited[neighbour] = 1;
                queue.push(neighbour);
            }
        }
        components.push(component);
    }
    return components;
}

function makePendingRecord(key, kind, parentKey, cellIndices, cells) {
    const biomeWeights = new Map();
    const centroid = { x: 0, y: 0, z: 0 };
    let areaFraction = 0;
    let elevation = 0;
    let slope = 0;
    for (const index of cellIndices) {
        const cell = cells[index];
        const weight = cell.areaFraction;
        areaFraction += weight;
        elevation += cell.elevation * weight;
        slope += cell.slopeDeg * weight;
        addScaledVector(centroid, cell.direction, weight);
        biomeWeights.set(cell.biome, (biomeWeights.get(cell.biome) ?? 0) + weight);
    }
    normalizeVector(centroid);
    const biomeMix = Object.fromEntries(
        [...biomeWeights.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([biome, weight]) => [biome, round(weight / areaFraction)])
    );
    const dominantBiome = [...biomeWeights.entries()]
        .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0]?.[0] ?? 'unknown';
    let angularRadius = 0;
    for (const index of cellIndices) {
        angularRadius = Math.max(
            angularRadius,
            Math.acos(clamp(dotVector(centroid, cells[index].direction), -1, 1))
        );
    }
    return {
        id: null,
        kind,
        parentContinentId: null,
        dominantBiome,
        biomeMix,
        centroidDir: vectorToArray(centroid).map(round),
        bounds: {
            centerDir: vectorToArray(centroid).map(round),
            angularRadius: round(angularRadius)
        },
        areaFraction: round(areaFraction),
        meanElevation: round(elevation / areaFraction),
        meanSlope: round(slope / areaFraction),
        _key: key,
        _parentKey: parentKey,
        _cellIndices: [...cellIndices]
    };
}

function comparePendingRecords(a, b) {
    return (b.areaFraction - a.areaFraction)
        || ((KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99))
        || a.dominantBiome.localeCompare(b.dominantBiome)
        || a._key.localeCompare(b._key);
}

function groupIndicesByBiome(indices, cells) {
    const groups = new Map();
    for (const index of indices) {
        const biome = cells[index].biome;
        if (!groups.has(biome)) groups.set(biome, []);
        groups.get(biome).push(index);
    }
    return groups;
}

function cloneRecord(record) {
    const { _cellIndices, ...publicRecord } = record;
    return structuredClone(publicRecord);
}

function normalizedDirection(value) {
    const source = Array.isArray(value) ? { x: value[0], y: value[1], z: value[2] } : value;
    const direction = { x: Number(source?.x), y: Number(source?.y), z: Number(source?.z) };
    const lengthSquared = dotVector(direction, direction);
    if (!Number.isFinite(lengthSquared) || lengthSquared < 1e-12) {
        throw new TypeError('Planet region direction must be a finite non-zero vector');
    }
    return normalizeVector(direction);
}

function directionFromRadians(latitude, longitude) {
    const cosLat = Math.cos(latitude);
    return {
        x: cosLat * Math.cos(longitude),
        y: Math.sin(latitude),
        z: cosLat * Math.sin(longitude)
    };
}

function isIceCapBiome(biome) {
    return /snow|ice|polar/i.test(biome);
}

function weatherForBiome(biome, planetType) {
    const value = String(biome).toLowerCase();
    if (/snow|ice|polar/.test(value)) return { id: 'snow', precipitation: 'snow', intensity: 0.35 };
    if (/desert|dune|ash|regolith|basin/.test(value)) return { id: 'dust', precipitation: 'none', intensity: 0.4 };
    if (/ocean|acid|coast|sulfur/.test(value)) return { id: 'storm', precipitation: planetType === 'toxic' ? 'acid' : 'rain', intensity: 0.5 };
    return { id: 'clear', precipitation: 'none', intensity: 0.1 };
}

function positiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number > 1 ? number : fallback;
}

function round(value) {
    return Math.round(value * 1e9) / 1e9;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function lerp(a, b, alpha) {
    return a + (b - a) * alpha;
}

function dotVector(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function addScaledVector(target, value, scale) {
    target.x += value.x * scale;
    target.y += value.y * scale;
    target.z += value.z * scale;
    return target;
}

function normalizeVector(value) {
    const lengthSquared = dotVector(value, value);
    if (!Number.isFinite(lengthSquared) || lengthSquared < 1e-18) {
        value.x = 1;
        value.y = 0;
        value.z = 0;
        return value;
    }
    const inverseLength = 1 / Math.sqrt(lengthSquared);
    value.x *= inverseLength;
    value.y *= inverseLength;
    value.z *= inverseLength;
    return value;
}

function vectorToArray(value) {
    return [value.x, value.y, value.z];
}
