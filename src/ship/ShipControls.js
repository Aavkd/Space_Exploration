// Maps desktop keyboard state into a ship command (pilot intent). Kept free of
// THREE and of any DOM listeners: the App owns key events and just feeds this a
// Set of held key codes, so the mapping stays easy to test and to swap for VR
// later. Movement keys only do anything while pilot mode is engaged; when it is
// off the App routes the same keys to the free debug camera instead.
const HELD_KEYS = Object.freeze({
    thrustForward: 'KeyW',
    thrustBack: 'KeyS',
    strafeRight: 'KeyD',
    strafeLeft: 'KeyA',
    liftUp: 'KeyR',
    liftDown: 'KeyF',
    pitchUp: 'ArrowUp',
    pitchDown: 'ArrowDown',
    yawLeft: 'ArrowLeft',
    yawRight: 'ArrowRight',
    rollRight: 'KeyE',
    rollLeft: 'KeyQ',
    boost: 'ShiftLeft',
    airbrake: 'KeyX'
});

const TOGGLE_KEYS = Object.freeze({
    pilot: 'KeyC',
    dampeners: 'KeyZ'
});

export class ShipControls {
    constructor({ dampeners = false } = {}) {
        // Default flight model is inertial -> dampeners start OFF.
        this.pilotActive = false;
        this.dampeners = dampeners;
        this.heldKeys = HELD_KEYS;
        this.toggleKeys = TOGGLE_KEYS;
    }

    /**
     * Handle a keydown for the latching toggles (pilot mode, dampeners).
     * Returns the toggle name that changed, or null. The App uses the return to
     * switch the camera into/out of chase mode when piloting starts/stops.
     */
    handleToggleKey(code) {
        if (code === this.toggleKeys.pilot) {
            this.pilotActive = !this.pilotActive;
            return 'pilot';
        }
        if (code === this.toggleKeys.dampeners) {
            this.dampeners = !this.dampeners;
            return 'dampeners';
        }
        return null;
    }

    setPilotActive(active) {
        this.pilotActive = Boolean(active);
    }

    /**
     * Build the per-frame command from currently held keys + latched toggles.
     * When pilot mode is off, returns an inactive command so the ship coasts on
     * inertia + gravity (it never stops just because nobody is flying it).
     */
    getCommand(keys, gamepad = null) {
        if (!this.pilotActive) {
            return {
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
            };
        }

        const k = this.heldKeys;
        const axis = (positive, negative) => (keys.has(positive) ? 1 : 0) - (keys.has(negative) ? 1 : 0);
        const buttons = gamepad?.connected ? gamepad.buttons : null;
        const axes = gamepad?.connected ? gamepad.axes : null;
        const button = (name) => Boolean(buttons?.[name]?.pressed);
        const value = (name) => buttons?.[name]?.value ?? 0;

        return {
            active: true,
            dampeners: this.dampeners,
            airbrake: keys.has(k.airbrake) || button('circle'),
            boost: keys.has(k.boost) || button('cross'),
            thrust: clampAxis(axis(k.thrustForward, k.thrustBack) + value('r2') - value('l2')),
            strafe: clampAxis(axis(k.strafeRight, k.strafeLeft) + buttonAxis(button('dpadRight'), button('dpadLeft'))),
            lift: clampAxis(axis(k.liftUp, k.liftDown) + buttonAxis(button('dpadUp'), button('dpadDown'))),
            pitch: clampAxis(axis(k.pitchUp, k.pitchDown) + (axes?.leftY ?? 0)),
            yaw: clampAxis(axis(k.yawLeft, k.yawRight) + buttonAxis(button('l1'), button('r1'))),
            roll: clampAxis(axis(k.rollRight, k.rollLeft) - (axes?.leftX ?? 0))
        };
    }

    getState() {
        return { pilotActive: this.pilotActive, dampeners: this.dampeners };
    }
}

function buttonAxis(positive, negative) {
    return (positive ? 1 : 0) - (negative ? 1 : 0);
}

function clampAxis(value) {
    return Math.max(-1, Math.min(1, value));
}
