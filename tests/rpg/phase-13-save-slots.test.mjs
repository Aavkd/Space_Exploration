import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createRpgRuntime } from '../../src/rpg/index.js';
import {
    GameClock,
    LocalSaveSlots,
    MAX_EVENT_LOG_ENTRIES,
    SAVE_INDEX_KEY,
    SAVE_SLOT_KEY_PREFIX,
    SAVE_SLOT_LIMIT,
    SlotRpgPersistence,
    compactEventLog
} from '../../src/save/index.js';
import { RPG_LOCAL_STORAGE_KEY } from '../../src/rpg/persistence.js';

class MemoryStorage {
    constructor(entries = []) {
        this.values = new Map(entries);
    }
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) { this.values.set(key, String(value)); }
    removeItem(key) { this.values.delete(key); }
}

function createHarness({ storage = new MemoryStorage(), ids = ['slot-one', 'slot-two', 'slot-three'] } = {}) {
    let time = 0;
    let idIndex = 0;
    const now = () => new Date(Date.UTC(2026, 5, 27, 0, 0, time++)).toISOString();
    const slots = new LocalSaveSlots({ storage, now, makeId: () => ids[idIndex++] });
    const runtime = createRpgRuntime({
        persistence: new SlotRpgPersistence({ slots, getGameTime: () => 42 }),
        now
    });
    return { slots, runtime, storage };
}

test('Phase 11 version-1 fixture migrates into a version-2 envelope without outcome loss', async () => {
    const fixtureUrl = new URL('../fixtures/phase-11-v1-commonwealth.json', import.meta.url);
    const legacyText = await readFile(fixtureUrl, 'utf8');
    const storage = new MemoryStorage([[RPG_LOCAL_STORAGE_KEY, legacyText]]);
    const { slots } = createHarness({ storage });
    const envelope = slots.getActiveEnvelope();

    assert.equal(envelope.version, 2);
    assert.equal(envelope.autosave.kind, 'migration');
    assert.equal(envelope.autosave.reason, 'phase-11-v1');
    assert.equal(envelope.rpg.missions.byId.port_meridian_route_packet.outcomeId, 'commonwealth');
    assert.equal(envelope.rpg.factions.byId.commonwealth.reputation, 0.18);
    assert.equal(envelope.rpg.factions.byId.index.reputation, -0.08);
    assert.equal(
        envelope.rpg.contacts.byId.port_meridian_harbormaster.conversation.nodeId,
        'mission_resolved_commonwealth'
    );
    assert.equal(envelope.rpg.eventLog.length, 2);
    assert.equal(envelope.rpg.worldFlags['port_meridian.route_packet_owner'], 'commonwealth');
    assert.deepEqual(envelope.player, {});
    assert.deepEqual(envelope.ship, {});
    assert.deepEqual(envelope.settings, {});
});

test('three slots remain isolated across mutation, close/reopen, load, delete, and active reset', () => {
    const { slots, runtime, storage } = createHarness();
    runtime.offerMission('port_meridian_route_packet');
    const firstId = slots.getStatus().activeSlotId;

    slots.createSlot('Second');
    runtime.reload();
    assert.equal(runtime.getMission('port_meridian_route_packet').state.status, 'unavailable');
    runtime.offerMission('port_meridian_route_packet');
    runtime.acceptMission('port_meridian_route_packet');
    const secondId = slots.getStatus().activeSlotId;

    slots.createSlot('Third');
    const thirdId = slots.getStatus().activeSlotId;
    assert.equal(slots.listSlots().length, SAVE_SLOT_LIMIT);
    assert.throws(() => slots.createSlot('Fourth'), /slot limit reached/i);

    const reopened = new LocalSaveSlots({ storage, makeId: () => 'slot-unused' });
    assert.equal(reopened.getStatus().activeSlotId, thirdId);
    reopened.loadSlot(firstId);
    const firstRuntime = createRpgRuntime({ persistence: new SlotRpgPersistence({ slots: reopened }) });
    assert.equal(firstRuntime.getMission('port_meridian_route_packet').state.status, 'offered');
    reopened.loadSlot(secondId);
    firstRuntime.reload();
    assert.equal(firstRuntime.getMission('port_meridian_route_packet').state.status, 'accepted');

    reopened.deleteSlot(firstId);
    assert.equal(reopened.listSlots().length, 2);
    assert.equal(storage.getItem(`${SAVE_SLOT_KEY_PREFIX}${firstId}`), null);
    reopened.resetActiveSlot();
    firstRuntime.reload();
    assert.equal(firstRuntime.getMission('port_meridian_route_packet').state.status, 'unavailable');
});

test('validated import creates a new slot and rejects changed, corrupt, and future data safely', () => {
    const { slots, runtime } = createHarness();
    runtime.offerMission('port_meridian_route_packet');
    const originalId = slots.getStatus().activeSlotId;
    const exported = slots.exportSlot();
    const preview = slots.previewImport(exported);

    assert.throws(
        () => slots.importPreviewed(exported.replace('"gameTime": 42', '"gameTime": 43'), preview.token),
        /unchanged validated preview/
    );
    assert.equal(slots.getStatus().activeSlotId, originalId);
    assert.throws(() => slots.previewImport('{broken'), /Save import rejected/);
    const future = JSON.stringify({ ...JSON.parse(exported), version: 99 });
    assert.throws(() => slots.previewImport(future), /newer than supported version 2/);
    assert.equal(slots.listSlots().length, 1);

    const imported = slots.importPreviewed(exported, slots.previewImport(exported).token);
    assert.notEqual(imported.slot.id, originalId);
    assert.equal(imported.autosave.kind, 'import');
    assert.equal(slots.listSlots().length, 2);
    slots.loadSlot(originalId);
    assert.equal(slots.getActiveEnvelope().slot.id, originalId);
});

test('monotonic game clock advances only while active and never catches up focus gaps', () => {
    let now = 1000;
    const clock = new GameClock({ now: () => now, initialGameTime: 12 });
    clock.update(false);
    now += 5000;
    assert.equal(clock.update(false), 12);
    clock.setActive(true);
    now += 2500;
    assert.equal(clock.update(true), 14.5);
    clock.setActive(false);
    now += 60_000;
    clock.setActive(true);
    assert.equal(clock.update(true), 14.5);
    now -= 100;
    assert.equal(clock.update(true), 14.5);
    clock.restore(7);
    assert.equal(clock.getTime(), 7);
});

test('storage write failure is visible while in-memory runtime remains usable', () => {
    const storage = new MemoryStorage();
    const harness = createHarness({ storage });
    storage.setItem = () => { throw new Error('quota denied'); };

    assert.doesNotThrow(() => harness.runtime.offerMission('port_meridian_route_packet'));
    assert.match(harness.slots.getStatus().lastError.message, /quota denied/);
    assert.equal(harness.runtime.getMission('port_meridian_route_packet').state.status, 'offered');
});

test('event retention keeps authoritative mission outcomes and bounds ordinary history', () => {
    const entries = Array.from({ length: MAX_EVENT_LOG_ENTRIES + 50 }, (_, index) => ({
        id: `event-${String(index + 1).padStart(6, '0')}`,
        type: index === 0 ? 'mission.resolved' : 'telemetry.sample',
        payload: index === 0 ? { missionId: 'port_meridian_route_packet' } : {},
        createdAt: '2026-06-27T00:00:00.000Z'
    }));
    const compacted = compactEventLog(entries);
    assert.equal(compacted.length, MAX_EVENT_LOG_ENTRIES);
    assert.ok(compacted.some((entry) => entry.type === 'mission.resolved'));
    assert.ok(compacted.some((entry) => entry.id === entries.at(-1).id));
});

test('event-log query filters deterministic mission history and validates its contract', () => {
    const { runtime } = createHarness();
    runtime.resolveMission('port_meridian_route_packet', 'commonwealth');
    runtime.appendEvent('diagnostic.note', { factionId: 'index' });

    const missionEvents = runtime.queryEvents({
        missionId: 'port_meridian_route_packet',
        newestFirst: true,
        limit: 3
    });
    assert.equal(missionEvents.length, 3);
    assert.ok(missionEvents.every((entry) => entry.payload.missionId === 'port_meridian_route_packet'));
    assert.equal(missionEvents[0].type, 'mission.consequence');
    assert.deepEqual(
        runtime.queryEvents({ factionId: 'index', type: 'diagnostic.note' }).map((entry) => entry.type),
        ['diagnostic.note']
    );
    assert.throws(() => runtime.queryEvents({ type: '' }), /non-empty string or null/);
});

test('corrupt slot index recovers to an in-memory flight without damaging stored bytes', () => {
    const corrupt = '{"version":1,"activeSlotId":"slot-missing","slotIds":["slot-missing"]}';
    const storage = new MemoryStorage([[SAVE_INDEX_KEY, corrupt]]);
    const slots = new LocalSaveSlots({ storage, makeId: () => 'slot-recovery' });
    assert.equal(slots.getStatus().activeSlotId, 'slot-memory');
    assert.ok(slots.getStatus().lastError);
    assert.equal(storage.getItem(SAVE_INDEX_KEY), corrupt);
});
