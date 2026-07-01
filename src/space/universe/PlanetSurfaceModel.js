import * as THREE from 'three';
import { createSeededRandom, deriveSeed, randomRange } from './rng.js';
import { PlanetHeightBasis } from './planetHeightBasis.js';
import { PlanetRegionMap } from './PlanetRegionMap.js';

const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
const NORMAL_SAMPLE_METRES = 80;

export class PlanetSurfaceModel {
    constructor({ descriptor = {}, radius, seed } = {}) {
        this.descriptor = descriptor;
        this.seed = seed ?? descriptor.seed ?? descriptor.childSeed ?? 'planet';
        this.radius = radius ?? descriptor.radius ?? 1;
        this.type = descriptor.type ?? 'temperate';
        this.kind = descriptor.kind ?? 'terrestrial';
        this.palette = descriptor.palette ?? {};
        this.atmosphere = descriptor.atmosphere ?? {};
        this.clouds = descriptor.clouds ?? {};
        this.surface = descriptor.surface ?? {};
        this.hasWater = this.surface.hasWater ?? (this.type === 'temperate' || this.type === 'toxic');
        this.seaLevel = this.surface.seaLevel ?? 0.5;
        this.reliefMetres = this.surface.reliefMetres ?? 14_000;

        this._basis = new PlanetHeightBasis({
            seed: this.seed,
            radius: this.radius,
            reliefMetres: this.reliefMetres,
            seaLevel: this.seaLevel,
            baseFreq: this.surface.baseFreq ?? 2.2,
            detailAmplitude: this.surface.detailAmplitude ?? 0,
            detailFreq: this.surface.detailFreq ?? 380,
            localReliefAmplitude: this.surface.ridgeAmplitude ?? this.surface.localReliefAmplitude ?? 0,
            localReliefFreq: this.surface.ridgeFreq ?? this.surface.localReliefFreq ?? 980,
            microReliefAmplitude: this.surface.microAmplitude ?? this.surface.microReliefAmplitude ?? 0,
            microReliefFreq: this.surface.microFreq ?? this.surface.microReliefFreq ?? 5200
        });

        const rng = createSeededRandom(deriveSeed(this.seed, 'surface-features'));
        this._featureOffset = new THREE.Vector3(
            randomRange(rng, -80, 80),
            randomRange(rng, -80, 80),
            randomRange(rng, -80, 80)
        );
        this._craters = this._createCraters(rng);

        this._u = new THREE.Vector3();
        this._v = new THREE.Vector3();
        this._pa = new THREE.Vector3();
        this._pb = new THREE.Vector3();
        this._pc = new THREE.Vector3();
        this._pd = new THREE.Vector3();
        this._tmpColor = new THREE.Color();
        this._tmpColorB = new THREE.Color();
        this._c0 = new THREE.Color();
        // Photoreal-leaning material palette derived once from the preset palette.
        // The per-vertex albedo is a continuous blend of these across
        // elevation/slope/moisture/latitude, not a single flat colour per biome.
        this._matColors = buildMaterialColors(this.type, this.palette);
        this._regionMap = null;
    }

    landAt(dir) {
        const fields = this._baseFields(dir);
        return { n: fields.n, land: fields.land, elevationLand: fields.elevationLand };
    }

    heightAt(dir) {
        return this.surfaceRadiusAt(dir);
    }

    surfaceRadiusAt(dir) {
        const fields = this._baseFields(dir);
        // Flat ocean floor at sea level; the water shell renders above it.
        if (this.hasWater && fields.n < this.seaLevel) return this.radius;

        // Land amount in [0,1]: 0 at the shoreline, 1 at a continental interior.
        const e = THREE.MathUtils.clamp(fields.elevationLand, 0, 1);

        // Coastal shelf: flatten ONLY the first ~12% of land so beaches are broad
        // and flat, then rise linearly so continents keep their full height and
        // variation (a power curve on the whole range would crush the relief,
        // since land values already peak well below 1).
        const shelf = THREE.MathUtils.smoothstep(e, 0.0, 0.12);
        let height = this.radius + this.reliefMetres * e * shelf;

        // Coast gate: 0 at the waterline → 1 just inland, so relief never builds on
        // the flat beach but reaches full strength across the continent quickly.
        const inland = THREE.MathUtils.smoothstep(e, 0.03, 0.2);

        if (inland > 0) {
            // Low-frequency ruggedness belts: broad regions stay plains (gentle
            // relief), others build into full mountain ranges — the source of
            // large-scale terrain variety.
            const belt = THREE.MathUtils.smoothstep(this._ruggednessAt(dir), 0.4, 0.72);

            // Ridged noise → mountain ranges. Plains keep low rolling relief (0.15),
            // belts build the tall ranges (up to ~1.15×).
            const ridge = Math.max(0, this._basis.ridgeAt(dir));
            const mountainAmp = this.surface.ridgeAmplitude ?? this.surface.localReliefAmplitude ?? 0;
            height += ridge * mountainAmp * inland * (0.15 + belt);

            // Mid-scale hills and fine roughness.
            height += this._basis.detailAt(dir) * (this.surface.detailAmplitude ?? 0)
                * inland * (0.55 + belt * 0.45);
            height += this._basis.microAt(dir)
                * (this.surface.microAmplitude ?? this.surface.microReliefAmplitude ?? 0) * inland;
        }

        const landMask = inland;
        if (this.type === 'desert') height += this._duneAt(dir) * (this.surface.duneStrength ?? 0.5) * 260 * landMask;
        if (this.type === 'barren') height += this._craterHeightAt(dir);
        if (this.type === 'volcanic' || this.type === 'toxic') {
            const channel = this._channelMaskAt(dir);
            height -= channel * (this.surface.channelStrength ?? 0.4) * (this.type === 'volcanic' ? 520 : 180);
        }
        if (this.type === 'ice') {
            const crack = this._crackMaskAt(dir);
            height += crack * (this.surface.crackStrength ?? 0.6) * 140;
        }

        return height;
    }

    // Large-scale, low-frequency mask in ~[0,1] that decides where mountain belts
    // form vs. where the land stays plains. Pure function of direction/seed.
    _ruggednessAt(dir) {
        const f = this.surface.ruggednessFreq ?? 1.7;
        return this._basis._fbm(
            dir.x * f + this._featureOffset.z * 0.3,
            dir.y * f + this._featureOffset.x * 0.3,
            dir.z * f + this._featureOffset.y * 0.3
        );
    }

    sampleAt(dir, target = {}, { includeSlope = false, normal = null } = {}) {
        const fields = this._baseFields(dir);
        const height = this.surfaceRadiusAt(dir);
        const elevation = height - this.radius;
        const normalizedElevation = THREE.MathUtils.clamp(elevation / Math.max(this.reliefMetres, 1), -0.4, 1.6);
        const moisture = this._moistureAt(dir);
        const temperature = this._temperatureAt(dir);
        const crater = this.type === 'barren' ? this._craterMaskAt(dir) : 0;
        const channel = (this.type === 'volcanic' || this.type === 'toxic') ? this._channelMaskAt(dir) : 0;
        const crack = this.type === 'ice' ? this._crackMaskAt(dir) : 0;
        const isLiquid = this.hasWater && fields.n < this.seaLevel;
        const classification = this._classify({
            dir,
            fields,
            normalizedElevation,
            moisture,
            temperature,
            crater,
            channel,
            crack,
            isLiquid
        });

        target.height = height;
        target.radius = height;
        target.elevation = elevation;
        target.normalizedElevation = normalizedElevation;
        target.land = fields.land;
        target.coarse = fields.n;
        target.moisture = moisture;
        target.temperature = temperature;
        target.biome = classification.biome;
        target.material = classification.material;
        target.roughnessHint = classification.roughnessHint;
        target.emissiveStrength = classification.emissiveStrength;
        target.isLiquid = isLiquid;

        // Continuous slope factor in [0,1] (0 = flat, 1 = cliff). The rendered
        // terrain path passes the real finite-difference normal; the low-res
        // preview path falls back to the ridge field as a steepness proxy.
        let slopeFactor;
        if (normal) {
            slopeFactor = 1 - THREE.MathUtils.clamp(normal.dot(dir), 0, 1);
        } else {
            slopeFactor = THREE.MathUtils.clamp(Math.abs(this._basis.ridgeAt(dir)) * 0.6, 0, 1);
        }
        target.color = this._colorForSample(classification, target.color ?? new THREE.Color(), dir, {
            elev: normalizedElevation,
            moist: moisture,
            temp: temperature,
            slope: slopeFactor,
            land: fields.land,
            coarse: fields.n,
            lat: Math.abs(dir.y),
            isLiquid
        });

        if (includeSlope) {
            const n = normal ?? this.normalAt(dir, this._pa);
            target.slope = Math.acos(THREE.MathUtils.clamp(n.dot(dir), -1, 1));
            target.slopeDeg = THREE.MathUtils.radToDeg(target.slope);
        }
        return target;
    }

    normalAt(dir, target = new THREE.Vector3()) {
        const ref = Math.abs(dir.y) < 0.92 ? UP : RIGHT;
        this._u.copy(ref).cross(dir);
        if (this._u.lengthSq() < 1e-10) this._u.set(1, 0, 0).cross(dir);
        this._u.normalize();
        this._v.copy(dir).cross(this._u).normalize();

        const eps = THREE.MathUtils.clamp(NORMAL_SAMPLE_METRES / this.radius, 1e-6, 1e-4);
        this._surfacePoint(this._pa.copy(dir).addScaledVector(this._u, eps).normalize(), this._pa);
        this._surfacePoint(this._pb.copy(dir).addScaledVector(this._u, -eps).normalize(), this._pb);
        this._surfacePoint(this._pc.copy(dir).addScaledVector(this._v, eps).normalize(), this._pc);
        this._surfacePoint(this._pd.copy(dir).addScaledVector(this._v, -eps).normalize(), this._pd);

        const tu = this._pa.sub(this._pb);
        const tv = this._pc.sub(this._pd);
        target.copy(tu).cross(tv).normalize();
        if (target.dot(dir) < 0) target.negate();
        if (!Number.isFinite(target.x)) target.copy(dir);
        return target;
    }

    visualParams() {
        return {
            type: this.type,
            palette: this.palette,
            atmosphere: this.atmosphere,
            clouds: this.clouds,
            surface: this.surface
        };
    }

    detailAt(dir) {
        return this._basis.detailAt(dir);
    }

    ridgeAt(dir) {
        return this._basis.ridgeAt(dir);
    }

    microAt(dir) {
        return this._basis.microAt(dir);
    }

    _baseFields(dir) {
        const { n, land } = this._basis.landAt(dir);
        const dryFloor = this.seaLevel - 0.2;
        const elevationLand = this.hasWater
            ? land
            : THREE.MathUtils.clamp((n - dryFloor) / Math.max(1e-4, 1 - dryFloor), 0, 1);
        return { n, land, elevationLand };
    }

    _classify({ dir, fields, normalizedElevation, moisture, temperature, crater, channel, crack, isLiquid }) {
        const lat = Math.abs(dir.y);
        const high = normalizedElevation > 0.72;
        const steep = this._basis.ridgeAt(dir) > 0.35;

        if (isLiquid) {
            return {
                biome: this.type === 'toxic' ? 'acid flats' : 'ocean',
                material: this.surface.liquidMaterial ?? 'water',
                roughnessHint: 0.18,
                emissiveStrength: this.type === 'toxic' ? 0.08 : 0
            };
        }

        switch (this.type) {
            case 'ice':
                if (crack > 0.45) return classResult('fractured ice', 'blue ice', 0.72, 0.02);
                if (high || steep) return classResult('black ridge', 'dark rock', 0.9, 0);
                return classResult(lat > 0.55 ? 'polar snowfield' : 'ice plain', 'snow', 0.62, 0);
            case 'desert':
                if (high || steep) return classResult('mesa highland', 'mesa rock', 0.86, 0);
                if (this._duneAt(dir) > 0.25) return classResult('dune sea', 'sand', 0.72, 0);
                return classResult('dry basin', 'salt flat', 0.58, 0);
            case 'volcanic':
                if (channel > 0.48) return classResult('lava channel', 'lava', 0.44, 0.85);
                if (high || steep) return classResult('basalt ridge', 'basalt', 0.92, 0);
                return classResult('ash plain', 'ash', 0.78, 0.02);
            case 'barren':
                if (crater > 0.58) return classResult('crater rim', 'ejecta rock', 0.88, 0);
                if (crater > 0.2) return classResult('crater floor', 'dust', 0.74, 0);
                if (high || steep) return classResult('rocky highland', 'rock', 0.9, 0);
                return classResult('regolith plain', 'dust', 0.76, 0);
            case 'toxic':
                if (channel > 0.42) return classResult('acid channel', 'acid crust', 0.5, 0.18);
                if (high || steep) return classResult('poison ridge', 'dark rock', 0.86, 0);
                return classResult(moisture > 0.6 ? 'sulfur flat' : 'toxic plain', 'sulfur', 0.68, 0.05);
            case 'temperate':
            default:
                if (lat > 0.76 || high) return classResult('snow cap', 'snow', 0.64, 0);
                if (steep) return classResult('rock slope', 'rock', 0.9, 0);
                if (moisture > 0.58 && temperature > 0.18) return classResult('green lowland', 'grass', 0.58, 0);
                return classResult(fields.land < 0.18 ? 'coast' : 'highland', fields.land < 0.18 ? 'wet soil' : 'soil', 0.7, 0);
        }
    }

    getRegions() {
        return this._getRegionMap().getRegions();
    }

    getRegion(regionId) {
        return this._getRegionMap().getRegion(regionId);
    }

    regionAt(dir) {
        return this._getRegionMap().regionAt(dir);
    }

    findRegions(query = {}) {
        return this._getRegionMap().findRegions(query);
    }

    getRegionWeather(regionId) {
        return this._getRegionMap().getWeather(regionId);
    }

    resolveRegionPlacement(regionId, options = {}) {
        return this._getRegionMap().resolvePlacement(regionId, options);
    }

    _getRegionMap() {
        this._regionMap ??= new PlanetRegionMap({
            seed: this.seed,
            surface: this
        });
        return this._regionMap;
    }

    // Continuous per-vertex albedo. Instead of one flat colour per biome band it
    // blends the derived material palette across elevation, slope, moisture and
    // latitude, then adds two-scale noise variation, so a temperate world reads as
    // soil → grass → dry highland → bedrock → snow gradients rather than two
    // luminous colour blocks. `ctx` carries the already-computed surface fields.
    _colorForSample(sample, out, dir, ctx = {}) {
        const m = this._matColors;
        const S = THREE.MathUtils.smoothstep;
        const clamp = THREE.MathUtils.clamp;
        const elev = clamp(ctx.elev ?? sample?.normalizedElevation ?? 0, 0, 1.2);
        const moist = ctx.moist ?? 0.5;
        const temp = ctx.temp ?? 0.5;
        const slope = ctx.slope ?? 0;
        const land = ctx.land ?? 1;
        const lat = ctx.lat ?? Math.abs(dir.y);
        const isLiquid = ctx.isLiquid ?? sample?.isLiquid ?? false;
        const c = out;

        if (isLiquid) {
            // Ocean floor / liquid bed tint; the sea-level shell renders above it.
            const shoal = S(this.seaLevel - 0.16, this.seaLevel, ctx.coarse ?? this.seaLevel);
            c.copy(m.waterDeep).lerp(m.waterShallow, shoal);
            return this._applyGrain(c, dir, 0.05);
        }

        // Per-type ground base (continuous over elevation/moisture).
        switch (this.type) {
            case 'ice':
                c.copy(m.ice).lerp(m.snow, S(0.08, 0.5, elev));
                if (sample.material === 'blue ice') c.lerp(m.accent, 0.5);
                break;
            case 'desert':
                c.copy(m.sand).lerp(m.soil, S(0.26, 0.6, elev));
                c.lerp(m.highland, S(0.58, 0.85, elev));
                if (sample.material === 'salt flat') c.lerp(m.snow, 0.28);
                break;
            case 'volcanic':
                c.copy(m.rock).lerp(m.soil, S(0.2, 0.72, elev) * 0.6);
                break;
            case 'barren':
                c.copy(m.soil).lerp(m.highland, S(0.28, 0.8, elev));
                break;
            case 'toxic':
                c.copy(m.grass).lerp(m.highland, S(0.4, 0.82, elev));
                if (moist > 0.6) c.lerp(m.accent, 0.22);
                break;
            case 'temperate':
            default:
                c.copy(m.drygrass).lerp(m.grass, S(0.3, 0.72, moist));
                c.lerp(m.forest, S(0.6, 0.95, moist) * 0.7);
                c.lerp(m.soil, S(0.36, 0.66, elev));
                c.lerp(m.highland, S(0.62, 0.86, elev));
                break;
        }

        // Steep faces expose bedrock on every rocky world.
        c.lerp(m.rock, S(0.16, 0.44, slope));

        // Snow/ice caps on cold, high, or polar ground — never on hot worlds.
        if (this.type !== 'volcanic' && this.type !== 'toxic') {
            const cold = this.type === 'ice' ? 1 : clamp(1 - temp * 1.3, 0, 1);
            const snowAmt = clamp((S(0.55, 0.86, elev) + S(0.8, 0.98, lat)) * (0.4 + cold), 0, 1)
                * (1 - slope * 0.55);
            if (snowAmt > 0) c.lerp(m.snow, snowAmt);
        }

        // Lava/acid channels stay emissive-bright over the blended base.
        if ((sample.emissiveStrength ?? 0) > 0.3) {
            c.lerp(m.emissive, clamp(sample.emissiveStrength, 0, 0.85));
        }

        // Sandy beach only in the thin band right at the waterline — never on the
        // wider low-lying plains. Fully sand at the shore, fully ground by ~5% land.
        if (this.hasWater && land < 0.06) {
            this._c0.copy(c);
            c.copy(m.beach).lerp(this._c0, S(0.006, 0.05, land));
        }

        return this._applyGrain(c, dir, 0.16);
    }

    // Two-scale value variation (broad patches + fine grain) to break up flat
    // colour fields without touching hue. Pure function of direction, so it is
    // deterministic and stable across LOD.
    _applyGrain(c, dir, amount) {
        const patch = this._basis._fbm(
            dir.x * 11 + this._featureOffset.y,
            dir.y * 11 + this._featureOffset.z,
            dir.z * 11 + this._featureOffset.x
        );
        const grain = this._basis.microAt ? this._basis.microAt(dir) : 0;
        const v = 1 + (patch - 0.5) * amount * 2 + grain * amount * 0.45;
        return c.multiplyScalar(THREE.MathUtils.clamp(v, 0.72, 1.32));
    }

    _moistureAt(dir) {
        const f = this.surface.moistureFreq ?? 5.5;
        return this._basis._fbm(
            dir.x * f + this._featureOffset.x,
            dir.y * f + this._featureOffset.y,
            dir.z * f + this._featureOffset.z
        );
    }

    _temperatureAt(dir) {
        const lat = Math.abs(dir.y);
        const noise = this._basis._fbm(
            dir.x * 3.1 + this._featureOffset.z,
            dir.y * 3.1 + this._featureOffset.x,
            dir.z * 3.1 + this._featureOffset.y
        );
        return THREE.MathUtils.clamp(1 - lat * 1.18 + (noise - 0.5) * 0.32 + (this.surface.temperatureBias ?? 0), 0, 1);
    }

    _duneAt(dir) {
        const wave = Math.sin((dir.x * 24 + dir.z * 18 + dir.y * 5) + this._featureOffset.x);
        return wave * 0.5 + (this._basis.detailAt(dir) * 0.5);
    }

    _channelMaskAt(dir) {
        const n = this._basis._fbm(
            dir.x * 9.5 + this._featureOffset.x * 0.7,
            dir.y * 9.5 + this._featureOffset.y * 0.7,
            dir.z * 9.5 + this._featureOffset.z * 0.7
        );
        return THREE.MathUtils.smoothstep(1 - Math.abs(n * 2 - 1), 0.72, 0.94);
    }

    _crackMaskAt(dir) {
        const n = this._basis._fbm(
            dir.x * 14 + this._featureOffset.z * 0.4,
            dir.y * 14 + this._featureOffset.x * 0.4,
            dir.z * 14 + this._featureOffset.y * 0.4
        );
        return THREE.MathUtils.smoothstep(1 - Math.abs(n * 2 - 1), 0.68, 0.92);
    }

    _createCraters(rng) {
        if (this.type !== 'barren') return [];
        const count = Math.max(8, Math.floor(this.surface.craterDensity ?? 20));
        const craters = [];
        for (let i = 0; i < count; i++) {
            craters.push({
                dir: randomUnitVector(rng, new THREE.Vector3()).clone(),
                radius: randomRange(rng, 0.006, 0.032),
                depth: randomRange(rng, 180, 1200) * (this.surface.craterStrength ?? 1)
            });
        }
        return craters;
    }

    _craterHeightAt(dir) {
        let h = 0;
        for (const crater of this._craters) {
            const d = Math.acos(THREE.MathUtils.clamp(dir.dot(crater.dir), -1, 1));
            const x = d / crater.radius;
            if (x >= 1.45) continue;
            const bowl = x < 1 ? -(1 - x * x) * crater.depth : 0;
            const rim = Math.exp(-((x - 1.05) * (x - 1.05)) / 0.028) * crater.depth * 0.38;
            h += bowl + rim;
        }
        return h;
    }

    _craterMaskAt(dir) {
        let mask = 0;
        for (const crater of this._craters) {
            const d = Math.acos(THREE.MathUtils.clamp(dir.dot(crater.dir), -1, 1));
            const x = d / crater.radius;
            if (x >= 1.45) continue;
            mask = Math.max(mask, x < 1 ? 0.35 + (1 - x) * 0.45 : Math.exp(-((x - 1.05) * (x - 1.05)) / 0.028));
        }
        return mask;
    }

    _surfacePoint(dir, target) {
        return target.copy(dir).multiplyScalar(this.surfaceRadiusAt(dir));
    }
}

function classResult(biome, material, roughnessHint, emissiveStrength) {
    return { biome, material, roughnessHint, emissiveStrength };
}

// Derive a small set of named material colours from a preset palette once per
// planet. These are the stops the per-vertex albedo blends between; they are
// read-only during sampling (no per-vertex allocation).
function buildMaterialColors(type, palette = {}) {
    const mk = (hex) => new THREE.Color(hex);
    const water = palette.water ?? '#1d5f91';
    const lowland = palette.lowland ?? '#4f9b58';
    const midland = palette.midland ?? '#9a7b45';
    const highland = palette.highland ?? '#60635f';
    return {
        waterDeep: mk(water).multiplyScalar(0.5),
        waterShallow: mk(water).lerp(mk('#6fc7d6'), 0.5),
        grass: mk(lowland),
        forest: mk(lowland).lerp(mk('#20351f'), 0.55),
        drygrass: mk(lowland).lerp(mk('#9a8f4a'), 0.42),
        soil: mk(midland),
        drysoil: mk(midland).lerp(mk('#6b5030'), 0.4),
        highland: mk(highland),
        rock: mk(palette.rock ?? '#343a36'),
        snow: mk(palette.snow ?? '#e7f2f4'),
        ice: mk(type === 'ice' ? lowland : '#cfe6ef'),
        sand: mk(palette.accent ?? '#d8c98b'),
        beach: mk(palette.accent ?? '#cbb887').lerp(mk('#b7a06a'), 0.4),
        accent: mk(palette.accent ?? '#d8c98b'),
        emissive: mk(palette.emissive ?? '#ff5b1f')
    };
}

function randomUnitVector(rng, target) {
    const z = rng() * 2 - 1;
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    return target.set(Math.cos(a) * r, z, Math.sin(a) * r);
}
