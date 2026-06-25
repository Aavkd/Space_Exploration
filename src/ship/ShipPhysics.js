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

    maxLinearSpeed: 2200, // m/s safety clamp (PRECISION gear top speed)
    maxAngularSpeed: 1.8, // rad/s per axis safety clamp

    accelerationCap: 45, // cap on commanded linear accel magnitude (VR comfort)

    // --- Hyperdrive gear (Phase 08). cmd.hyperdrive is the eased level 0..1
    // computed in Ship; at level 0 the ship behaves exactly as PRECISION. ---
    hyperForwardMult: 120, // forwardForce multiplier at full spool
    hyperAccelCap: 6000, // accelerationCap eases up to this at full spool
    hyperSafetyClamp: 250000, // top-speed clamp lifts to this guard in hyperdrive
    hyperAngularScale: 0.5, // angular authority reduced by (1 - this*level)

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
    hyperdrive: 0, // eased hyperdrive level 0..1 (Ship injects this)
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
     * @param {THREE.Vector3|null} externalAccel additional soft forces, e.g. debris turbulence
     */
    integrate(object3D, dt, command = {}, gravityAccel = null, externalAccel = null) {
        const cmd = { ...EMPTY_COMMAND, ...command };
        this.lastCommand = cmd;
        const cfg = this.config;

        // Eased hyperdrive level (0 = PRECISION, 1 = full spool). Forward thrust,
        // accel cap and the top-speed clamp all scale by it so engaging the gear
        // ramps in smoothly; lateral nudges stay precise.
        const level = THREE.MathUtils.clamp(cmd.hyperdrive ?? 0, 0, 1);

        // --- Linear: thrust (body frame) -> world, capped by VR-comfort cap ---
        if (cmd.active) {
            const throttle = cmd.boost ? cfg.boostMultiplier : 1;
            const forwardForce = cfg.forwardForce * THREE.MathUtils.lerp(1, cfg.hyperForwardMult, level);
            this._linearAccel.set(
                cmd.strafe * cfg.strafeForce,
                cmd.lift * cfg.verticalForce,
                -cmd.thrust * forwardForce
            ).multiplyScalar(throttle);

            // Ease the comfort cap up with spool so the forward authority is not
            // throttled back to PRECISION limits the moment hyperdrive engages.
            const cap = THREE.MathUtils.lerp(cfg.accelerationCap, cfg.hyperAccelCap, level);
            if (this._linearAccel.lengthSq() > cap * cap) this._linearAccel.setLength(cap);

            this._linearAccel.applyQuaternion(object3D.quaternion);
            this.velocity.addScaledVector(this._linearAccel, dt);
        }

        // Gravity always applies, piloted or not (this is what bends the path).
        if (gravityAccel) {
            this._gravityAccel.copy(gravityAccel);
            this.velocity.addScaledVector(this._gravityAccel, dt);
        }

        if (externalAccel) {
            this.velocity.addScaledVector(externalAccel, dt);
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

        // PRECISION keeps the design top-speed clamp; hyperdrive lifts it to a
        // high safety guard (not a design limit) so speed builds inertially.
        const clamp = level < 1e-3 ? cfg.maxLinearSpeed : cfg.hyperSafetyClamp;
        if (this.velocity.lengthSq() > clamp * clamp) this.velocity.setLength(clamp);

        object3D.position.addScaledVector(this.velocity, dt);

        // --- Angular: body-frame rates, conserved unless damped/braked ---
        if (cmd.active) {
            // Reduce rotational authority as hyperdrive spools up: spinning hard at
            // cruise is both uncontrollable and a VR-comfort hazard.
            const angularScale = 1 - cfg.hyperAngularScale * level;
            this._angularAccel.set(
                cmd.pitch * cfg.pitchAccel,
                cmd.yaw * cfg.yawAccel,
                cmd.roll * cfg.rollAccel
            ).multiplyScalar(angularScale);
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

    // Live-tunable hyperdrive parameters (driven from the F2 config). Anything
    // omitted/NaN is left at its current value so partial updates are safe.
    setHyperdriveConfig({ hyperForwardMult, hyperAccelCap, hyperSafetyClamp, hyperAngularScale } = {}) {
        if (Number.isFinite(hyperForwardMult)) this.config.hyperForwardMult = hyperForwardMult;
        if (Number.isFinite(hyperAccelCap)) this.config.hyperAccelCap = hyperAccelCap;
        if (Number.isFinite(hyperSafetyClamp)) this.config.hyperSafetyClamp = hyperSafetyClamp;
        if (Number.isFinite(hyperAngularScale)) this.config.hyperAngularScale = hyperAngularScale;
    }

    // Effective forward-thrust multiplier for the last integrated command. Used
    // by the FX layer to keep speed-lines / warp calibrated to the active gear.
    getEffectiveThrustMultiplier() {
        const level = THREE.MathUtils.clamp(this.lastCommand.hyperdrive ?? 0, 0, 1);
        return THREE.MathUtils.lerp(1, this.config.hyperForwardMult, level);
    }

    /** Hard reset of motion state (debug helper). */
    halt() {
        this.velocity.set(0, 0, 0);
        this.angularVelocity.set(0, 0, 0);
    }
}
