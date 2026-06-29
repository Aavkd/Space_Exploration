import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    DeliveryRuntime,
    calculateHyperdriveFuelCost,
    createRpgRuntime,
    getCargoQuantity,
    isMeteredAuthoredRoute,
    sanitizeShipState
} from '../../src/rpg/index.js';
import {
    LEGACY_SAVE_INDEX_KEY,
    LEGACY_SAVE_SLOT_KEY_PREFIX,
    LocalSaveSlots,
    SAVE_INDEX_KEY,
    SAVE_SLOT_KEY_PREFIX,
    SlotRpgPersistence
} from '../../src/save/index.js';

class MemoryStorage {
    constructor(entries = []) { this.values = new Map(entries); }
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) { this.values.set(key, String(value)); }
    removeItem(key) { this.values.delete(key); }
}

function createHarness({ storage = new MemoryStorage() } = {}) {
    let tick = 0;
    const now = () => new Date(Date.UTC(2026, 5, 27, 12, 0, tick++)).toISOString();
    const slots = new LocalSaveSlots({ storage, now, makeId: () => 'slot-phase14' });
    const rpg = createRpgRuntime({
        persistence: new SlotRpgPersistence({ slots, getGameTime: () => 77 }),
        now
    });
    const delivery = new DeliveryRuntime({ slots, rpg, getGameTime: () => 77, now });
    return { delivery, now, rpg, slots, storage };
}

function acceptDelivery(harness) {
    harness.delivery.syncSystem('entry_hub');
    harness.rpg.offerMission('index_archive_delivery');
    harness.rpg.acceptMission('index_archive_delivery');
    assert.equal(
        harness.rpg.getMission('index_archive_delivery').state.objectives.currentObjectiveId,
        'load_archive_canisters'
    );
}

function reopen(harness, activeSystemId) {
    const rpg = createRpgRuntime({
        persistence: new SlotRpgPersistence({ slots: harness.slots, getGameTime: () => 77 }),
        now: harness.now
    });
    const delivery = new DeliveryRuntime({
        slots: harness.slots,
        rpg,
        getGameTime: () => 77,
        now: harness.now
    });
    if (activeSystemId) {
        rpg.setActiveNamedSystem(activeSystemId);
        delivery.syncSystem(activeSystemId);
    }
    return { ...harness, rpg, delivery };
}

test('Phase 13 version-2 slot migrates non-destructively to envelope v3 and RPG v2', async () => {
    const fixture = await readFile(
        new URL('../fixtures/phase-13-v2-clean.json', import.meta.url),
        'utf8'
    );
    const storage = new MemoryStorage([
        [LEGACY_SAVE_INDEX_KEY, JSON.stringify({
            version: 1,
            activeSlotId: 'slot-phase13',
            slotIds: ['slot-phase13']
        })],
        [`${LEGACY_SAVE_SLOT_KEY_PREFIX}slot-phase13`, fixture]
    ]);
    const slots = new LocalSaveSlots({ storage });
    const envelope = slots.getActiveEnvelope();

    assert.equal(envelope.version, 13);
    assert.equal(envelope.rpg.version, 10);
    assert.equal(envelope.ship.credits, 300);
    assert.equal(envelope.ship.fuel.current, 100);
    assert.deepEqual(envelope.ship.cargo.stacks, []);
    assert.equal(envelope.simulation.gameTime, 123.5);
    assert.equal(envelope.autosave.kind, 'migration');
    assert.equal(envelope.autosave.reason, 'phase-24-v12');
    assert.ok(storage.getItem(LEGACY_SAVE_INDEX_KEY));
    assert.ok(storage.getItem(`${LEGACY_SAVE_SLOT_KEY_PREFIX}slot-phase13`));
    assert.ok(storage.getItem(SAVE_INDEX_KEY));
    assert.ok(storage.getItem(`${SAVE_SLOT_KEY_PREFIX}slot-phase13`));
});

test('clean delivery loop survives before-pickup, loaded, transit, destination, and delivered reloads', () => {
    let harness = createHarness();
    acceptDelivery(harness);
    harness = reopen(harness, 'entry_hub');
    assert.equal(harness.delivery.getState().mission.state.status, 'accepted');
    assert.equal(getCargoQuantity(harness.delivery.getState().ship, 'index_archive_canister'), 0);

    harness.delivery.loadMissionCargo();
    assert.equal(getCargoQuantity(harness.delivery.getState().ship, 'index_archive_canister'), 4);
    assert.equal(harness.delivery.getState().usedCargoMass, 20);
    harness = reopen(harness, 'entry_hub');
    assert.equal(
        harness.delivery.getState().mission.state.objectives.byId.load_archive_canisters.status,
        'complete'
    );

    const route = calculateHyperdriveFuelCost('entry_hub', 'index_hq');
    const firstJump = harness.delivery.beginAuthoredJump('index_hq');
    assert.equal(firstJump.fuelCost, route.fuelCost);
    assert.equal(harness.delivery.getState().ship.fuel.current, 100 - route.fuelCost);
    assert.equal(harness.delivery.beginAuthoredJump('index_hq').changed, false);
    harness = reopen(harness, null);
    assert.equal(harness.delivery.getState().ship.fuel.current, 100 - route.fuelCost);
    assert.equal(harness.delivery.beginAuthoredJump('index_hq').changed, false);

    harness.delivery.syncSystem('index_hq');
    assert.equal(harness.delivery.getState().ship.travel.pendingJump, null);
    assert.equal(
        harness.delivery.getState().mission.state.objectives.byId.travel_to_index_hq.status,
        'complete'
    );
    harness = reopen(harness, 'index_hq');
    const result = harness.delivery.deliverMissionCargo();
    assert.equal(result.creditsAwarded, 850);
    assert.equal(harness.delivery.getState().ship.credits, 1150);
    assert.equal(harness.rpg.getReputation('index'), 0.15);
    assert.equal(getCargoQuantity(harness.delivery.getState().ship, 'index_archive_canister'), 0);
    assert.equal(harness.delivery.deliverMissionCargo().changed, false);

    harness = reopen(harness, 'index_hq');
    harness.delivery.syncSystem('index_hq');
    assert.equal(harness.delivery.getState().ship.credits, 1150);
    assert.equal(harness.rpg.getReputation('index'), 0.15);
    assert.equal(
        harness.rpg.queryEvents({ missionId: 'index_archive_delivery', type: 'mission.consequence' }).length,
        1
    );
});

test('capacity and fuel reserve failures are descriptive and recovery is deterministic', () => {
    let harness = createHarness();
    acceptDelivery(harness);
    harness.delivery.addCargoForDebug('maintenance_supplies', 4);
    assert.throws(() => harness.delivery.loadMissionCargo(), /Cargo bay is full/);

    harness = createHarness();
    acceptDelivery(harness);
    harness.delivery.loadMissionCargo();
    harness.delivery.setFuelForDebug(30);
    assert.throws(
        () => harness.delivery.beginAuthoredJump('index_hq'),
        /Insufficient fuel.*protected reserve/
    );
    harness.delivery.setFuelForDebug(15);
    const rescue = harness.delivery.emergencyRescue();
    assert.equal(rescue.price, 50);
    assert.ok(rescue.fuel > 15);
    assert.doesNotThrow(() => harness.delivery.beginAuthoredJump('index_hq'));
});

test('abandon and cargo-loss paths remove mission cargo and persist without rewards', () => {
    let abandoned = createHarness();
    acceptDelivery(abandoned);
    abandoned.delivery.loadMissionCargo();
    abandoned.delivery.abandonMission();
    abandoned = reopen(abandoned, 'entry_hub');
    assert.equal(abandoned.delivery.getState().mission.state.outcomeId, 'abandoned');
    assert.equal(getCargoQuantity(abandoned.delivery.getState().ship, 'index_archive_canister'), 0);
    assert.equal(abandoned.delivery.getState().ship.credits, 300);

    let lost = createHarness();
    acceptDelivery(lost);
    lost.delivery.loadMissionCargo();
    lost.delivery.loseMissionCargo();
    lost = reopen(lost, 'entry_hub');
    assert.equal(lost.delivery.getState().mission.state.outcomeId, 'cargo_lost');
    assert.equal(getCargoQuantity(lost.delivery.getState().ship, 'index_archive_canister'), 0);
    assert.equal(lost.rpg.getReputation('index'), 0);
    assert.throws(() => lost.delivery.loseMissionCargo(), /No Index archive mission cargo/);
});

test('ship-state validation rejects unknown cargo, over-capacity state, and forged routes', () => {
    const harness = createHarness();
    const base = harness.delivery.getState().ship;
    assert.throws(
        () => harness.rpg.resolveMission('index_archive_delivery', 'delivered'),
        /requires its authoritative domain runtime/
    );
    assert.throws(
        () => sanitizeShipState({
            ...base,
            cargo: { ...base.cargo, stacks: [{ cargoId: 'missing', quantity: 1 }] }
        }),
        /Unknown cargo ID/
    );
    assert.throws(
        () => sanitizeShipState({
            ...base,
            cargo: { ...base.cargo, stacks: [{ cargoId: 'maintenance_supplies', quantity: 5 }] }
        }),
        /exceeds ship capacity/
    );
    assert.throws(
        () => sanitizeShipState({
            ...base,
            travel: {
                currentSystemId: 'entry_hub',
                pendingJump: {
                    originSystemId: 'entry_hub',
                    targetSystemId: 'index_hq',
                    distance: 1,
                    fuelCost: 1
                }
            }
        }),
        /does not match the deterministic/
    );
});

test('fuel gating never blocks initial approach, ordinary flight, or same-system hyperdrive', () => {
    assert.equal(isMeteredAuthoredRoute(null, 'entry_hub'), false);
    assert.equal(isMeteredAuthoredRoute('entry_hub', null), false);
    assert.equal(isMeteredAuthoredRoute('entry_hub', 'entry_hub'), false);
    assert.equal(isMeteredAuthoredRoute('entry_hub', 'index_hq'), true);
});
