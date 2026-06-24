const BUTTON_INDEX = Object.freeze({
    cross: 0,
    circle: 1,
    square: 2,
    triangle: 3,
    l1: 4,
    r1: 5,
    l2: 6,
    r2: 7,
    share: 8,
    options: 9,
    l3: 10,
    r3: 11,
    dpadUp: 12,
    dpadDown: 13,
    dpadLeft: 14,
    dpadRight: 15,
    ps: 16
});

const AXIS_INDEX = Object.freeze({
    leftX: 0,
    leftY: 1,
    rightX: 2,
    rightY: 3
});

const BUTTON_NAMES = Object.freeze(Object.keys(BUTTON_INDEX));
const DEFAULT_LEFT_DEADZONE = 0.22;
const DEFAULT_RIGHT_DEADZONE = 0.16;
const BUTTON_THRESHOLD = 0.5;

export class GamepadInput {
    constructor({
        deadzone = null,
        leftDeadzone = deadzone ?? DEFAULT_LEFT_DEADZONE,
        rightDeadzone = deadzone ?? DEFAULT_RIGHT_DEADZONE
    } = {}) {
        this.enabled = true;
        this.leftDeadzone = clampDeadzone(leftDeadzone);
        this.rightDeadzone = clampDeadzone(rightDeadzone);
        this.selectedIndex = null;
        this.lastAction = null;
        this._lastPulseAt = 0;
        this._previousButtons = createButtonMap();
        this.state = this._createEmptyState();
    }

    update() {
        if (!this.enabled || !navigator.getGamepads) {
            this.state = this._createEmptyState();
            return this.state;
        }

        const gamepad = this._selectGamepad(navigator.getGamepads());
        if (!gamepad) {
            this.selectedIndex = null;
            this.state = this._createEmptyState();
            return this.state;
        }

        this.selectedIndex = gamepad.index;
        const buttons = this._readButtons(gamepad);
        const axes = this._readAxes(gamepad);
        const state = {
            enabled: this.enabled,
            connected: true,
            index: gamepad.index,
            id: gamepad.id,
            mapping: gamepad.mapping,
            axes,
            buttons,
            haptics: this._hasHaptics(gamepad),
            lastAction: this.lastAction
        };

        for (const name of BUTTON_NAMES) {
            if (buttons[name].justPressed) this.lastAction = name;
        }
        state.lastAction = this.lastAction;
        this._previousButtons = buttons;
        this.state = state;
        return this.state;
    }

    setEnabled(enabled) {
        this.enabled = Boolean(enabled);
        if (!this.enabled) this.state = this._createEmptyState();
        return this.enabled;
    }

    setDeadzone(deadzone) {
        if (Number.isFinite(deadzone)) {
            this.leftDeadzone = clampDeadzone(deadzone);
            this.rightDeadzone = clampDeadzone(deadzone);
        }
        return { left: this.leftDeadzone, right: this.rightDeadzone };
    }

    setLeftDeadzone(deadzone) {
        if (Number.isFinite(deadzone)) this.leftDeadzone = clampDeadzone(deadzone);
        return this.leftDeadzone;
    }

    setRightDeadzone(deadzone) {
        if (Number.isFinite(deadzone)) this.rightDeadzone = clampDeadzone(deadzone);
        return this.rightDeadzone;
    }

    pulse({ duration = 80, weak = 0.35, strong = 0.35, minInterval = 0 } = {}) {
        const now = performance.now();
        if (minInterval > 0 && now - this._lastPulseAt < minInterval) return false;

        const gamepad = this._getSelectedGamepad();
        if (!gamepad) return false;

        const weakMagnitude = Math.max(0, Math.min(1, weak));
        const strongMagnitude = Math.max(0, Math.min(1, strong));
        const actuator = gamepad.vibrationActuator;

        if (actuator?.playEffect) {
            try {
                actuator.playEffect('dual-rumble', {
                    startDelay: 0,
                    duration,
                    weakMagnitude,
                    strongMagnitude
                }).catch?.(() => {});
                this._lastPulseAt = now;
                return true;
            } catch {
                return false;
            }
        }

        const legacyActuator = gamepad.hapticActuators?.[0];
        if (legacyActuator?.pulse) {
            try {
                legacyActuator.pulse(Math.max(weakMagnitude, strongMagnitude), duration).catch?.(() => {});
                this._lastPulseAt = now;
                return true;
            } catch {
                return false;
            }
        }

        return false;
    }

    getDebugState() {
        return {
            enabled: this.enabled,
            connected: this.state.connected,
            index: this.state.index,
            id: this.state.id,
            mapping: this.state.mapping,
            axes: { ...this.state.axes },
            buttons: Object.fromEntries(
                BUTTON_NAMES.map((name) => [
                    name,
                    {
                        pressed: this.state.buttons[name]?.pressed ?? false,
                        value: this.state.buttons[name]?.value ?? 0,
                        justPressed: this.state.buttons[name]?.justPressed ?? false
                    }
                ])
            ),
            haptics: this.state.haptics,
            deadzone: { left: this.leftDeadzone, right: this.rightDeadzone },
            leftDeadzone: this.leftDeadzone,
            rightDeadzone: this.rightDeadzone,
            lastAction: this.state.lastAction
        };
    }

    _selectGamepad(gamepads) {
        const connected = [...gamepads].filter((gamepad) => gamepad?.connected);
        if (connected.length === 0) return null;

        const previous = connected.find((gamepad) => gamepad.index === this.selectedIndex);
        if (previous && isPreferredController(previous)) return previous;

        return (
            connected.find(isPreferredController)
            ?? previous
            ?? connected.find((gamepad) => gamepad.mapping === 'standard')
            ?? connected[0]
        );
    }

    _getSelectedGamepad() {
        if (!navigator.getGamepads) return null;
        const gamepads = navigator.getGamepads();
        const selected = this.selectedIndex == null ? null : gamepads[this.selectedIndex];
        if (selected?.connected) return selected;
        return this._selectGamepad(gamepads);
    }

    _readButtons(gamepad) {
        const buttons = createButtonMap();
        for (const name of BUTTON_NAMES) {
            const source = gamepad.buttons[BUTTON_INDEX[name]];
            const value = source?.value ?? 0;
            const pressed = Boolean(source?.pressed) || value > BUTTON_THRESHOLD;
            const wasPressed = this._previousButtons[name]?.pressed ?? false;
            buttons[name] = {
                pressed,
                value,
                justPressed: pressed && !wasPressed,
                justReleased: !pressed && wasPressed
            };
        }
        return buttons;
    }

    _readAxes(gamepad) {
        const left = applyRadialDeadzone(
            gamepad.axes[AXIS_INDEX.leftX] ?? 0,
            gamepad.axes[AXIS_INDEX.leftY] ?? 0,
            this.leftDeadzone
        );
        const right = applyRadialDeadzone(
            gamepad.axes[AXIS_INDEX.rightX] ?? 0,
            gamepad.axes[AXIS_INDEX.rightY] ?? 0,
            this.rightDeadzone
        );

        return {
            leftX: roundAxis(left.x),
            leftY: roundAxis(left.y),
            rightX: roundAxis(right.x),
            rightY: roundAxis(right.y)
        };
    }

    _hasHaptics(gamepad) {
        return Boolean(gamepad.vibrationActuator?.playEffect || gamepad.hapticActuators?.[0]?.pulse);
    }

    _createEmptyState() {
        return {
            enabled: this.enabled,
            connected: false,
            index: null,
            id: '',
            mapping: '',
            axes: { leftX: 0, leftY: 0, rightX: 0, rightY: 0 },
            buttons: createButtonMap(),
            haptics: false,
            lastAction: this.lastAction
        };
    }
}

function createButtonMap() {
    return Object.fromEntries(
        BUTTON_NAMES.map((name) => [
            name,
            { pressed: false, value: 0, justPressed: false, justReleased: false }
        ])
    );
}

function applyRadialDeadzone(x, y, deadzone) {
    const magnitude = Math.hypot(x, y);
    if (magnitude <= deadzone) return { x: 0, y: 0 };

    const scaled = Math.min(1, (magnitude - deadzone) / (1 - deadzone));
    return {
        x: (x / magnitude) * scaled,
        y: (y / magnitude) * scaled
    };
}

function clampDeadzone(deadzone) {
    return Math.max(0, Math.min(0.75, deadzone));
}

function roundAxis(value) {
    return Math.round(value * 1000) / 1000;
}

function isPreferredController(gamepad) {
    const id = gamepad.id.toLowerCase();
    return id.includes('dualsense') || id.includes('wireless controller') || id.includes('dualshock');
}
