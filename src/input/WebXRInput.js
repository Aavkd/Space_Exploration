const BUTTON_NAMES = Object.freeze([
    'cross',
    'circle',
    'square',
    'triangle',
    'l1',
    'r1',
    'l2',
    'r2',
    'dpadUp',
    'dpadDown',
    'dpadLeft',
    'dpadRight'
]);

const DEFAULT_LEFT_DEADZONE = 0.18;
const DEFAULT_RIGHT_DEADZONE = 0.22;
const SNAP_THRESHOLD = 0.72;
const SNAP_RELEASE_THRESHOLD = 0.32;
const BUTTON_THRESHOLD = 0.45;

export class WebXRInput {
    constructor({
        leftDeadzone = DEFAULT_LEFT_DEADZONE,
        rightDeadzone = DEFAULT_RIGHT_DEADZONE
    } = {}) {
        this.leftDeadzone = leftDeadzone;
        this.rightDeadzone = rightDeadzone;
        this.slots = [createSlot(0), createSlot(1)];
        this.state = createEmptyState();
        this._snapArmed = true;
        this._previousButtons = createButtonMap();
    }

    registerController(index, controller, grip) {
        const slot = this.slots[index] ?? createSlot(index);
        slot.controller = controller;
        slot.grip = grip;
        this.slots[index] = slot;

        controller.addEventListener('connected', (event) => {
            slot.inputSource = event.data;
            slot.handedness = event.data?.handedness || slot.handedness || handFallback(index);
        });

        controller.addEventListener('disconnected', () => {
            slot.inputSource = null;
            slot.handedness = handFallback(index);
        });

        grip?.addEventListener?.('connected', (event) => {
            slot.inputSource = event.data ?? slot.inputSource;
            slot.handedness = slot.inputSource?.handedness || slot.handedness || handFallback(index);
        });

        grip?.addEventListener?.('disconnected', () => {
            if (!slot.controller?.visible) slot.inputSource = null;
        });
    }

    update(dt, comfort = {}) {
        const left = this._findSlot('left');
        const right = this._findSlot('right');
        const leftAxes = readStick(left, this.leftDeadzone);
        const rightAxes = readStick(right, this.rightDeadzone);
        const leftGrip = readButton(left, 1);
        const rightGrip = readButton(right, 1);
        const buttons = createButtonMap();

        buttons.dpadDown.pressed = leftGrip.pressed;
        buttons.dpadDown.value = leftGrip.value;
        buttons.dpadUp.pressed = rightGrip.pressed;
        buttons.dpadUp.value = rightGrip.value;

        const leftTrigger = readButton(left, 0);
        const rightTrigger = readButton(right, 0);
        buttons.r2.pressed = rightTrigger.pressed;
        buttons.r2.value = rightTrigger.value;
        buttons.l2.pressed = leftTrigger.pressed;
        buttons.l2.value = leftTrigger.value;

        for (const name of BUTTON_NAMES) {
            const previous = this._previousButtons[name]?.pressed ?? false;
            const current = buttons[name].pressed;
            buttons[name].justPressed = current && !previous;
            buttons[name].justReleased = !current && previous;
        }

        const turnDelta = this._consumeTurn(rightAxes.x, dt, comfort);
        this._previousButtons = buttons;
        this.state = {
            source: 'webxr',
            enabled: true,
            connected: this.slots.some((slot) => Boolean(slot.inputSource)),
            index: null,
            id: 'WebXR controllers',
            mapping: 'xr-standard',
            axes: {
                leftX: leftAxes.x,
                leftY: leftAxes.y,
                rightX: rightAxes.x,
                rightY: rightAxes.y
            },
            buttons,
            haptics: this.slots.some((slot) => hasHaptics(slot)),
            turnDelta,
            controllers: this.slots.map((slot) => ({
                index: slot.index,
                handedness: slot.handedness,
                connected: Boolean(slot.inputSource),
                profiles: slot.inputSource?.profiles ?? []
            }))
        };
        return this.state;
    }

    pulse({ duration = 70, strength = 0.35 } = {}) {
        let pulsed = false;
        for (const slot of this.slots) {
            const actuator = slot.inputSource?.gamepad?.hapticActuators?.[0];
            if (!actuator?.pulse) continue;
            try {
                actuator.pulse(Math.max(0, Math.min(1, strength)), duration).catch?.(() => {});
                pulsed = true;
            } catch {
                // Haptics are opportunistic in browsers.
            }
        }
        return pulsed;
    }

    getDebugState() {
        return {
            connected: this.state.connected,
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
            controllers: this.state.controllers ?? []
        };
    }

    _findSlot(handedness) {
        return (
            this.slots.find((slot) => slot.inputSource?.handedness === handedness)
            ?? this.slots.find((slot) => slot.handedness === handedness && slot.inputSource)
            ?? null
        );
    }

    _consumeTurn(axis, dt, comfort) {
        const mode = comfort.rotationMode ?? 'snap';
        if (mode === 'smooth') {
            const rate = degToRad(comfort.smoothTurnRateDeg ?? 45);
            return -axis * rate * dt;
        }

        if (Math.abs(axis) < SNAP_RELEASE_THRESHOLD) {
            this._snapArmed = true;
            return 0;
        }

        if (!this._snapArmed || Math.abs(axis) < SNAP_THRESHOLD) return 0;
        this._snapArmed = false;
        return -Math.sign(axis) * degToRad(comfort.snapAngleDeg ?? 30);
    }
}

function createSlot(index) {
    return {
        index,
        handedness: handFallback(index),
        controller: null,
        grip: null,
        inputSource: null
    };
}

function createEmptyState() {
    return {
        source: 'webxr',
        enabled: true,
        connected: false,
        index: null,
        id: 'WebXR controllers',
        mapping: 'xr-standard',
        axes: { leftX: 0, leftY: 0, rightX: 0, rightY: 0 },
        buttons: createButtonMap(),
        haptics: false,
        turnDelta: 0,
        controllers: []
    };
}

function createButtonMap() {
    return Object.fromEntries(
        BUTTON_NAMES.map((name) => [
            name,
            { pressed: false, value: 0, justPressed: false, justReleased: false }
        ])
    );
}

function readStick(slot, deadzone) {
    const axes = slot?.inputSource?.gamepad?.axes ?? [];
    if (axes.length < 2) return { x: 0, y: 0 };

    const x = axes[axes.length - 2] ?? 0;
    const y = axes[axes.length - 1] ?? 0;
    return applyRadialDeadzone(x, y, deadzone);
}

function readButton(slot, index) {
    const source = slot?.inputSource?.gamepad?.buttons?.[index];
    const value = source?.value ?? 0;
    const pressed = Boolean(source?.pressed) || value > BUTTON_THRESHOLD;
    return { pressed, value };
}

function hasHaptics(slot) {
    return Boolean(slot.inputSource?.gamepad?.hapticActuators?.[0]?.pulse);
}

function applyRadialDeadzone(x, y, deadzone) {
    const magnitude = Math.hypot(x, y);
    if (magnitude <= deadzone) return { x: 0, y: 0 };

    const scaled = Math.min(1, (magnitude - deadzone) / (1 - deadzone));
    return {
        x: roundAxis((x / magnitude) * scaled),
        y: roundAxis((y / magnitude) * scaled)
    };
}

function roundAxis(value) {
    return Math.round(value * 1000) / 1000;
}

function degToRad(degrees) {
    return degrees * Math.PI / 180;
}

function handFallback(index) {
    return index === 0 ? 'left' : 'right';
}
