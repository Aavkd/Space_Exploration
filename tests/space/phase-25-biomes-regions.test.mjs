import test from 'node:test';
import assert from 'node:assert/strict';
import { PlanetRegionMap } from '../../src/space/universe/PlanetRegionMap.js';
import { createSeededRandom } from '../../src/space/universe/rng.js';

function makeSurface(seed = 'phase-25-region-seed') {
    return {
        seed,
        type: 'temperate',
        sampleAt(direction, target = {}) {
            const wave = Math.sin(direction.x * 7.1 + direction.z * 4.7)
                + Math.cos(direction.y * 8.3 - direction.x * 2.2);
            const isLiquid = wave < -0.25;
            const cold = Math.abs(direction.y) > 0.72;
            const wet = Math.sin(direction.z * 9 + direction.y * 3) > 0;
            const biome = isLiquid
                ? 'ocean'
                : cold
                    ? 'snow cap'
                    : wet ? 'green lowland' : 'highland';
            return Object.assign(target, {
                biome,
                isLiquid,
                elevation: isLiquid ? 0 : (wave + 0.25) * 1200,
                height: 6_400_000 + (isLiquid ? 0 : (wave + 0.25) * 1200),
                slopeDeg: Math.abs(wave) * 8
            });
        }
    };
}

function randomDirection(rng) {
    const value = {
        x: rng() * 2 - 1,
        y: rng() * 2 - 1,
        z: rng() * 2 - 1
    };
    const length = Math.hypot(value.x, value.y, value.z);
    value.x /= length;
    value.y /= length;
    value.z /= length;
    return value;
}

test('region records and IDs regenerate byte-identically without saved state', () => {
    const first = new PlanetRegionMap({ seed: 'stable', surface: makeSurface('stable') });
    const second = new PlanetRegionMap({ seed: 'stable', surface: makeSurface('stable') });
    assert.deepEqual(first.getRegions(), second.getRegions());
    assert.ok(first.getRegions().length >= 4);
    assert.ok(first.getRegions().every(
        (region, index) => region.id === `region:stable:${index}`
    ));
});

test('regionAt always resolves to a region whose biome agrees with sampleAt', () => {
    const surface = makeSurface('agreement');
    const regions = new PlanetRegionMap({ seed: 'agreement', surface });
    const rng = createSeededRandom('phase-25-agreement-directions');
    for (let index = 0; index < 240; index += 1) {
        const direction = randomDirection(rng);
        const sample = surface.sampleAt(direction, {});
        const region = regions.getRegion(regions.regionAt(direction));
        assert.equal(region.dominantBiome, sample.biome);
        assert.notEqual(region.kind, 'continent');
    }
});

test('region identity is independent of unrelated sampling and query order', () => {
    const surface = makeSurface('stream-independent');
    const regions = new PlanetRegionMap({ seed: 'stream-independent', surface });
    const before = regions.getRegions();
    const rng = createSeededRandom('simulated-tile-stream');
    for (let index = 0; index < 1000; index += 1) {
        const direction = randomDirection(rng);
        surface.sampleAt(direction, {});
        regions.regionAt(direction);
    }
    assert.deepEqual(regions.getRegions(), before);
});

test('region filters and deterministic placement resolve coherent terrain', () => {
    const surface = makeSurface('placement');
    const regions = new PlanetRegionMap({ seed: 'placement', surface });
    const candidates = regions.findRegions({ kind: 'region', minArea: 0.002 });
    assert.ok(candidates.length > 0);
    const region = candidates[0];
    assert.ok(regions.findRegions({
        biome: region.dominantBiome,
        kind: region.kind,
        minArea: region.areaFraction
    }).some((entry) => entry.id === region.id));

    const first = regions.resolvePlacement(region.id, { seed: 'city-alpha' });
    const second = new PlanetRegionMap({ seed: 'placement', surface: makeSurface('placement') })
        .resolvePlacement(region.id, { seed: 'city-alpha' });
    assert.deepEqual(first, second);
    assert.equal(regions.regionAt(first.direction), region.id);
    assert.equal(first.biome, region.dominantBiome);
    assert.ok(Number.isFinite(first.height));
    assert.ok(Number.isFinite(first.slopeDeg));
});

test('weather hooks are deterministic and invalid IDs fail descriptively', () => {
    const regions = new PlanetRegionMap({ seed: 'weather', surface: makeSurface('weather') });
    for (const region of regions.getRegions()) {
        const weather = regions.getWeather(region.id);
        assert.ok(['clear', 'dust', 'snow', 'storm'].includes(weather.id));
        assert.ok(weather.intensity >= 0 && weather.intensity <= 1);
        assert.deepEqual(weather, regions.getWeather(region.id));
    }
    assert.throws(() => regions.getRegion('region:missing:9'), /Unknown planet region/);
    const continent = regions.findRegions({ kind: 'continent' })[0];
    assert.throws(() => regions.resolvePlacement(continent.id), /aggregate continent/);
});

test('a whole-surface dry continent retains finite deterministic bounds', () => {
    const surface = {
        seed: 'dry-world',
        type: 'barren',
        sampleAt(direction, target = {}) {
            return Object.assign(target, {
                biome: Math.abs(direction.y) > 0.6 ? 'rocky highland' : 'regolith plain',
                isLiquid: false,
                elevation: 250,
                height: 2_000_250,
                slopeDeg: 4
            });
        }
    };
    const regions = new PlanetRegionMap({ seed: surface.seed, surface });
    const continent = regions.findRegions({ kind: 'continent' })[0];
    assert.ok(continent.centroidDir.every(Number.isFinite));
    assert.ok(continent.bounds.centerDir.every(Number.isFinite));
    assert.ok(Number.isFinite(continent.bounds.angularRadius));
});
