import * as THREE from 'three';
import { RelativeLocomotion } from './RelativeLocomotion.js';
import { SurfaceLocomotion } from './SurfaceLocomotion.js';

// Player states. Locomotion and piloting are deliberately SEPARATE states:
//   WALKING  - on foot inside the ship, ship-local relative locomotion.
//   PILOTING - seated at the controls; movement keys fly the ship (ShipControls),
//              head look is free but does NOT steer the ship.
//   EVA      - free-floating excursion outside, still in the ship reference frame
//              (a tethered/relative EVA; see phase-04 doc for the limitation).
//   SURFACE  - on-foot planetary EVA, parented into the active planet frame.
export const PLAYER_STATE = Object.freeze({
    WALKING: 'walking',
    PILOTING: 'piloting',
    EVA: 'eva',
    SURFACE: 'surface'
});

const LOOK_SENSITIVITY = 0.0022; // rad per pixel
const GAMEPAD_LOOK_RATE = 2.4; // rad per second at full stick deflection
const SURFACE_EGRESS_DISTANCE = 5.5;
const SURFACE_BOARD_RADIUS = 4.0;
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
    constructor({
        ship,
        playerRig,
        shipControls,
        locomotion,
        surfaceLocomotion,
        getSurfaceProvider = () => null,
        getSurfaceParent = () => null
    } = {}) {
        this.ship = ship;
        this.rig = playerRig;
        this.shipControls = shipControls;
        this.locomotion = locomotion ?? new RelativeLocomotion();
        this.surfaceLocomotion = surfaceLocomotion ?? new SurfaceLocomotion();
        this.getSurfaceProvider = getSurfaceProvider;
        this.getSurfaceParent = getSurfaceParent;

        this.state = PLAYER_STATE.WALKING;
        this.prompt = null;
        this.comfortMode = false;

        // Static ship-local anchor positions + interaction radii. Anchors never
        // move in the ship frame, so caching them once at the origin is exact.
        this.anchorPoints = this._cacheAnchors([
            'pilotControls',
            'cockpitSeat',
            'commsStation',
            'navigationStation',
            'radioStation',
            'shipComputerStation',
            'cargoTerminalStation',
            'crewMessAnchor',
            'exitAirlock',
            'interiorSpawn',
            'exteriorSpawn'
        ]);

        this._cameraPos = new THREE.Vector3();
        this._cameraQuat = new THREE.Quaternion();
        this._orientation = new THREE.Quaternion();
        this._worldPos = new THREE.Vector3();
        this._anchorWorld = new THREE.Vector3();
        this._boardPoint = new THREE.Vector3();
        this._surfaceSpawn = new THREE.Vector3();
        this._shipOutward = new THREE.Vector3();
        this._surfaceForward = new THREE.Vector3();

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

    applyComfortTurn(deltaYaw) {
        if (Math.abs(deltaYaw) < 1e-6) return;
        this.rig.addLook(deltaYaw, 0);
    }

    setComfortMode(active) {
        this.comfortMode = Boolean(active);
    }

    /** Contextual interact (E / C): take or leave controls, exit/enter airlock. */
    interact() {
        const action = this.getContextualAction();
        switch (action) {
            case 'takeControls':
                this._enterPiloting();
                break;
            case 'openComms':
                return action;
            case 'openNavigation':
                return action;
            case 'openRadio':
                return action;
            case 'openShipComputer':
                return action;
            case 'openCargoTerminal':
                return action;
            case 'openCrew':
                return action;
            case 'leaveControls':
                this._leaveControls();
                break;
            case 'exitAirlock':
                this._enterEVA();
                break;
            case 'disembarkSurface':
                this._enterSurface();
                break;
            case 'enterShip':
                this._enterFromEVA();
                break;
            case 'boardSurface':
                this._enterFromSurface();
                break;
            default:
                return false;
        }
        return action;
    }

    teleportEvaToggle() {
        if (this.state === PLAYER_STATE.SURFACE) {
            this._enterFromSurface();
            return 'boardSurface';
        }
        if (this.state === PLAYER_STATE.EVA) {
            this._enterFromEVA();
            return 'enterShip';
        }
        if (this._canSurfaceDisembark()) {
            this._enterSurface({ force: true });
            return 'disembarkSurface';
        }
        this._enterEVA();
        return 'exitAirlock';
    }

    disembark({ force = false } = {}) {
        if (force || this._canSurfaceDisembark()) {
            this._enterSurface({ force });
            return 'disembarkSurface';
        }
        return false;
    }

    boardShip() {
        if (this.state === PLAYER_STATE.SURFACE) {
            this._enterFromSurface();
            return 'boardSurface';
        }
        if (this.state === PLAYER_STATE.EVA) {
            this._enterFromEVA();
            return 'enterShip';
        }
        return false;
    }

    // --- per-frame -------------------------------------------------------

    update(dt, keys, gamepad = null) {
        if (this.state === PLAYER_STATE.WALKING) this._updateWalking(dt, keys, gamepad);
        else if (this.state === PLAYER_STATE.EVA) this._updateEVA(dt, keys, gamepad);
        else if (this.state === PLAYER_STATE.SURFACE) this._updateSurface(dt, keys, gamepad);
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
        const run = !this.comfortMode && keys.has(WALK_KEYS.run);
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
        const boost = !this.comfortMode && (keys.has(WALK_KEYS.run) || button('cross'));
        const orientation = this.rig.getLocalOrientation(this._orientation);
        this.locomotion.floatEVA(this.rig.position, orientation, move, dt, { boost });
    }

    _updateSurface(dt, keys, gamepad) {
        const surface = this._surfaceProvider();
        if (!surface) return;

        const axes = gamepad?.connected ? gamepad.axes : null;
        const move = {
            forward: clampAxis(axis(keys, WALK_KEYS.forward, WALK_KEYS.back) - (axes?.leftY ?? 0)),
            strafe: clampAxis(axis(keys, WALK_KEYS.strafeRight, WALK_KEYS.strafeLeft) + (axes?.leftX ?? 0))
        };
        const run = !this.comfortMode && keys.has(WALK_KEYS.run);
        const step = this.surfaceLocomotion.walk(this.rig.position, this.rig.yaw, move, dt, { run });
        this._applySurfaceFrame(step);
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
            if (this._near('navigationStation')) return 'openNavigation';
            if (this._near('commsStation')) return 'openComms';
            if (this._near('radioStation')) return 'openRadio';
            if (this._near('shipComputerStation')) return 'openShipComputer';
            if (this._near('cargoTerminalStation')) return 'openCargoTerminal';
            if (this._near('crewMessAnchor') && this.ship.isCrewAvatarVisible?.()) return 'openCrew';
            if (this._near('pilotControls')) return 'takeControls';
            if (this._near('exitAirlock')) return this._canSurfaceDisembark() ? 'disembarkSurface' : 'exitAirlock';
            return null;
        }

        if (this.state === PLAYER_STATE.EVA) {
            if (this._near('exteriorSpawn', 2.2) || this._near('exitAirlock', 2.6)) return 'enterShip';
            return null;
        }

        if (this.state === PLAYER_STATE.SURFACE) {
            if (this._nearSurfaceBoardPoint()) return 'boardSurface';
            return null;
        }
        return null;
    }

    _near(name, radius) {
        const a = this.anchorPoints[name];
        if (!a) return false;
        const r = radius ?? a.radius;
        // XZ-only distance: the walking player is always at deck Y=0, while
        // anchors are mounted at console/panel height. Including Y in the
        // distance would make the commsStation (Y=1.05, radius=0.9) permanently
        // unreachable and leave exitAirlock/pilotControls very tight.
        const dx = this.rig.position.x - a.pos.x;
        const dz = this.rig.position.z - a.pos.z;
        return Math.sqrt(dx * dx + dz * dz) <= r;
    }

    _computePrompt() {
        switch (this.getContextualAction()) {
            case 'takeControls':
                return 'Press C / Triangle - take the controls';
            case 'openComms':
                return 'Press C / Triangle - open cockpit comms';
            case 'openNavigation':
                return 'Press C / Triangle - open cockpit navigation';
            case 'openRadio':
                return 'Press C / Triangle - open radio console';
            case 'openShipComputer':
                return 'Press C / Triangle - open ship log';
            case 'openCargoTerminal':
                return 'Press C / Triangle - open cargo terminal';
            case 'openCrew':
                return 'Press C / Triangle - speak with Lyra Venn';
            case 'leaveControls':
                return 'Press C / Triangle - leave the controls';
            case 'exitAirlock':
                return 'Press C / Triangle - exit through the airlock (EVA)';
            case 'disembarkSurface':
                return 'Press C / Triangle - step out onto the surface';
            case 'enterShip':
                return 'Press C / Triangle - enter the ship';
            case 'boardSurface':
                return 'Press C / Triangle - board the ship';
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
        const surface = this.getSurfaceEvaState();
        return {
            state: this.state,
            referenceFrame: this.rig.state.referenceFrame,
            shipLocalPosition: this.rig.state.referenceFrame === 'ship-local' ? this.rig.position.toArray() : null,
            surfacePosition: this.rig.state.referenceFrame === 'surface' ? this.rig.position.toArray() : null,
            yawDeg: THREE.MathUtils.radToDeg(this.rig.yaw),
            pitchDeg: THREE.MathUtils.radToDeg(this.rig.pitch),
            volumeId: this.rig.state.referenceFrame === 'ship-local'
                ? this.locomotion.containsXZ(this.rig.position.x, this.rig.position.z)
                : null,
            contextualAction: this.getContextualAction(),
            prompt: this.prompt,
            lastStep: this.state === PLAYER_STATE.SURFACE ? this.surfaceLocomotion.lastStep : this.locomotion.lastStep,
            surface
        };
    }

    getSurfaceEvaState() {
        if (this.state !== PLAYER_STATE.SURFACE) return null;
        const sample = this._surfaceProvider()?.getSurfaceSample?.(this.rig.position);
        return {
            grounded: this.surfaceLocomotion.lastStep.grounded,
            altitude: sample?.altitude ?? null,
            slopeDeg: sample?.slopeDeg ?? null,
            surfaceUp: sample?.up?.toArray?.() ?? null,
            surfaceNormal: sample?.normal?.toArray?.() ?? null,
            boardingDistance: this._surfaceBoardingDistance()
        };
    }

    // --- transitions -----------------------------------------------------

    _enterWalking(localPos, { yaw } = {}) {
        this.state = PLAYER_STATE.WALKING;
        this.rig.setReferenceFrame('ship-local');
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
        this._ensureRigParent(this.ship.interiorRoot);
        this.rig.setReferenceFrame('ship-local');
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

    _enterSurface({ force = false } = {}) {
        const surface = this._surfaceProvider();
        const parent = this.getSurfaceParent?.();
        if (!surface || !parent || (!force && !this._canSurfaceDisembark())) return false;

        const anchorWorld = this.ship.getAnchorWorldPosition?.('exteriorSpawn', this._anchorWorld)
            ?? this._anchorWorld.copy(this.ship.position);
        const boardPoint = surface.projectToSurface?.(anchorWorld, 0, this._boardPoint)
            ?? surface.getSurfaceSample(anchorWorld)?.point;
        if (!boardPoint) return false;

        this._shipOutward.copy(anchorWorld).sub(this.ship.position);
        const sample = surface.getSurfaceSample(boardPoint);
        this._shipOutward.addScaledVector(sample.normal, -this._shipOutward.dot(sample.normal));
        if (this._shipOutward.lengthSq() < 1e-8) this._shipOutward.set(0, 0, -1);
        this._shipOutward.normalize();
        const point = surface.projectToSurface?.(
            this._surfaceSpawn.copy(boardPoint).addScaledVector(this._shipOutward, SURFACE_EGRESS_DISTANCE),
            0,
            this._worldPos
        ) ?? boardPoint;

        this.surfaceLocomotion.setSurface(surface);
        this.surfaceLocomotion.setPreferredForward(this._shipOutward);
        parent.add(this.rig.object3D);
        this.rig.position.copy(point);
        this.rig.setReferenceFrame('surface');
        this.rig.setEyeHeight(this.ship.dimensions?.eyeHeight ?? 1.65);
        this.ship.physics?.halt?.();
        this.shipControls?.setPilotActive(false);
        this.rig.state.seatedAtControls = false;
        this.state = PLAYER_STATE.SURFACE;
        this.rig.setBodyVisible(false);
        const step = this.surfaceLocomotion.sample(this.rig.position);
        this._applySurfaceFrame(this.surfaceLocomotion.lastStep, step);
        this.rig.setLook(0, -0.22);
        return true;
    }

    _enterFromSurface() {
        this._ensureRigParent(this.ship.interiorRoot);
        const airlock = this.anchorPoints.exitAirlock ?? this.anchorPoints.interiorSpawn;
        const inside = airlock ? new THREE.Vector3(airlock.pos.x, 0, airlock.pos.z) : null;
        this._enterWalking(inside, { yaw: 0 });
    }

    _surfaceProvider() {
        const surface = this.getSurfaceProvider?.();
        if (!surface?.getSurfaceSample) return null;
        this.surfaceLocomotion.setSurface(surface);
        return surface;
    }

    _canSurfaceDisembark() {
        const surface = this._surfaceProvider();
        if (!surface) return false;
        return Boolean(surface.getLandingState?.(this.ship.position)?.landed);
    }

    _nearSurfaceBoardPoint(radius = SURFACE_BOARD_RADIUS) {
        const distance = this._surfaceBoardingDistance();
        return Number.isFinite(distance) && distance <= radius;
    }

    _surfaceBoardingDistance() {
        const surface = this._surfaceProvider();
        if (!surface) return Infinity;
        const anchorWorld = this.ship.getAnchorWorldPosition?.('exteriorSpawn', this._anchorWorld);
        if (!anchorWorld) return Infinity;
        const boardPoint = surface.projectToSurface?.(anchorWorld, 0, this._boardPoint);
        if (!boardPoint) return Infinity;
        this.rig.object3D.getWorldPosition(this._worldPos);
        return this._worldPos.distanceTo(boardPoint);
    }

    _applySurfaceFrame(step, sample = null) {
        const surfaceSample = sample ?? this._surfaceProvider()?.getSurfaceSample?.(this.rig.position);
        if (!surfaceSample) return;
        const base = step?.baseForward
            ? this._surfaceForward.fromArray(step.baseForward)
            : this._surfaceForward.set(0, 0, -1);
        this.rig.setSurfaceFrame(surfaceSample.normal, base);
    }

    _ensureRigParent(parent) {
        if (parent && this.rig.object3D.parent !== parent) parent.add(this.rig.object3D);
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
