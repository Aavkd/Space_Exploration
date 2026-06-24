import * as THREE from 'three';

// Body-frame convention (matches anchors, speed lines and initial velocity):
//   forward = -Z, right = +X, up = +Y.
// Default flight model is INERTIAL: thrust and gravity add velocity, nothing
// bleeds it off on its own. Inertial dampeners and the airbrake are explicit,
// opt-in assists layered on top of that conservation.
const DEFAULTS = Object.freeze({
    forwardForce: 42, // m/s^2 along -Z
    strafeForce: 26, // m/s^2 along X
    verticalForce: 26, // m/s^2 along Y
    boostMultiplier: 2.2, // throttle boost (Shift)

    pitchAccel: 1.4, // rad/s^2 about body X
    yawAccel: 1.2, // rad/s^2 about body Y
    rollAccel: 1.8, // rad/s^2 about body Z

    maxLinearSpeed: 2200, // m/s safety clamp
    maxAngularSpeed: 1.8, // rad/s per axis safety clamp

    accelerationCap: 45, // cap on commanded linear accel magnitude (VR comfort)

    // Exponential decay rates (per second). Higher = stops faster.
    dampenerLinearRate: 1.4, // inertial dampeners: ease drift toward zero
    dampenerAngularRate: 2.6, // inertial dampeners: rotational correction
    airbrakeLinearRate: 5.0, // airbrake: hard linear brake
    airbrakeAngularRate: 6.0 // airbrake: hard rotational brake
});

const EMPTY_COMMAND = Object.freeze({
    active: false,
    dampeners: false,
    airbrake: false,
    boost: false,
    thrust: 0,
    strafe: 0,
    lift: 0,
    pitch: 0,
    yaw: 0,
    roll: 0
});

export class ShipPhysics {
    constructor(config = {}) {
        this.config = { ...DEFAULTS, ...config };

        this.velocity = new THREE.Vector3();
        this.angularVelocity = new THREE.Vector3(); // body-frame rad/s (x=pitch, y=yaw, z=roll)
        this.lastCommand = { ...EMPTY_COMMAND };

        this._linearAccel = new THREE.Vector3();
        this._gravityAccel = new THREE.Vector3();
        this._angularAccel = new THREE.Vector3();
        this._deltaQuat = new THREE.Quaternion();
        this._axis = new THREE.Vector3();
        this._thrustDir = new THREE.Vector3();
        this._alongVel = new THREE.Vector3();
    }

    /**
     * Advance the ship transform one step.
     *
     * @param {THREE.Object3D} object3D ship root (position + quaternion mutated in place)
     * @param {number} dt seconds
     * @param {object} command pilot intent (see EMPTY_COMMAND)
     * @param {THREE.Vector3|null} gravityAccel external world-space acceleration
     */
    integrate(object3D, dt, command = {}, gravityAccel = null) {
        const cmd = { ...EMPTY_COMMAND, ...command };
        this.lastCommand = cmd;
        const cfg = this.config;

        // --- Linear: thrust (body frame) -> world, capped by VR-comfort cap ---
        if (cmd.active) {
            const throttle = cmd.boost ? cfg.boostMultiplier : 1;
            this._linearAccel.set(
                cmd.strafe * cfg.strafeForce,
                cmd.lift * cfg.verticalForce,
                -cmd.thrust * cfg.forwardForce
            ).multiplyScalar(throttle);

            const cap = cfg.accelerationCap;
            if (this._linearAccel.lengthSq() > cap * cap) this._linearAccel.setLength(cap);

            this._linearAccel.applyQuaternion(object3D.quaternion);
            this.velocity.addScaledVector(this._linearAccel, dt);
        }

        // Gravity always applies, piloted or not (this is what bends the path).
        if (gravityAccel) {
            this._gravityAccel.copy(gravityAccel);
            this.velocity.addScaledVector(this._gravityAccel, dt);
        }

        // --- Damping: dampeners (continuous assist) then airbrake (momentary) ---
        // Only while piloted: an unpiloted ship coasts on pure inertia so it
        // keeps advancing instead of quietly braking itself to a stop.
        if (cmd.active) {
            if (cmd.dampeners) {
                // Flight assist, NOT a brake: cancel drift that is not in the
                // direction you are actively thrusting, and bring the ship to
                // rest only when no translation is commanded. It must never fight
                // the commanded thrust axis, otherwise top speed collapses to
                // forwardForce/rate and the ship feels stuck.
                const factor = Math.exp(-cfg.dampenerLinearRate * dt);
                this._thrustDir.set(cmd.strafe, cmd.lift, -cmd.thrust);
                if (this._thrustDir.lengthSq() > 1e-6) {
                    this._thrustDir.applyQuaternion(object3D.quaternion).normalize();
                    const along = this.velocity.dot(this._thrustDir);
                    this._alongVel.copy(this._thrustDir).multiplyScalar(along);
                    // velocity = along-thrust component (kept) + damped perpendicular drift
                    this.velocity.sub(this._alongVel).multiplyScalar(factor).add(this._alongVel);
                } else {
                    this.velocity.multiplyScalar(factor);
                }
            }
            if (cmd.airbrake) {
                const factor = Math.exp(-cfg.airbrakeLinearRate * dt);
                this.velocity.multiplyScalar(factor);
            }
        }

        const maxSpeedSq = cfg.maxLinearSpeed * cfg.maxLinearSpeed;
        if (this.velocity.lengthSq() > maxSpeedSq) this.velocity.setLength(cfg.maxLinearSpeed);

        object3D.position.addScaledVector(this.velocity, dt);

        // --- Angular: body-frame rates, conserved unless damped/braked ---
        if (cmd.active) {
            this._angularAccel.set(
                cmd.pitch * cfg.pitchAccel,
                cmd.yaw * cfg.yawAccel,
                cmd.roll * cfg.rollAccel
            );
            this.angularVelocity.addScaledVector(this._angularAccel, dt);

            if (cmd.dampeners) {
                this.angularVelocity.multiplyScalar(Math.exp(-cfg.dampenerAngularRate * dt));
            }
            if (cmd.airbrake) {
                this.angularVelocity.multiplyScalar(Math.exp(-cfg.airbrakeAngularRate * dt));
            }
        }

        this._clampAngular();
        this._integrateRotation(object3D, dt);
    }

    _clampAngular() {
        const max = this.config.maxAngularSpeed;
        this.angularVelocity.x = THREE.MathUtils.clamp(this.angularVelocity.x, -max, max);
        this.angularVelocity.y = THREE.MathUtils.clamp(this.angularVelocity.y, -max, max);
        this.angularVelocity.z = THREE.MathUtils.clamp(this.angularVelocity.z, -max, max);
    }

    _integrateRotation(object3D, dt) {
        const angle = this.angularVelocity.length() * dt;
        if (angle < 1e-6) return;

        this._axis.copy(this.angularVelocity).normalize();
        this._deltaQuat.setFromAxisAngle(this._axis, angle);
        // Body-frame rotation -> multiply on the right of the current orientation.
        object3D.quaternion.multiply(this._deltaQuat);
        object3D.quaternion.normalize();
    }

    get speed() {
        return this.velocity.length();
    }

    setAccelerationCap(cap) {
        if (Number.isFinite(cap)) this.config.accelerationCap = cap;
    }

    /** Hard reset of motion state (debug helper). */
    halt() {
        this.velocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);
    }
}
