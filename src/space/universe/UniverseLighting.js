import * as THREE from 'three';

export class UniverseLighting {
    constructor({ config }) {
        this.config = config;
        this.group = new THREE.Group();
        this.group.name = 'UniverseLighting';
        this.light = new THREE.DirectionalLight(0xffffff, 0.8);
        this.target = new THREE.Object3D();
        this.ambient = new THREE.AmbientLight(0x222244, config.lighting.ambientLevel);
        this.light.position.set(-12000, 6000, -8000);
        this.light.target = this.target;
        this.group.add(this.light, this.target, this.ambient);
        this._position = this.light.position.clone();
        this._color = new THREE.Color(0xaaccff);
    }

    update(shipPosition, heroLights, dt) {
        const cfg = this.config.lighting;
        let chosen = null;
        let bestScore = Infinity;

        for (const source of heroLights) {
            const distance = shipPosition.distanceTo(source.position);
            if (distance > cfg.range) continue;
            const score = distance / Math.max(source.intensity ?? 1, 0.1);
            if (score < bestScore) {
                chosen = { source, distance };
                bestScore = score;
            }
        }

        const desiredPosition = chosen
            ? chosen.source.position
            : shipPosition.clone().add(new THREE.Vector3(-20000, 11000, -14000));
        const desiredColor = chosen?.source.color?.clone?.() ?? new THREE.Color(0xaaccff);
        const falloff = chosen
            ? THREE.MathUtils.clamp(1 - chosen.distance / Math.max(cfg.range, 1), 0.08, 1)
            : 0.25;
        const desiredIntensity = cfg.intensity * (0.18 + falloff * falloff * 1.7);
        const lerp = THREE.MathUtils.clamp(dt * cfg.lerpSpeed, 0, 1);

        this._position.lerp(desiredPosition, lerp);
        this._color.lerp(desiredColor, lerp * cfg.temperatureInfluence);
        this.light.position.copy(this._position);
        this.target.position.copy(shipPosition);
        this.light.color.copy(this._color);
        this.light.intensity = THREE.MathUtils.lerp(this.light.intensity, desiredIntensity, lerp);
        this.ambient.intensity = cfg.ambientLevel;
    }

    setRuntimeConfig(lighting) {
        this.config.lighting = { ...this.config.lighting, ...lighting };
        this.ambient.intensity = this.config.lighting.ambientLevel;
    }
}
