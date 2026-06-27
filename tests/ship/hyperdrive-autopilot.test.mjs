import assert from 'node:assert/strict';
import test from 'node:test';

import {
    HyperdriveAutopilot,
    isHyperdriveAutopilotTier
} from '../../src/ship/HyperdriveAutopilot.js';

class Vec3 {
    constructor(x = 0, y = 0, z = 0) {
        this.set(x, y, z);
    }

    set(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
    }

    clone() {
        return new Vec3(this.x, this.y, this.z);
    }

    sub(other) {
        this.x -= other.x;
        this.y -= other.y;
        this.z -= other.z;
        return this;
    }

    lengthSq() {
        return this.x ** 2 + this.y ** 2 + this.z ** 2;
    }

    distanceTo(other) {
        return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z);
    }

    applyQuaternion() {
        return this;
    }

    normalize() {
        const length = Math.sqrt(this.lengthSq());
        if (length > 0) {
            this.x /= length;
            this.y /= length;
            this.z /= length;
        }
        return this;
    }
}

class IdentityQuaternion {
    clone() {
        return new IdentityQuaternion();
    }

    invert() {
        return this;
    }
}

function createShip({ speed = 100, position = new Vec3() } = {}) {
    return {
        speed,
        position,
        object3D: { quaternion: new IdentityQuaternion() }
    };
}

test('autopilot is restricted by scale tier rather than stack depth', () => {
    assert.equal(isHyperdriveAutopilotTier(0), true);
    assert.equal(isHyperdriveAutopilotTier(1), true);
    assert.equal(isHyperdriveAutopilotTier(2), false);
    assert.equal(isHyperdriveAutopilotTier(3), false);

    const ship = createShip();
    const target = { position: new Vec3(0, 0, -1000) };
    assert.equal(new HyperdriveAutopilot().engage(ship, target, 0, false), true);
    assert.equal(new HyperdriveAutopilot().engage(ship, target, 1, false), true);
    assert.equal(new HyperdriveAutopilot().engage(ship, target, 2, false), false);
    assert.equal(new HyperdriveAutopilot().engage(ship, target, 1, true), false);
});

test('deceleration covers the safety buffer before entering handoff', () => {
    const autopilot = new HyperdriveAutopilot();
    const ship = createShip({ speed: 250 });
    const target = { position: new Vec3(0, 0, -550) };

    assert.equal(autopilot.engage(ship, target, 0, false), true);
    autopilot.update(ship, target, 1 / 60);
    assert.equal(autopilot.state, 'DECELERATE');

    ship.speed = 0;
    target.position.set(0, 0, -510);
    const approach = autopilot.buildCommand(ship, target, 1 / 60);
    assert.equal(approach.hyperdrive, false);
    assert.equal(approach.airbrake, false);
    assert.equal(approach.thrust, 0.25);

    ship.speed = 9;
    target.position.set(0, 0, -20);
    autopilot.update(ship, target, 1 / 60);
    assert.equal(autopilot.state, 'HANDOFF');

    const handoff = autopilot.buildCommand(ship, target, 1 / 60);
    assert.equal(handoff.hyperdrive, false);
    assert.equal(handoff.thrust, 0);
    assert.equal(handoff.airbrake, true);
    assert.equal(autopilot.isActive(), true);
});

test('final approach brakes before the handoff radius', () => {
    const autopilot = new HyperdriveAutopilot();
    const ship = createShip({ speed: 40 });
    const target = { position: new Vec3(0, 0, -40) };

    assert.equal(autopilot.engage(ship, target, 1, false), true);
    autopilot.state = 'DECELERATE';
    const command = autopilot.buildCommand(ship, target, 1 / 60);

    assert.equal(command.hyperdrive, false);
    assert.equal(command.thrust, 0);
    assert.equal(command.dampeners, false);
    assert.equal(command.airbrake, true);
});
