import * as THREE from 'three';
import { randomRange, weightedChoice } from './rng.js';
import { getImpostorTexture } from './impostors.js';

export class UniverseEvents {
    constructor({ rng, config }) {
        this.rng = rng;
        this.config = config;
        this.group = new THREE.Group();
        this.group.name = 'UniverseEvents';
        this.events = [];
        this.clock = 0;
        this.nextEventAt = this._scheduleNext();
    }

    update(dt, context) {
        this.clock += dt;
        if (this.clock >= this.nextEventAt) {
            this._spawnEvent(context);
            this.nextEventAt = this.clock + this._scheduleNext();
        }

        for (let i = this.events.length - 1; i >= 0; i--) {
            const event = this.events[i];
            event.age += dt;
            event.update(dt, event);
            if (event.age > event.duration) {
                this.group.remove(event.object);
                event.object.material?.map?.dispose?.();
                event.object.material?.dispose?.();
                event.object.geometry?.dispose?.();
                this.events.splice(i, 1);
            }
        }
    }

    setRuntimeConfig(events) {
        this.config.events = { ...this.config.events, ...events };
    }

    _scheduleNext() {
        const rate = Math.max(0.0001, this.config.events.eventRate);
        return -Math.log(Math.max(0.0001, this.rng())) / rate;
    }

    _spawnEvent({ shipPosition, pois }) {
        const enabled = [
            { value: 'supernova', weight: this.config.events.supernova ? 1 : 0 },
            { value: 'pulsarSweep', weight: this.config.events.pulsarSweep ? 0.85 : 0 },
            { value: 'comet', weight: this.config.events.comet ? 1.2 : 0 },
            { value: 'ionStorm', weight: this.config.events.ionStorm ? 0.8 : 0 }
        ];
        const type = weightedChoice(this.rng, enabled);
        if (!type) return;

        if (type === 'comet') this._spawnComet(shipPosition);
        else if (type === 'pulsarSweep') this._spawnPulse(pois.find((poi) => poi.type === 'pulsar')?.position ?? shipPosition);
        else if (type === 'ionStorm') this._spawnPulse(pois.find((poi) => poi.type === 'nebula')?.position ?? shipPosition, '#31ffd7');
        else this._spawnSupernova(shipPosition);
    }

    _spawnSupernova(shipPosition) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: getImpostorTexture('glow', { inner: '#ffffff', outer: '#77aaff' }),
            transparent: true,
            opacity: 1,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        }));
        sprite.position.copy(shipPosition).add(randomDirection(this.rng).multiplyScalar(randomRange(this.rng, 50000, 180000)));
        sprite.scale.setScalar(1200);
        this._add(sprite, 7, (dt, event) => {
            const t = event.age / event.duration;
            sprite.scale.setScalar(1200 + t * 28000);
            sprite.material.opacity = (1 - t) * this.config.events.intensity;
        });
    }

    _spawnComet(shipPosition) {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(36 * 3);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const material = new THREE.LineBasicMaterial({
            color: 0x9bdcff,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending
        });
        const line = new THREE.Line(geometry, material);
        const start = shipPosition.clone().add(randomDirection(this.rng).multiplyScalar(90000));
        const velocity = randomDirection(this.rng).multiplyScalar(36000);
        this._add(line, 5.5, () => {
            for (let i = 0; i < 36; i++) {
                const p = start.clone().add(velocity.clone().multiplyScalar(this.events.find((e) => e.object === line)?.age ?? 0));
                p.addScaledVector(velocity, -i * 0.018);
                positions[i * 3] = p.x;
                positions[i * 3 + 1] = p.y;
                positions[i * 3 + 2] = p.z;
            }
            geometry.attributes.position.needsUpdate = true;
            material.opacity = 0.9 * this.config.events.intensity;
        });
    }

    _spawnPulse(position, color = '#aaccff') {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: getImpostorTexture('glow', { inner: color, outer: '#ffffff' }),
            color,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        }));
        sprite.position.copy(position);
        sprite.scale.setScalar(3000);
        this._add(sprite, 4.5, (dt, event) => {
            const t = event.age / event.duration;
            sprite.scale.set(6000 + t * 50000, 900 + t * 8000, 1);
            sprite.material.rotation += dt * 2.2;
            sprite.material.opacity = Math.sin(t * Math.PI) * this.config.events.intensity;
        });
    }

    _add(object, duration, update) {
        const event = { object, duration, update, age: 0 };
        this.events.push(event);
        this.group.add(object);
    }
}

function randomDirection(rng) {
    const theta = rng() * Math.PI * 2;
    const z = rng() * 2 - 1;
    const r = Math.sqrt(1 - z * z);
    return new THREE.Vector3(Math.cos(theta) * r, z, Math.sin(theta) * r);
}
