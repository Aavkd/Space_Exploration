import assert from 'node:assert/strict';
import test from 'node:test';

import {
    descentEntryRadiusForTarget,
    LOCKED_TARGET_ENTRY_RADIUS,
    LOCKED_TARGET_SEARCH_RADIUS,
    matchesLockedDescentTarget
} from '../../src/space/scale/descentTargeting.js';

class Vec3 {
    constructor(x = 0, y = 0, z = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    distanceTo(other) {
        return Math.hypot(this.x - other.x, this.y - other.y, this.z - other.z);
    }
}

test('target-exclusive descent accepts exact and authored system identities', () => {
    assert.equal(LOCKED_TARGET_ENTRY_RADIUS, 800);
    assert.equal(LOCKED_TARGET_SEARCH_RADIUS, 1000);

    assert.equal(matchesLockedDescentTarget({
        id: 'system-a',
        kind: 'system',
        position: new Vec3()
    }, 'system-a'), true);

    assert.equal(matchesLockedDescentTarget({
        id: 'display-name',
        kind: 'system',
        position: new Vec3(),
        rpg: { namedSystemId: 'authored-a' }
    }, 'authored-a'), true);
});

test('a system entered directly from Universe receives the active-target 800 m shell', () => {
    const directSystem = {
        id: 'field-system-a',
        kind: 'system',
        position: new Vec3(100, 0, 0)
    };
    const unrelatedSystem = {
        id: 'field-system-b',
        kind: 'system',
        position: new Vec3(120, 0, 0)
    };

    assert.equal(
        descentEntryRadiusForTarget(directSystem, 60, 'field-system-a', directSystem.position),
        800
    );
    assert.equal(
        descentEntryRadiusForTarget(unrelatedSystem, 60, 'field-system-a', directSystem.position),
        60
    );
});

test('a system target accepts only its containing galaxy at Universe tier', () => {
    const lockedPosition = new Vec3(100, 0, 0);
    assert.equal(matchesLockedDescentTarget({
        id: 'containing-galaxy',
        kind: 'galaxy',
        position: new Vec3(),
        radius: 100
    }, 'system-a', lockedPosition), true);

    assert.equal(matchesLockedDescentTarget({
        id: 'unrelated-galaxy',
        kind: 'galaxy',
        position: new Vec3(1000, 0, 0),
        radius: 100
    }, 'system-a', lockedPosition), false);
});

test('unrelated systems and galaxies remain excluded while a lock is active', () => {
    const lockedPosition = new Vec3(500, 0, 0);
    assert.equal(matchesLockedDescentTarget({
        id: 'other-system',
        kind: 'system',
        position: new Vec3(),
        rpg: { namedSystemId: 'other-authored-system' }
    }, 'locked-system', lockedPosition), false);

    assert.equal(matchesLockedDescentTarget({
        id: 'other-galaxy',
        kind: 'galaxy',
        position: new Vec3(),
        radius: 100
    }, 'locked-system', lockedPosition), false);
});
