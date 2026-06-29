import * as THREE from 'three';

const DEFAULTS = Object.freeze({
    walkSpeed: 3.0,
    runSpeed: 5.4,
    slopeLimitDeg: 42
});

const WORLD_FORWARD = new THREE.Vector3(0, 0, -1);
const WORLD_RIGHT = new THREE.Vector3(1, 0, 0);

export class SurfaceLocomotion {
    constructor({ surface = null, config = {} } = {}) {
        this.surface = surface;
        this.config = { ...DEFAULTS, ...config };
        this.lastStep = {
            grounded: false,
            blockedSlope: false,
            blockedStructure: false,
            slopeDeg: 0,
            altitude: Infinity,
            surfaceUp: [0, 1, 0],
            surfaceNormal: [0, 1, 0]
        };

        this._preferredForward = WORLD_FORWARD.clone();
        this._sample = null;
        this._candidateSample = null;
        this._up = new THREE.Vector3();
        this._normal = new THREE.Vector3();
        this._baseForward = new THREE.Vector3();
        this._forward = new THREE.Vector3();
        this._right = new THREE.Vector3();
        this._move = new THREE.Vector3();
        this._candidate = new THREE.Vector3();
        this._axis = new THREE.Vector3();
    }

    setSurface(surface) {
        this.surface = surface;
    }

    setConfig(config = {}) {
        Object.assign(this.config, config);
    }

    setPreferredForward(forward) {
        if (!forward?.isVector3 || forward.lengthSq() < 1e-8) return;
        this._preferredForward.copy(forward).normalize();
    }

    walk(position, yaw, move, dt, { run = false } = {}) {
        if (!this.surface?.getSurfaceSample) {
            this.lastStep = { ...this.lastStep, grounded: false };
            return this.lastStep;
        }

        const speed = run ? this.config.runSpeed : this.config.walkSpeed;
        this._sample = this.surface.getSurfaceSample(position, this._sample);
        this._up.copy(this._sample.up);
        this._normal.copy(this._sample.normal);
        this._makeBaseForward(this._up, this._baseForward);

        this._axis.copy(this._up).normalize();
        this._forward.copy(this._baseForward).applyAxisAngle(this._axis, yaw).normalize();
        this._right.copy(this._forward).cross(this._up).normalize();

        this._move
            .copy(this._forward).multiplyScalar(move.forward ?? 0)
            .addScaledVector(this._right, move.strafe ?? 0);
        if (this._move.lengthSq() > 1e-8) this._move.normalize().multiplyScalar(speed * dt);

        this._candidate.copy(position).add(this._move);
        this._candidateSample = this.surface.getSurfaceSample(this._candidate, this._candidateSample);

        const slopeLimit = this.config.slopeLimitDeg;
        const blockedSlope = this._candidateSample.slopeDeg > slopeLimit;
        let blockedStructure = false;
        let sample = blockedSlope ? this._sample : this._candidateSample;
        if (!blockedSlope && typeof this.surface.resolveSurfaceCombatMovement === 'function') {
            const resolved = this.surface.resolveSurfaceCombatMovement(position, sample.point, 0.45);
            blockedStructure = resolved === position;
            if (blockedStructure) sample = this._sample;
        }
        position.copy(sample.point);

        this.lastStep = {
            grounded: true,
            blockedSlope,
            blockedStructure,
            slopeDeg: sample.slopeDeg,
            altitude: sample.altitude,
            surfaceUp: sample.up.toArray(),
            surfaceNormal: sample.normal.toArray(),
            baseForward: this._makeBaseForward(sample.up, this._baseForward).toArray()
        };
        return this.lastStep;
    }

    sample(position) {
        if (!this.surface?.getSurfaceSample) return null;
        this._sample = this.surface.getSurfaceSample(position, this._sample);
        this.lastStep = {
            grounded: Math.abs(this._sample.altitude) < 0.05,
            blockedSlope: false,
            slopeDeg: this._sample.slopeDeg,
            altitude: this._sample.altitude,
            surfaceUp: this._sample.up.toArray(),
            surfaceNormal: this._sample.normal.toArray(),
            baseForward: this._makeBaseForward(this._sample.up, this._baseForward).toArray()
        };
        return this._sample;
    }

    _makeBaseForward(up, target) {
        target.copy(this._preferredForward).addScaledVector(up, -this._preferredForward.dot(up));
        if (target.lengthSq() < 1e-8) {
            target.copy(WORLD_RIGHT).addScaledVector(up, -WORLD_RIGHT.dot(up));
        }
        if (target.lengthSq() < 1e-8) {
            target.copy(WORLD_FORWARD).addScaledVector(up, -WORLD_FORWARD.dot(up));
        }
        return target.normalize();
    }
}
