import * as THREE from 'three';
import { RelativeLocomotion } from './RelativeLocomotion.js';

// Player states. Locomotion and piloting are deliberately SEPARATE states:
//   WALKING  - on foot inside the ship, ship-local relative locomotion.
//   PILOTING - seated at the controls; movement keys fly the ship (ShipControls),
//              head look is free but does NOT steer the ship.
//   EVA      - free-floating excursion outside, still in the ship reference frame
//              (a tethered/relative EVA; see phase-04 doc for the limitation).
export const PLAYER_STATE = Object.freeze({
    WALKING: 'walking',
    PILOTING: 'piloting',
    EVA: 'eva'
});

const LOOK_SENSITIVITY = 0.0022; // rad per pixel
const GAMEPAD_LOOK_RATE = 2.4; // rad per second at full stick deflection
const WALK_KEYS = Object.freeze({
    forward: 'KeyW',
    back: 'KeyS',
    strafeRight: 'KeyD',
    strafeLeft: 'KeyA',
    up: 'KeyR',
    down: 'KeyF',
    run: 'ShiftLeft'
});

export class PlayerController {
    constructor({ ship, playerRig, shipControls, locomotion } = {}) {
        this.ship = ship;
        this.rig = playerRig;
        this.shipControls = shipControls;
        this.locomotion = locomotion ?? new RelativeLocomotion();

        this.state = PLAYER_STATE.WALKING;
        this.prompt = null;

        // Static ship-local anchor positions + interaction radii. Anchors never
        // move in the ship frame, so caching them once at the origin is exact.
        this.anchorPoints = this._cacheAnchors([
            'pilotControls',
            'cockpitSeat',
            'exitAirlock',
            'interiorSpawn',
            'exteriorSpawn'
        ]);

        this._cameraPos = new THREE.Vector3();
        this._cameraQuat = new THREE.Quaternion();
        this._orientation = new THREE.Quaternion();

        this._enterWalking(this.anchorPoints.interiorSpawn?.pos);
    }

    _cacheAnchors(names) {
        const out = {};
        for (const name of names) {
            const pos = this.ship.getAnchorLocalPosition?.(name);
            const anchor = this.ship.getAnchor?.(name);
            if (pos) {
                out[name] = {
                    pos: pos.clone(),
                    radius: anchor?.userData?.interactionRadius ?? 1.2
                };
            }
        }
        return out;
    }

    // --- input -----------------------------------------------------------

    /** Mouse-look from a pointer-locked mousemove (pixels). */
    applyMouseLook(dx, dy) {
        this.rig.addLook(-dx * LOOK_SENSITIVITY, -dy * LOOK_SENSITIVITY);
    }

    /** Analog camera look from a gamepad right stick. */
    applyGamepadLook(x, y, dt) {
        if (Math.abs(x) < 1e-4 && Math.abs(y) < 1e-4) return;
        this.rig.addLook(-x * GAMEPAD_LOOK_RATE * dt, -y * GAMEPAD_LOOK_RATE * dt);
    }

    /** Contextual interact (E / C): take or leave controls, exit/enter airlock. */
    interact() {
        const action = this.getContextualAction();
        switch (action) {
            case 'takeControls':
                this._enterPiloting();
                break;
            case 'leaveControls':
                this._leaveControls();
                break;
            case 'exitAirlock':
                this._enterEVA();
                break;
            case 'enterShip':
                this._enterFromEVA();
                break;
            default:
                return false;
        }
        return action;
    }

    // --- per-frame -------------------------------------------------------

    update(dt, keys, gamepad = null) {
        if (this.state === PLAYER_STATE.WALKING) this._updateWalking(dt, keys, gamepad);
        else if (this.state === PLAYER_STATE.EVA) this._updateEVA(dt, keys, gamepad);
        // PILOTING: the rig stays anchored at the seat; the ship is flown by
        // ShipControls from App._tick. Head look is applied via applyMouseLook.

        this.prompt = this._computePrompt();
    }

    _updateWalking(dt, keys, gamepad) {
        const axes = gamepad?.connected ? gamepad.axes : null;
        const move = {
            forward: clampAxis(axis(keys, WALK_KEYS.forward, WALK_KEYS.back) - (axes?.leftY ?? 0)),
            strafe: clampAxis(axis(keys, WALK_KEYS.strafeRight, WALK_KEYS.strafeLeft) + (axes?.leftX ?? 0))
        };
        const run = keys.has(WALK_KEYS.run);
        this.locomotion.walk(this.rig.position, this.rig.yaw, move, dt, { run });
    }

    _updateEVA(dt, keys, gamepad) {
        const axes = gamepad?.connected ? gamepad.axes : null;
        const buttons = gamepad?.connected ? gamepad.buttons : null;
        const button = (name) => Boolean(buttons?.[name]?.pressed);
        const move = {
            forward: clampAxis(axis(keys, WALK_KEYS.forward, WALK_KEYS.back) - (axes?.leftY ?? 0)),
            strafe: clampAxis(axis(keys, WALK_KEYS.strafeRight, WALK_KEYS.strafeLeft) + (axes?.leftX ?? 0)),
            vertical: clampAxis(axis(keys, WALK_KEYS.up, WALK_KEYS.down) + buttonAxis(button('dpadUp'), button('dpadDown')))
        };
        const boost = keys.has(WALK_KEYS.run) || button('cross');
        const orientation = this.rig.getLocalOrientation(this._orientation);
        this.locomotion.floatEVA(this.rig.position, orientation, move, dt, { boost });
    }

    /** Place App.camera at the rig's converted world pose. */
    updateCamera(camera) {
        const pose = this.rig.getCameraWorldPose(this._cameraPos, this._cameraQuat);
        camera.position.copy(pose.position);
        camera.quaternion.copy(pose.quaternion);
    }

    // --- interaction logic ----------------------------------------------

    getContextualAction() {
        if (this.state === PLAYER_STATE.PILOTING) return 'leaveControls';

        if (this.state === PLAYER_STATE.WALKING) {
            if (this._near('pilotControls')) return 'takeControls';
            if (this._near('exitAirlock')) return 'exitAirlock';
            return null;
        }

        if (this.state === PLAYER_STATE.EVA) {
            if (this._near('exteriorSpawn', 2.2) || this._near('exitAirlock', 2.6)) return 'enterShip';
            return null;
        }
        return null;
    }

    _near(name, radius) {
        const a = this.anchorPoints[name];
        if (!a) return false;
        const r = radius ?? a.radius;
        return this.rig.position.distanceTo(a.pos) <= r;
    }

    _computePrompt() {
        switch (this.getContextualAction()) {
            case 'takeControls':
                return 'Press C / Triangle - take the controls';
            case 'leaveControls':
                return 'Press C / Triangle - leave the controls';
            case 'exitAirlock':
                return 'Press C / Triangle - exit through the airlock (EVA)';
            case 'enterShip':
                return 'Press C / Triangle - enter the ship';
            default:
                return null;
        }
    }

    getPrompt() {
        return this.prompt;
    }

    getState() {
        return this.state;
    }

    /**
     * Re-assert ShipControls pilot flag from the player state. Used when the App
     * flips between player and debug cameras (which can clear the flag) so that
     * returning to a PILOTING player keeps the controls live.
     */
    syncPilotState() {
        this.shipControls?.setPilotActive(this.state === PLAYER_STATE.PILOTING);
    }

    getDebugState() {
        return {
            state: this.state,
            shipLocalPosition: this.rig.position.toArray(),
            yawDeg: THREE.MathUtils.radToDeg(this.rig.yaw),
            pitchDeg: THREE.MathUtils.radToDeg(this.rig.pitch),
            volumeId: this.locomotion.containsXZ(this.rig.position.x, this.rig.position.z),
            contextualAction: this.getContextualAction(),
            prompt: this.prompt,
            lastStep: this.locomotion.lastStep
        };
    }

    // --- transitions -----------------------------------------------------

    _enterWalking(localPos, { yaw } = {}) {
        this.state = PLAYER_STATE.WALKING;
        if (localPos) this.rig.setShipLocalPosition(localPos);
        this.locomotion.clampInside(this.rig.position);
        this.rig.position.y = this.locomotion.config.deckHeight;
        this.rig.setEyeHeight(this.ship.dimensions?.eyeHeight ?? 1.65);
        this.rig.setLook(yaw ?? this.rig.yaw, 0);
        this.rig.setBodyVisible(false);
        this.shipControls?.setPilotActive(false);
        this.state = PLAYER_STATE.WALKING;
    }

    _enterPiloting() {
        const seat = this.anchorPoints.cockpitSeat ?? this.anchorPoints.pilotControls;
        if (seat) {
            // Stand the eye in the cockpit over the seat footprint; the rig is
            // parented to the ship, so this seated view banks/rolls with the hull.
            this.rig.setShipLocalPosition(new THREE.Vector3(seat.pos.x, this.locomotion.config.deckHeight, seat.pos.z));
        }
        this.rig.setLook(0, -0.06); // face forward, slightly toward the console
        this.rig.setBodyVisible(false);
        this.state = PLAYER_STATE.PILOTING;
        this.rig.state.seatedAtControls = true;
        this.shipControls?.setPilotActive(true);
    }

    _leaveControls() {
        this.rig.state.seatedAtControls = false;
        // Stand up just behind the seat, back in the walking reference.
        const seat = this.anchorPoints.cockpitSeat ?? this.anchorPoints.interiorSpawn;
        const stand = seat ? new THREE.Vector3(seat.pos.x, 0, seat.pos.z + 1.2) : null;
        this._enterWalking(stand, { yaw: 0 });
    }

    _enterEVA() {
        const spawn = this.anchorPoints.exteriorSpawn;
        if (spawn) this.rig.setShipLocalPosition(spawn.pos.clone());
        // Face out the port airlock (+X), level pitch.
        this.rig.setLook(-Math.PI / 2, 0);
        this.rig.setBodyVisible(false);
        this.state = PLAYER_STATE.EVA;
        this.shipControls?.setPilotActive(false);
    }

    _enterFromEVA() {
        // Step back in at the interior airlock and face down the corridor (-Z).
        const airlock = this.anchorPoints.exitAirlock ?? this.anchorPoints.interiorSpawn;
        const inside = airlock ? new THREE.Vector3(airlock.pos.x, 0, airlock.pos.z) : null;
        this._enterWalking(inside, { yaw: 0 });
    }
}

function axis(keys, positive, negative) {
    return (keys.has(positive) ? 1 : 0) - (keys.has(negative) ? 1 : 0);
}

function buttonAxis(positive, negative) {
    return (positive ? 1 : 0) - (negative ? 1 : 0);
}

function clampAxis(value) {
    return Math.max(-1, Math.min(1, value));
}
