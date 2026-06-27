const AUTOPILOT_MAX_ERROR_BEFORE_PAUSE_THRUST = 15 * Math.PI / 180; // 15 degrees in radians
const AUTOPILOT_BRAKE_BUFFER = 500; // 500 meters
const AUTOPILOT_BRAKE_SWITCH_SPEED = 250; // speed at which we switch from dampeners to airbrake
const AUTOPILOT_APPROACH_SPEED = 50;
const AUTOPILOT_FINAL_BRAKE_MARGIN = 20;
const AUTOPILOT_MAX_ARRIVAL_RADIUS = 25;

export function isHyperdriveAutopilotTier(tier) {
    return tier === 0 || tier === 1;
}

export class HyperdriveAutopilot {
    constructor() {
        this.state = 'IDLE'; // 'IDLE', 'CRUISE', 'DECELERATE', 'HANDOFF'
        this.targetSpeed = 0;
        this.alignmentPercent = 0;
    }

    isActive() {
        return this.state !== 'IDLE';
    }

    engage(ship, target, tier, isTransitioning) {
        if (!target || !isHyperdriveAutopilotTier(tier) || isTransitioning) {
            return false;
        }
        this.state = 'CRUISE';
        this.targetSpeed = ship.speed;
        this.alignmentPercent = 100;
        return true;
    }

    disengage() {
        this.state = 'IDLE';
        this.targetSpeed = 0;
        this.alignmentPercent = 0;
    }

    update(ship, target, dt) {
        if (this.state === 'IDLE' || !target) {
            this.state = 'IDLE';
            return;
        }

        const distanceToTarget = ship.position.distanceTo(target.position);
        const speed = ship.speed;

        // Calculate dynamic brake distance
        const d_brake = this.calculateBrakingDistance(speed);

        if (this.state === 'CRUISE') {
            if (distanceToTarget <= d_brake + AUTOPILOT_BRAKE_BUFFER) {
                this.state = 'DECELERATE';
            }
        }

        if (this.state === 'DECELERATE') {
            const entryRadius = target.entryRadius ?? 5000;
            const arrivalThreshold = Math.min(
                entryRadius * 0.1,
                AUTOPILOT_MAX_ARRIVAL_RADIUS
            );
            if (speed < 10 && distanceToTarget < arrivalThreshold) {
                this.state = 'HANDOFF';
            }
        }
    }

    calculateBrakingDistance(speed) {
        const R1 = 1.4; // dampeners linear decay rate
        const R2 = 5.0; // airbrakes linear decay rate
        const v_switch = AUTOPILOT_BRAKE_SWITCH_SPEED;

        if (speed > v_switch) {
            return ((speed - v_switch) / R1) + (v_switch / R2);
        } else {
            return speed / R2;
        }
    }

    buildCommand(ship, target, dt) {
        if (this.state === 'IDLE' || !target) {
            return {
                active: false,
                dampeners: false,
                airbrake: false,
                boost: false,
                hyperdrive: false,
                thrust: 0,
                strafe: 0,
                lift: 0,
                pitch: 0,
                yaw: 0,
                roll: 0
            };
        }

        const localPoi = target.position.clone().sub(ship.position);
        const lenSq = localPoi.lengthSq();
        if (lenSq > 1e-6) {
            localPoi.applyQuaternion(ship.object3D.quaternion.clone().invert());
            localPoi.normalize();
        } else {
            localPoi.set(0, 0, -1);
        }

        // yawError: positive turns left (target is on left, i.e. localPoi.x < 0)
        const yawError = Math.atan2(-localPoi.x, -localPoi.z);
        // pitchError: positive pitches up (target is above, i.e. localPoi.y > 0)
        const pitchError = Math.atan2(localPoi.y, Math.hypot(localPoi.x, localPoi.z));

        const Kp = 0.8;
        const yawCmd = Math.max(-1, Math.min(1, Kp * yawError));
        const pitchCmd = Math.max(-1, Math.min(1, Kp * pitchError));

        // Total angular alignment error
        const angleError = Math.acos(Math.max(-1, Math.min(1, -localPoi.z)));
        this.alignmentPercent = Math.max(0, Math.min(100, Math.round((1 - angleError / Math.PI) * 100)));

        let thrust = 0;
        let dampeners = true;
        let airbrake = false;
        let hyperdrive = true;

        const speed = ship.speed;

        if (this.state === 'CRUISE') {
            hyperdrive = true;
            if (speed < this.targetSpeed && angleError <= AUTOPILOT_MAX_ERROR_BEFORE_PAUSE_THRUST) {
                thrust = 1;
            } else {
                thrust = 0;
            }
        } else if (this.state === 'DECELERATE') {
            hyperdrive = false;
            thrust = 0;

            if (speed > AUTOPILOT_BRAKE_SWITCH_SPEED) {
                dampeners = true;
                airbrake = false;
            } else {
                const distanceToTarget = ship.position.distanceTo(target.position);
                const entryRadius = target.entryRadius ?? 5000;
                const arrivalThreshold = Math.min(
                    entryRadius * 0.1,
                    AUTOPILOT_MAX_ARRIVAL_RADIUS
                );
                const finalBrakeDistance = arrivalThreshold + AUTOPILOT_FINAL_BRAKE_MARGIN;

                if (distanceToTarget > finalBrakeDistance && speed < AUTOPILOT_APPROACH_SPEED) {
                    // The safety buffer stops the high-speed leg short. Cover
                    // the remaining distance under precision thrust, then brake
                    // once more inside the handoff shell.
                    dampeners = true;
                    airbrake = false;
                    thrust = 0.25;
                } else {
                    dampeners = false;
                    airbrake = true;
                }
            }
        } else if (this.state === 'HANDOFF') {
            // Hold safely inside the target shell while ScaleStack begins the
            // target-exclusive descent transition.
            hyperdrive = false;
            thrust = 0;
            dampeners = false;
            airbrake = true;
        }

        return {
            active: true,
            dampeners,
            airbrake,
            boost: false,
            hyperdrive,
            thrust,
            strafe: 0,
            lift: 0,
            pitch: pitchCmd,
            yaw: yawCmd,
            roll: 0
        };
    }
}
