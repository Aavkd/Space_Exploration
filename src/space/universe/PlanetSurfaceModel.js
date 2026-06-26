import * as THREE from 'three';
import { createSeededRandom, deriveSeed, randomRange } from './rng.js';
import { PlanetHeightBasis } from './planetHeightBasis.js';

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
        let height = this.radius + this.reliefMetres * fields.elevationLand;

        const landMask = this.hasWater
            ? THREE.MathUtils.smoothstep(fields.land, 0.02, 0.28)
            : THREE.MathUtils.smoothstep(fields.elevationLand, 0.04, 0.22);
        if (landMask > 0) {
            height += this._basis.detailAt(dir) * (this.surface.detailAmplitude ?? 0) * landMask;
            height += this._basis.ridgeAt(dir) * (this.surface.ridgeAmplitude ?? this.surface.localReliefAmplitude ?? 0) * landMask;
            height += this._basis.microAt(dir) * (this.surface.microAmplitude ?? this.surface.microReliefAmplitude ?? 0) * landMask;
        }

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

        if (this.hasWater && fields.n < this.seaLevel) return this.radius;
        return height;
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
        target.color = this._colorForSample(classification, target.color ?? new THREE.Color(), dir);

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

    _colorForSample(sample, target, dir) {
        const p = this.palette;
        const base = target;
        switch (sample.material) {
            case 'water':
                base.set(p.water ?? '#1d5f91').lerp(this._tmpColor.set('#071c35'), 0.2);
                break;
            case 'acid':
                base.set(p.water ?? '#8aa72c').lerp(this._tmpColor.set(p.emissive ?? '#a6ff21'), 0.22);
                break;
            case 'snow':
                base.set(p.snow ?? '#f3f8ff');
                break;
            case 'rock':
            case 'dark rock':
            case 'basalt':
                base.set(p.rock ?? '#333333').lerp(this._tmpColor.set(p.highland ?? '#777777'), sample.material === 'dark rock' ? 0.12 : 0.28);
                break;
            case 'lava':
                base.set(p.emissive ?? '#ff5b1f').lerp(this._tmpColor.set(p.accent ?? '#b63a1e'), 0.28);
                break;
            case 'sand':
            case 'salt flat':
                base.set(p.lowland ?? '#d0a354').lerp(this._tmpColor.set(p.accent ?? '#f0c66b'), sample.material === 'salt flat' ? 0.36 : 0.14);
                break;
            case 'mesa rock':
                base.set(p.midland ?? '#9b5930').lerp(this._tmpColor.set(p.highland ?? '#6a4635'), 0.35);
                break;
            case 'ash':
                base.set(p.midland ?? '#554943').lerp(this._tmpColor.set(p.rock ?? '#111111'), 0.45);
                break;
            case 'blue ice':
                base.set(p.lowland ?? '#b9e4f0').lerp(this._tmpColor.set(p.accent ?? '#58c7ff'), 0.42);
                break;
            case 'ejecta rock':
                base.set(p.highland ?? '#d0c3aa').lerp(this._tmpColor.set(p.rock ?? '#2f2d2a'), 0.18);
                break;
            case 'sulfur':
            case 'acid crust':
                base.set(p.midland ?? '#708236').lerp(this._tmpColor.set(p.accent ?? '#d7ff49'), sample.material === 'acid crust' ? 0.4 : 0.18);
                break;
            default:
                base.set(p.lowland ?? '#8fb37a').lerp(this._tmpColor.set(p.midland ?? '#9a7b45'), 0.25);
                break;
        }

        const fleck = this._basis.microAt ? this._basis.microAt(dir) : 0;
        if (Number.isFinite(fleck)) base.multiplyScalar(0.95 + fleck * 0.04);
        return base;
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

function randomUnitVector(rng, target) {
    const z = rng() * 2 - 1;
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    return target.set(Math.cos(a) * r, z, Math.sin(a) * r);
}
