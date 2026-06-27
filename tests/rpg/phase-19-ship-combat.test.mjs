import assert from 'node:assert/strict';
import test from 'node:test';

import {
    COMBAT_ENCOUNTER_ID,
    COMBAT_ATTACK_GRACE,
    COMBAT_ENEMY_ID,
    COMBAT_ENEMY_WEAPON,
    COMBAT_ENEMY_WEAPON_ID,
    COMBAT_FIXED_STEP,
    COMBAT_SYSTEM_ID,
    COMBAT_WEAPON,
    COMBAT_WARNING_DELAY,
    CombatRuntime,
    ShipConditionRuntime,
    calculateInterceptPoint,
    createInitialCombatState,
    createRpgRuntime,
    selectDamageSystem
} from '../../src/rpg/index.js';
import {
    LocalSaveSlots,
    SlotRpgPersistence,
    createSaveEnvelope,
    sanitizeSaveEnvelope
} from '../../src/save/index.js';

class MemoryStorage {
    constructor() { this.values = new Map(); }
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) { this.values.set(key, String(value)); }
    removeItem(key) { this.values.delete(key); }
}

function createHarness({ gameTime = 300 } = {}) {
    let time = gameTime;
    let tick = 0;
    const now = () => new Date(Date.UTC(2026, 5, 27, 21, 0, tick++)).toISOString();
    const slots = new LocalSaveSlots({
        storage: new MemoryStorage(),
        now,
        makeId: () => 'slot-phase19'
    });
    const getGameTime = () => time;
    const rpg = createRpgRuntime({
        persistence: new SlotRpgPersistence({ slots, getGameTime }),
        now
    });
    const combat = new CombatRuntime({ slots, rpg, getGameTime, now });
    const condition = new ShipConditionRuntime({ slots, rpg, getGameTime, now });
    return {
        slots, rpg, combat, condition, getGameTime, now,
        setGameTime: (value) => { time = value; }
    };
}

function reopen(harness, systemId = COMBAT_SYSTEM_ID) {
    const rpg = createRpgRuntime({
        persistence: new SlotRpgPersistence({
            slots: harness.slots,
            getGameTime: harness.getGameTime
        }),
        now: harness.now
    });
    const combat = new CombatRuntime({
        slots: harness.slots,
        rpg,
        getGameTime: harness.getGameTime,
        now: harness.now
    });
    const condition = new ShipConditionRuntime({
        slots: harness.slots,
        rpg,
        getGameTime: harness.getGameTime,
        now: harness.now
    });
    combat.syncSystem(systemId);
    condition.syncSystem(systemId);
    return { ...harness, rpg, combat, condition };
}

function faceEnemy(runtime, position = [0, 0, 0]) {
    runtime.update(COMBAT_FIXED_STEP, {
        playerPosition: position,
        playerVelocity: [0, 0, 0],
        playerForward: [0, 0, -1]
    });
}

function advance(runtime, seconds, position = [0, 0, 0]) {
    for (let index = 0; index < Math.ceil(seconds / COMBAT_FIXED_STEP); index += 1) {
        faceEnemy(runtime, position);
    }
}

test('Phase 18 v7/RPG v5 migrates to v8/RPG v6 with clean combat state', () => {
    const current = createSaveEnvelope({
        slotId: 'slot-phase19-migration',
        now: '2026-06-27T00:00:00.000Z'
    });
    const previous = structuredClone(current);
    previous.version = 7;
    previous.rpg.version = 5;
    delete previous.rpg.combat;
    previous.ship.condition.hull.current = 65;
    previous.ship.inventory.repairParts = 2;
    previous.rpg.worldFlags.preserved = true;

    const migrated = sanitizeSaveEnvelope(previous);
    assert.equal(migrated.version, 9);
    assert.equal(migrated.rpg.version, 7);
    assert.equal(migrated.autosave.reason, 'phase-20-v8');
    assert.deepEqual(migrated.rpg.combat, createInitialCombatState());
    assert.equal(migrated.ship.condition.hull.current, 65);
    assert.equal(migrated.ship.inventory.repairParts, 2);
    assert.equal(migrated.rpg.worldFlags.preserved, true);
});

test('K-7 spawns the enemy automatically, warns after 10s, and grants 5s before attack', () => {
    const harness = createHarness();
    const before = harness.slots.getActiveEnvelope().ship.condition;
    harness.combat.syncSystem(COMBAT_SYSTEM_ID);
    const arrival = harness.combat.getState();
    assert.equal(arrival.active, true);
    assert.equal(arrival.combatMode, false);
    assert.equal(arrival.enemy.id, COMBAT_ENEMY_ID);
    assert.ok(arrival.enemy.position[2] <= -599);

    advance(harness.combat, COMBAT_WARNING_DELAY - COMBAT_FIXED_STEP);
    const waiting = harness.combat.getState();
    assert.equal(waiting.phase, 'patrol');
    assert.equal(waiting.warningIssued, false);
    assert.equal(waiting.projectileCount, 0);
    assert.deepEqual(harness.slots.getActiveEnvelope().ship.condition, before);

    faceEnemy(harness.combat);
    const warned = harness.combat.getState();
    assert.equal(warned.warningIssued, true);
    assert.equal(warned.phase, 'grace');
    assert.ok(warned.feedback.some((entry) => entry.type === 'combat.comms.warning'));
    advance(harness.combat, COMBAT_ATTACK_GRACE - COMBAT_FIXED_STEP);
    assert.equal(harness.combat.getState().projectileCount, 0);
    faceEnemy(harness.combat);
    assert.ok(['pursue', 'attack'].includes(harness.combat.getState().phase));
});

test('lead, hardpoint cooldown/heat, range, and seeded damage contracts are deterministic', () => {
    assert.deepEqual(calculateInterceptPoint([0, 0, 0], [0, 0, -100], [10, 0, 0], 100), [
        10.05037815259212, 0, -100
    ]);
    assert.equal(selectDamageSystem('shot-000001'), selectDamageSystem('shot-000001'));
    const harness = createHarness();
    harness.combat.setCombatMode(true);
    assert.equal(harness.combat.getState().combatMode, true);
    harness.combat.syncSystem(COMBAT_SYSTEM_ID);
    faceEnemy(harness.combat);
    const target = harness.combat.cycleTarget();
    assert.equal(target.id, COMBAT_ENEMY_ID);
    assert.equal(target.inRange, true);
    const shot = harness.combat.fire();
    assert.equal(shot.hardpointId, 'pulse_port');
    assert.equal(harness.combat.fire().hardpointId, 'pulse_starboard');
    assert.throws(() => harness.combat.fire(), /cooling down/);
    const state = harness.combat.getState();
    assert.equal(state.hardpoints[0].heat, COMBAT_WEAPON.heatPerShot);
    assert.ok(state.projectileCount <= 32);
});

test('fixed-step enemy runs patrol, pursue, attack, retreat, and destroyed states', () => {
    const harness = createHarness();
    harness.combat.syncSystem(COMBAT_SYSTEM_ID);
    advance(harness.combat, COMBAT_WARNING_DELAY + COMBAT_ATTACK_GRACE);
    faceEnemy(harness.combat, [0, 0, 500]);
    assert.equal(harness.combat.getState().phase, 'patrol');
    faceEnemy(harness.combat, [0, 0, 100]);
    assert.equal(harness.combat.getState().phase, 'pursue');
    faceEnemy(harness.combat, [0, 0, -100]);
    assert.equal(harness.combat.getState().phase, 'attack');
    for (let index = 0; index < 10; index += 1) {
        harness.combat.applyHitForDebug({
            targetId: COMBAT_ENEMY_ID,
            projectileId: `shot-retreat-${index}`
        });
    }
    faceEnemy(harness.combat);
    assert.equal(harness.combat.getState().phase, 'retreat');
    for (let index = 10; index < 13; index += 1) {
        harness.combat.applyHitForDebug({
            targetId: COMBAT_ENEMY_ID,
            projectileId: `shot-destroy-${index}`
        });
    }
    assert.equal(harness.combat.getState().active, false);
    assert.equal(harness.combat.getState().saved.enemy.disposition, 'destroyed');
});

test('victory, wreck salvage, reload, and reset are exact-once and repair-compatible', () => {
    let harness = createHarness();
    harness.combat.syncSystem(COMBAT_SYSTEM_ID);
    for (let index = 0; index < 13; index += 1) {
        harness.combat.applyHitForDebug({
            targetId: COMBAT_ENEMY_ID,
            projectileId: `shot-win-${index}`
        });
    }
    const salvage = harness.combat.claimWreckSalvage();
    assert.equal(salvage.changed, true);
    assert.deepEqual(harness.slots.getActiveEnvelope().ship.inventory, {
        repairParts: 2,
        hullPlates: 1
    });
    assert.equal(harness.combat.claimWreckSalvage().changed, false);
    harness = reopen(harness);
    assert.equal(harness.combat.getState().active, false);
    assert.equal(harness.combat.getState().saved.enemy.disposition, 'destroyed');
    assert.equal(harness.combat.getState().saved.wreck.claimed, true);

    harness.condition.setConditionForDebug('engine', 40);
    harness.condition.repair('engine');
    assert.equal(harness.condition.getState().condition.systems.engine.condition, 70);
    assert.equal(harness.condition.getState().inventory.repairParts, 1);

    harness.slots.resetActiveSlot();
    harness = reopen(harness);
    assert.equal(harness.combat.getState().active, true);
    assert.deepEqual(harness.combat.getState().saved, createInitialCombatState());
});

test('friendly and neutral rules reject lock/damage while hostile hit contract remains valid', () => {
    const harness = createHarness();
    harness.combat.syncSystem(COMBAT_SYSTEM_ID);
    harness.combat.setCombatMode(true);
    harness.combat.addTargetForDebug({ id: 'commonwealth_patrol', relation: 'friendly' });
    harness.combat.addTargetForDebug({ id: 'index_buoy', relation: 'neutral' });
    assert.throws(
        () => harness.combat.applyHitForDebug({ targetId: 'commonwealth_patrol' }),
        /forbidden against friendly/
    );
    assert.throws(
        () => harness.combat.applyHitForDebug({ targetId: 'index_buoy' }),
        /forbidden against neutral/
    );
    faceEnemy(harness.combat);
    assert.equal(harness.combat.cycleTarget().id, COMBAT_ENEMY_ID);
});

test('combat mode is available anywhere and safing weapons never resolves the encounter', () => {
    const harness = createHarness();
    assert.equal(harness.combat.toggleCombatMode().combatMode, true);
    assert.equal(harness.combat.getState().active, false);
    assert.throws(() => harness.combat.fire(), /active encounter/);

    harness.combat.syncSystem(COMBAT_SYSTEM_ID);
    const encounterId = harness.combat.getState().encounterId;
    faceEnemy(harness.combat);
    harness.combat.cycleTarget();
    assert.equal(harness.combat.toggleCombatMode().combatMode, false);
    const safed = harness.combat.getState();
    assert.equal(safed.active, true);
    assert.equal(safed.encounterId, encounterId);
    assert.equal(safed.targetId, null);
    assert.equal(safed.saved.lastOutcome, null);
    assert.throws(() => harness.combat.cycleTarget(), /requires combat mode/);
    assert.throws(() => harness.combat.fire(), /requires combat mode/);
});

test('flee, defeat/rescue, cleanup, hooks, events, and Phase 18 condition persist', () => {
    const fled = createHarness();
    fled.combat.syncSystem(COMBAT_SYSTEM_ID);
    for (let index = 0; index < 190; index += 1) {
        faceEnemy(fled.combat, [0, 0, 2000]);
    }
    assert.equal(fled.combat.getState().saved.lastOutcome.outcome, 'fled');
    assert.equal(fled.combat.getState().projectileCount, 0);
    assert.equal(fled.combat.getState().targetId, null);

    let hookCount = 0;
    const defeated = createHarness();
    defeated.combat.setOutcomeHooks({
        mission: () => { hookCount += 1; },
        reputation: () => { throw new Error('optional hook failed'); },
        crew: () => { hookCount += 1; }
    });
    defeated.combat.syncSystem(COMBAT_SYSTEM_ID);
    for (let index = 0; index < 25; index += 1) {
        defeated.combat.applyHitForDebug({
            sourceId: COMBAT_ENEMY_ID,
            targetId: 'player_ship',
            projectileId: `enemy-shot-${index}`,
            weaponId: COMBAT_ENEMY_WEAPON_ID
        });
    }
    assert.equal(defeated.combat.getState().phase, 'defeated');
    defeated.combat.rescueAfterDefeat();
    assert.equal(hookCount, 2);
    assert.equal(defeated.combat.getState().active, false);
    const envelope = defeated.slots.getActiveEnvelope();
    assert.equal(envelope.ship.condition.hull.current, 25);
    assert.ok(envelope.ship.condition.systems.engine.condition >= 25);
    assert.equal(envelope.rpg.combat.lastOutcome.outcome, 'defeat');
    assert.equal(defeated.combat.queryCombatEvents({ type: 'combat.defeat' }).length, 1);
    assert.deepEqual(COMBAT_ENEMY_WEAPON, {
        id: COMBAT_ENEMY_WEAPON_ID,
        projectileSpeed: 620,
        range: 520,
        cooldown: 1.5,
        hullDamage: 4,
        systemDamage: 6,
        projectileLifetime: 1.6
    });
});

test('corrupt combat persistence and invalid IDs/times reject descriptively', () => {
    const base = createSaveEnvelope({
        slotId: 'slot-phase19-corrupt',
        now: '2026-06-27T00:00:00.000Z'
    });
    const cases = [
        [(state) => { state.rpg.combat.enemy.id = 'forged'; }, /Unknown combat enemy ID/],
        [(state) => { state.rpg.combat.enemy.disposition = 'respawning'; }, /Unknown combat enemy disposition/],
        [(state) => {
            state.rpg.combat.enemy.disposition = 'destroyed';
            state.rpg.combat.enemy.destroyedAtGameTime = Number.NaN;
        }, /must be a non-negative finite number/],
        [(state) => { state.rpg.combat.wreck.id = 'forged'; }, /Unknown combat wreck ID/],
        [(state) => { state.rpg.combat.history = {}; }, /history must be an array/]
    ];
    for (const [mutate, pattern] of cases) {
        const value = structuredClone(base);
        mutate(value);
        assert.throws(() => sanitizeSaveEnvelope(value), pattern);
    }
});
