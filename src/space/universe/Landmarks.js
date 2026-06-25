import * as THREE from 'three';
import { BlackHole } from '../BlackHole.js';
import { SpatialAnomaly } from '../SpatialAnomaly.js';
import { randomRange } from './rng.js';
import { getImpostorTexture } from './impostors.js';

const MASS = Object.freeze({
    blackhole: 2.0e7,
    pulsar: 8.0e6,
    anomaly: 1.0e6
});

export class Landmarks {
    constructor({ rng, web, config }) {
        this.rng = rng;
        this.web = web;
        this.config = config;
        this.group = new THREE.Group();
        this.group.name = 'UniverseLandmarks';
        this.blackHoles = [];
        this.anomalies = [];
        this._create();
        this.setRuntimeConfig(config.blackHoles);
    }

    update(shipPosition, dt) {
        const raymarched = this.blackHoles
            .map((entry) => ({ entry, distance: shipPosition.distanceTo(entry.position) }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 2)
            .map((entry) => entry.entry);

        for (const entry of this.blackHoles) {
            const close = raymarched.includes(entry) && shipPosition.distanceTo(entry.position) < 130000;
            entry.blackHole.mesh.visible = close;
            entry.sprite.visible = !close;
            entry.blackHole.update(dt);
            entry.sprite.material.rotation += dt * 0.012 * (entry.isPulsar ? 2.5 : 1);
        }

        for (const anomaly of this.anomalies) anomaly.instance.update(dt);
    }

    setRuntimeConfig(blackHoles) {
        this.config.blackHoles = { ...this.config.blackHoles, ...blackHoles };
        for (const entry of this.blackHoles) {
            entry.blackHole.bloomIntensity = this.config.blackHoles.bloomIntensity * (entry.isPulsar ? 1.2 : 1);
            entry.blackHole.distortion = this.config.blackHoles.distortion;
            entry.blackHole.diskRadius = this.config.blackHoles.diskRadius;
            entry.blackHole.beaming = this.config.blackHoles.beaming;
            entry.blackHole.photonGlow = this.config.blackHoles.photonGlow;
            entry.blackHole.photonWidth = this.config.blackHoles.photonWidth;
            entry.blackHole.photonRadius = this.config.blackHoles.photonRadius;
            entry.blackHole.mesh.scale.setScalar(this.config.blackHoles.scale * entry.scaleFactor);
            entry.blackHole.mesh.material.uniforms.uColorInner.value.set(this.config.blackHoles.colorInner);
            entry.blackHole.mesh.material.uniforms.uColorOuter.value.set(this.config.blackHoles.colorOuter);
            entry.sprite.scale.setScalar(this.config.blackHoles.scale * entry.scaleFactor * 42);
            entry.sprite.material.opacity = Math.min(1, this.config.blackHoles.bloomIntensity * 0.42);
        }

        for (const anomaly of this.anomalies) {
            anomaly.instance.params.bloomIntensity = this.config.blackHoles.bloomIntensity * 1.25;
            anomaly.instance.mesh.material.uniforms.uBloomIntensity.value = anomaly.instance.params.bloomIntensity;
        }
    }

    setVisualGlow({ sceneGlow = 1, landmarkGlow = 1 } = {}) {
        const boost = Math.max(0, sceneGlow) * Math.max(0, landmarkGlow);
        for (const entry of this.blackHoles) {
            entry.blackHole.bloomIntensity = this.config.blackHoles.bloomIntensity * boost * (entry.isPulsar ? 1.2 : 1);
            entry.sprite.material.opacity = Math.min(1, 0.42 * boost);
        }
        for (const anomaly of this.anomalies) {
            anomaly.instance.params.bloomIntensity = this.config.blackHoles.bloomIntensity * 1.25 * boost;
            anomaly.instance.mesh.material.uniforms.uBloomIntensity.value = anomaly.instance.params.bloomIntensity;
        }
    }

    getAttractors() {
        return this.blackHoles.map((entry) => ({
            type: entry.isPulsar ? 'pulsar' : 'blackhole',
            name: entry.name,
            position: entry.position,
            mass: entry.isPulsar ? MASS.pulsar : MASS.blackhole,
            dangerProfile: entry.dangerProfile
        }));
    }

    getPOIs() {
        return [
            ...this.blackHoles.map((entry) => ({
                type: entry.isPulsar ? 'pulsar' : 'blackhole',
                name: entry.name,
                position: entry.position,
                mass: entry.isPulsar ? MASS.pulsar : MASS.blackhole,
                isHeroLight: true,
                color: new THREE.Color(entry.isPulsar ? '#aaccff' : this.config.blackHoles.colorInner),
                intensity: entry.isPulsar ? 1.35 : 1.1,
                dangerProfile: entry.dangerProfile
            })),
            ...this.anomalies.map((entry) => ({
                type: 'anomaly',
                name: entry.name,
                position: entry.position,
                mass: MASS.anomaly,
                dangerProfile: entry.dangerProfile
            }))
        ];
    }

    _create() {
        if (!this.config.blackHoles.enabled) return;
        const blackHoleCount = Math.max(0, Math.floor(this.config.blackHoles.blackHoleCount));
        const pulsarCount = Math.max(0, Math.floor(this.config.blackHoles.pulsarCount));
        const anomalyCount = Math.max(0, Math.floor(this.config.blackHoles.anomalyCount));

        for (let i = 0; i < blackHoleCount; i++) this._addBlackHole(i, false);
        for (let i = 0; i < pulsarCount; i++) this._addBlackHole(i, true);
        for (let i = 0; i < anomalyCount; i++) this._addAnomaly(i);
    }

    _addBlackHole(index, isPulsar) {
        const sample = index === 0 && !isPulsar
            ? this.web.sample(this.rng, { nodeBias: 1, filamentBias: 0, voidScatter: 0, spread: 0.14 })
            : this.web.sample(this.rng, { nodeBias: isPulsar ? 0.62 : 0.76, filamentBias: 0.24, voidScatter: 0.04, spread: 0.42 });
        const scaleFactor = randomRange(this.rng, isPulsar ? 0.7 : 0.9, isPulsar ? 1.1 : 1.7);
        const blackHole = new BlackHole({
            scale: this.config.blackHoles.scale * scaleFactor,
            distortion: this.config.blackHoles.distortion,
            diskRadius: this.config.blackHoles.diskRadius,
            bloomIntensity: this.config.blackHoles.bloomIntensity,
            beaming: this.config.blackHoles.beaming,
            photonGlow: this.config.blackHoles.photonGlow,
            photonWidth: this.config.blackHoles.photonWidth,
            photonRadius: this.config.blackHoles.photonRadius,
            colorInner: isPulsar ? '#cce8ff' : this.config.blackHoles.colorInner,
            colorOuter: isPulsar ? '#9b4dff' : this.config.blackHoles.colorOuter,
            isPulsar,
            rotationSpeed: isPulsar ? 1.7 : randomRange(this.rng, 0.6, 1.2),
            tilt: new THREE.Euler(randomRange(this.rng, -1.4, 1.4), randomRange(this.rng, -0.5, 0.5), randomRange(this.rng, -0.5, 0.5))
        });
        blackHole.mesh.position.copy(sample.position);

        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: getImpostorTexture('blackhole', {
                inner: isPulsar ? '#cce8ff' : this.config.blackHoles.colorInner,
                outer: isPulsar ? '#9b4dff' : this.config.blackHoles.colorOuter
            }),
            transparent: true,
            opacity: 0.72,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        }));
        sprite.position.copy(sample.position);
        sprite.scale.setScalar(this.config.blackHoles.scale * scaleFactor * 42);

        const entry = {
            name: isPulsar ? `Pulsar ${index + 1}` : index === 0 ? 'Spawn black hole' : `Black hole ${index + 1}`,
            position: sample.position.clone(),
            node: sample.node,
            blackHole,
            sprite,
            isPulsar,
            scaleFactor,
            dangerProfile: {
                type: isPulsar ? 'pulsar' : 'blackhole',
                lethalRadius: this.config.blackHoles.scale * scaleFactor * 1.4,
                heatRadius: this.config.blackHoles.scale * scaleFactor * 18,
                tidalRadius: this.config.blackHoles.scale * scaleFactor * 40
            }
        };
        this.blackHoles.push(entry);
        this.group.add(blackHole.mesh, sprite);
    }

    _addAnomaly(index) {
        const sample = this.web.sample(this.rng, { nodeBias: 0.58, filamentBias: 0.32, voidScatter: 0.08, spread: 0.6 });
        const anomaly = new SpatialAnomaly({
            radius: randomRange(this.rng, 120, 360),
            color: this.rng() < 0.5 ? 0x44ffdd : 0xaa66ff,
            bloomIntensity: this.config.blackHoles.bloomIntensity * 1.25,
            speed: randomRange(this.rng, 0.45, 1.25),
            maxDistortion: randomRange(this.rng, 0.45, 0.85)
        });
        anomaly.mesh.position.copy(sample.position);
        const entry = {
            name: `Spatial anomaly ${index + 1}`,
            position: sample.position.clone(),
            instance: anomaly,
            dangerProfile: {
                type: 'anomaly',
                lethalRadius: 0,
                heatRadius: anomaly.params.radius * 5,
                tidalRadius: anomaly.params.radius * 9
            }
        };
        this.anomalies.push(entry);
        this.group.add(anomaly.mesh);
    }
}
