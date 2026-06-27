import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DeliveryRuntime,
    HAZARD_DAMAGE,
    HAZARD_ID,
    SALVAGE_GRANT,
    SALVAGE_SOURCE_ID,
    SHIP_CONDITION_IDS,
    ShipConditionRuntime,
    calculateShipCapabilities,
    createRpgRuntime,
    sanitizeShipState
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

function createHarness({ gameTime = 200 } = {}) {
    let time = gameTime;
    let tick = 0;
    const now = () => new Date(Date.UTC(2026, 5, 27, 20, 0, tick++)).toISOString();
    const slots = new LocalSaveSlots({
        storage: new MemoryStorage(),
        now,
        makeId: () => 'slot-phase18'
    });
    const getGameTime = () => time;
    const rpg = createRpgRuntime({
        persistence: new SlotRpgPersistence({ slots, getGameTime }),
        now
    });
    const condition = new ShipConditionRuntime({ slots, rpg, getGameTime, now });
    const delivery = new DeliveryRuntime({ slots, rpg, getGameTime, now });
    return {
        slots,
        rpg,
        condition,
        delivery,
        now,
        getGameTime,
        setGameTime: (value) => { time = value; }
    };
}

function reopen(harness, activeSystemId = null) {
    const rpg = createRpgRuntime({
        persistence: new SlotRpgPersistence({
            slots: harness.slots,
            getGameTime: harness.getGameTime
        }),
        now: harness.now
    });
    const condition = new ShipConditionRuntime({
        slots: harness.slots,
        rpg,
        getGameTime: harness.getGameTime,
        now: harness.now
    });
    const delivery = new DeliveryRuntime({
        slots: harness.slots,
        rpg,
        getGameTime: harness.getGameTime,
        now: harness.now
    });
    condition.syncSystem(activeSystemId);
    delivery.syncSystem(activeSystemId);
    return { ...harness, rpg, condition, delivery };
}

test('Phase 17 envelope v6 / ship v1 migrates to v7 / ship v2 without prior-state loss', () => {
    const current = createSaveEnvelope({
        slotId: 'slot-phase18-migration',
        now: '2026-06-27T00:00:00.000Z'
    });
    const previous = structuredClone(current);
    previous.version = 6;
    previous.ship.version = 1;
    previous.ship.credits = 1150;
    previous.ship.fuel.current = 61;
    delete previous.ship.condition;
    delete previous.ship.inventory;
    delete previous.ship.maintenance;
    previous.rpg.worldFlags['index_hq.archive_delivery_complete'] = true;

    const migrated = sanitizeSaveEnvelope(previous);
    assert.equal(migrated.version, 7);
    assert.equal(migrated.ship.version, 2);
    assert.equal(migrated.autosave.reason, 'phase-18-v6');
    assert.equal(migrated.ship.credits, 1150);
    assert.equal(migrated.ship.fuel.current, 61);
    assert.equal(migrated.ship.condition.hull.current, 100);
    assert.equal(migrated.ship.condition.systems.weapons.condition, 100);
    assert.deepEqual(migrated.ship.inventory, { repairParts: 0, hullPlates: 0 });
    assert.equal(
        migrated.ship.maintenance.salvageSources[SALVAGE_SOURCE_ID].claimed,
        false
    );
    assert.equal(migrated.rpg.worldFlags['index_hq.archive_delivery_complete'], true);
});

test('one-shot salvage atomically grants exact inventory, applies damage, records events, and reloads', () => {
    let harness = createHarness();
    assert.throws(() => harness.condition.claimSalvage(), /requires authored system index_hq/);
    harness.condition.syncSystem('index_hq');
    const beforeSequence = harness.slots.getActiveEnvelope().autosave.sequence;
    const result = harness.condition.claimSalvage();
    const state = result.state;
    assert.deepEqual(result.damage, HAZARD_DAMAGE);
    assert.deepEqual(result.grant, SALVAGE_GRANT);
    assert.equal(state.condition.hull.current, 65);
    assert.equal(state.condition.systems.engine.condition, 55);
    assert.equal(state.condition.systems.sensors.condition, 70);
    assert.deepEqual(state.inventory, SALVAGE_GRANT);
    assert.equal(state.maintenance.salvageSources[SALVAGE_SOURCE_ID].claimed, true);
    assert.equal(state.maintenance.hazards[HAZARD_ID].triggered, true);
    assert.equal(harness.slots.getActiveEnvelope().autosave.sequence, beforeSequence + 1);
    assert.equal(harness.rpg.queryEvents({ type: 'ship.hazard.applied' }).length, 1);
    assert.equal(harness.rpg.queryEvents({ type: 'ship.salvage.claimed' }).length, 1);

    const fullInventory = createHarness();
    fullInventory.condition.syncSystem('index_hq');
    fullInventory.condition.setInventoryForDebug({ repairParts: 999, hullPlates: 999 });
    const beforeCapacityFailure = fullInventory.slots.getActiveEnvelope();
    assert.throws(
        () => fullInventory.condition.claimSalvage(),
        /cannot accept the exact derelict salvage grant/
    );
    assert.deepEqual(fullInventory.slots.getActiveEnvelope(), beforeCapacityFailure);

    harness = reopen(harness, 'index_hq');
    assert.equal(harness.condition.getState().condition.hull.current, 65);
    assert.deepEqual(harness.condition.getState().inventory, SALVAGE_GRANT);
    assert.deepEqual(
        harness.condition.claimSalvage(),
        {
            changed: false,
            reason: 'already-claimed',
            state: harness.condition.getState()
        }
    );
    harness.condition.syncSystem(null);
    harness.condition.syncSystem('index_hq');
    assert.equal(harness.condition.claimSalvage().changed, false);
    assert.equal(harness.rpg.queryEvents({ type: 'ship.salvage.claimed' }).length, 1);
});

test('repairs consume exactly one correct item, persist every checkpoint, and never partially fail', () => {
    let harness = createHarness();
    harness.condition.syncSystem('index_hq');
    harness.condition.claimSalvage();

    const hull = harness.condition.repair('hull');
    assert.equal(hull.consumed, 1);
    assert.equal(hull.before, 65);
    assert.equal(hull.after, 90);
    assert.deepEqual(hull.state.inventory, { repairParts: 3, hullPlates: 1 });
    harness = reopen(harness, 'index_hq');
    assert.equal(harness.condition.getState().condition.hull.current, 90);
    assert.equal(harness.condition.getState().inventory.hullPlates, 1);

    const engine = harness.condition.repair('engine');
    assert.equal(engine.after, 85);
    assert.equal(engine.state.inventory.repairParts, 2);
    harness = reopen(harness, 'index_hq');
    const sensors = harness.condition.repair('sensors');
    assert.equal(sensors.after, 100);
    assert.equal(sensors.state.inventory.repairParts, 1);

    const beforeFullFailure = harness.slots.getActiveEnvelope();
    assert.throws(() => harness.condition.repair('sensors'), /already at full condition/);
    assert.deepEqual(harness.slots.getActiveEnvelope(), beforeFullFailure);
    assert.throws(() => harness.condition.repair('reactor'), /Unknown ship condition target ID/);
    assert.deepEqual(harness.slots.getActiveEnvelope(), beforeFullFailure);

    harness.condition.setConditionForDebug('comms', 40);
    harness.condition.setInventoryForDebug({ repairParts: 0 });
    const beforeEmptyFailure = harness.slots.getActiveEnvelope();
    assert.throws(() => harness.condition.repair('comms'), /requires one repair_parts/);
    assert.deepEqual(harness.slots.getActiveEnvelope(), beforeEmptyFailure);
});

test('critical recovery is persistent, bounded, grants no inventory, and is unavailable otherwise', () => {
    let harness = createHarness();
    const clean = harness.slots.getActiveEnvelope();
    assert.throws(
        () => harness.condition.stabilizeCriticalState(),
        /requires hull or engine at or below 10/
    );
    assert.deepEqual(harness.slots.getActiveEnvelope(), clean);

    harness.condition.setConditionForDebug('hull', -999);
    harness.condition.setConditionForDebug('engine', 10);
    harness.condition.setInventoryForDebug({ repairParts: 0, hullPlates: 0 });
    const recovered = harness.condition.stabilizeCriticalState().state;
    assert.equal(recovered.condition.hull.current, 25);
    assert.equal(recovered.condition.systems.engine.condition, 25);
    assert.deepEqual(recovered.inventory, { repairParts: 0, hullPlates: 0 });
    harness = reopen(harness);
    assert.equal(harness.condition.getState().condition.hull.current, 25);
    assert.throws(
        () => harness.condition.stabilizeCriticalState(),
        /requires hull or engine at or below 10/
    );
    assert.equal(harness.rpg.queryEvents({ type: 'ship.emergency-stabilized' }).length, 1);
});

test('condition and inventory extremes sanitize; corrupt values and IDs reject descriptively', () => {
    const base = createHarness().slots.getActiveEnvelope().ship;
    const extreme = structuredClone(base);
    extreme.condition.hull.current = -1e12;
    extreme.condition.systems.engine.condition = 1e12;
    extreme.inventory.repairParts = 1e12;
    extreme.inventory.hullPlates = -1e12;
    const clean = sanitizeShipState(extreme);
    assert.equal(clean.condition.hull.current, 0);
    assert.equal(clean.condition.systems.engine.condition, 100);
    assert.equal(clean.inventory.repairParts, 999);
    assert.equal(clean.inventory.hullPlates, 0);

    for (const [mutate, pattern] of [
        [(state) => { state.condition.hull.current = Number.NaN; }, /must be a finite number/],
        [(state) => { state.inventory.repairParts = Number.POSITIVE_INFINITY; }, /must be a finite number/],
        [(state) => { state.condition.systems.reactor = { condition: 50 }; }, /Unknown ship condition system ID/],
        [(state) => { state.maintenance.salvageSources.forged = {}; }, /Unknown salvage source ID/],
        [(state) => {
            state.maintenance.salvageSources[SALVAGE_SOURCE_ID].claimed = 'false';
        }, /must be a boolean/],
        [(state) => {
            state.maintenance.salvageSources[SALVAGE_SOURCE_ID] = {
                claimed: true,
                claimedAtGameTime: null
            };
        }, /flag and game-time checkpoint must agree/],
        [(state) => {
            state.maintenance.salvageSources[SALVAGE_SOURCE_ID] = {
                claimed: true,
                claimedAtGameTime: 10
            };
        }, /must share one atomic checkpoint/]
    ]) {
        const dirty = structuredClone(base);
        mutate(dirty);
        assert.throws(() => sanitizeShipState(dirty), pattern);
    }
});

test('capability effects are finite and bounded for pristine, hazard, and zero condition', () => {
    const harness = createHarness();
    const pristine = harness.condition.getState().condition;
    const zero = structuredClone(pristine);
    zero.hull.current = 0;
    for (const id of SHIP_CONDITION_IDS.filter((id) => id !== 'hull')) {
        zero.systems[id].condition = 0;
    }
    for (const capabilities of [
        calculateShipCapabilities(pristine),
        calculateShipCapabilities(zero)
    ]) {
        for (const value of Object.values(capabilities)) {
            assert.ok(Number.isFinite(value));
            assert.ok(value >= 0.4 && value <= 1);
        }
    }
    const minimum = calculateShipCapabilities(zero);
    assert.equal(minimum.engineThrust, 0.4);
    assert.equal(minimum.hyperdriveAuthority, 0.5);
    assert.ok(minimum.engineThrust > 0);
    assert.ok(minimum.hyperdriveAuthority > 0);
});

test('later cargo/fuel writes preserve condition state and active-slot reset restores Phase 18 defaults', () => {
    let harness = createHarness();
    harness.condition.syncSystem('index_hq');
    harness.delivery.syncSystem('index_hq');
    harness.condition.claimSalvage();
    harness.delivery.setFuelForDebug(50);
    harness.delivery.refuel();
    assert.equal(harness.condition.getState().condition.hull.current, 65);
    assert.deepEqual(harness.condition.getState().inventory, SALVAGE_GRANT);

    harness.slots.resetActiveSlot();
    harness = reopen(harness);
    assert.equal(harness.condition.getState().condition.hull.current, 100);
    assert.equal(harness.condition.getState().condition.systems.engine.condition, 100);
    assert.deepEqual(harness.condition.getState().inventory, {
        repairParts: 0,
        hullPlates: 0
    });
    assert.equal(
        harness.condition.getState().maintenance.salvageSources[SALVAGE_SOURCE_ID].claimed,
        false
    );
});
