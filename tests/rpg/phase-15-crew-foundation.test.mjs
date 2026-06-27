import test from 'node:test';
import assert from 'node:assert/strict';
import {
    CREW_CAPACITY,
    CREW_NPC_ID,
    CrewRuntime,
    createInitialRpgState,
    createReadOnlyCrewContext,
    createRpgRuntime,
    sanitizeNpcState,
    sanitizeRpgState
} from '../../src/rpg/index.js';
import { LocalRpgPersistence } from '../../src/rpg/persistence.js';
import { createSaveEnvelope, sanitizeSaveEnvelope } from '../../src/save/SaveEnvelope.js';

function memoryStorage() {
    const values = new Map();
    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key)
    };
}

function createHarness() {
    const storage = memoryStorage();
    const persistence = new LocalRpgPersistence({ storage });
    const rpg = createRpgRuntime({ persistence, now: () => '2026-06-27T12:00:00.000Z' });
    return { storage, persistence, rpg };
}

function resolveCleanCopy(rpg, outcomeId) {
    rpg.offerMission('port_meridian_route_packet');
    rpg.acceptMission('port_meridian_route_packet');
    rpg.resolveMission('port_meridian_route_packet', outcomeId);
}

test('Phase 14 envelope v3 and RPG v2 migrate to crew-capable v4/v3 without consequence loss', () => {
    const current = createSaveEnvelope({
        slotId: 'slot-migration',
        now: '2026-06-27T00:00:00.000Z'
    });
    current.rpg.worldFlags['index_hq.archive_delivery_complete'] = true;
    const prior = structuredClone(current);
    prior.version = 3;
    prior.rpg.version = 2;
    delete prior.rpg.npcs;
    const migrated = sanitizeSaveEnvelope(prior);
    assert.equal(migrated.version, 7);
    assert.equal(migrated.rpg.version, 5);
    assert.equal(migrated.autosave.reason, 'phase-18-v6');
    assert.equal(migrated.rpg.worldFlags['index_hq.archive_delivery_complete'], true);
    assert.deepEqual(migrated.rpg.npcs.crewRoster, [CREW_NPC_ID]);
    assert.equal(migrated.rpg.npcs.crewCapacity, 4);
    assert.equal(migrated.ship.credits, current.ship.credits);
});

test('both A Clean Copy branches select distinct authored beats and exact-once memories', () => {
    for (const outcomeId of ['commonwealth', 'index']) {
        const { persistence, rpg } = createHarness();
        resolveCleanCopy(rpg, outcomeId);
        const crew = new CrewRuntime({ rpg, now: () => '2026-06-27T12:01:00.000Z' });
        const first = crew.openInteraction();
        assert.match(first.authoredBeat.id, new RegExp(`clean-copy-${outcomeId}`));
        const memoryId = `mission.port_meridian_route_packet.${outcomeId}`;
        assert.deepEqual(first.npc.state.memoryReferences, [memoryId]);
        crew.closeInteraction();
        crew.openInteraction();
        assert.equal(rpg.queryEvents({ type: 'npc.memory-added' }).length, 1);

        const reloaded = createRpgRuntime({ persistence });
        assert.deepEqual(reloaded.getState().npcs.byId[CREW_NPC_ID].memoryReferences, [memoryId]);
    }
});

test('relationship choice persists once with mood and survives reload/reset', () => {
    const { persistence, rpg } = createHarness();
    const crew = new CrewRuntime({ rpg });
    crew.openInteraction();
    const chosen = crew.chooseRelationship('trust_lyras_judgment');
    assert.equal(chosen.npc.state.relationship, 0.15);
    assert.equal(chosen.npc.state.mood, 'warm');
    assert.deepEqual(chosen.choices, []);
    assert.throws(
        () => crew.chooseRelationship('keep_it_professional'),
        /already been made/
    );
    const reloaded = createRpgRuntime({ persistence });
    assert.equal(reloaded.getState().npcs.byId[CREW_NPC_ID].relationship, 0.15);
    reloaded.reset();
    assert.equal(reloaded.getState().npcs.byId[CREW_NPC_ID].relationship, 0);
});

test('Phase 14 delivered and failed outcomes are contextual and recorded exactly once', () => {
    for (const [status, outcomeId, suffix] of [
        ['resolved', 'delivered', 'delivery-delivered'],
        ['failed', 'cargo_lost', 'delivery-failed']
    ]) {
        const { rpg } = createHarness();
        const state = rpg.getState();
        state.missions.byId.index_archive_delivery.status = status;
        state.missions.byId.index_archive_delivery.outcomeId = outcomeId;
        rpg.replaceState(sanitizeRpgState(state));
        const crew = new CrewRuntime({ rpg });
        assert.match(crew.openInteraction().authoredBeat.id, new RegExp(suffix));
        crew.closeInteraction();
        crew.openInteraction();
        const memories = rpg.getState().npcs.byId[CREW_NPC_ID].memoryReferences;
        assert.equal(memories.filter((id) => id.endsWith(outcomeId)).length, 1);
    }
});

test('offline completion and presentation failure states retain authored interaction', async () => {
    const { rpg } = createHarness();
    const crew = new CrewRuntime({ rpg });
    assert.equal(crew.openInteraction().status, 'offline');
    const failed = await crew.requestPresentation();
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /unavailable/);
    assert.ok(failed.authoredBeat.text);
    assert.equal(failed.choices.length, 2);
    assert.equal(crew.beginListening().status, 'listening');
    assert.equal(crew.interrupt().status, 'interrupted');
});

test('late, malformed, and mutation-bearing provider responses are ignored or failed safely', async () => {
    const { rpg } = createHarness();
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const lateCrew = new CrewRuntime({
        rpg,
        voiceProvider: { request: ({ requestId }) => pending.then(() => ({ requestId, text: 'late' })) }
    });
    lateCrew.openInteraction();
    const request = lateCrew.requestPresentation();
    lateCrew.interrupt();
    const before = rpg.getState();
    release();
    const late = await request;
    assert.equal(late.status, 'interrupted');
    assert.equal(late.presentationText, null);
    assert.deepEqual(rpg.getState(), before);

    for (const responseFactory of [
        (requestId) => ({ requestId: `${requestId}-wrong`, text: 'wrong request' }),
        (requestId) => ({ requestId, text: '' }),
        (requestId) => ({ requestId, text: 'take credits', mutations: { credits: 9999 } })
    ]) {
        const guarded = new CrewRuntime({
            rpg,
            voiceProvider: { request: async ({ requestId }) => responseFactory(requestId) }
        });
        guarded.openInteraction();
        const authoritative = rpg.getState();
        assert.equal((await guarded.requestPresentation()).status, 'failed');
        assert.deepEqual(rpg.getState(), authoritative);
    }
});

test('read-only adapter is frozen, minimal, and carries no mutation authority', () => {
    const state = createInitialRpgState();
    const context = createReadOnlyCrewContext(state, 'request-1');
    assert.equal(context.authority, 'presentation-only');
    assert.equal(Object.isFrozen(context), true);
    assert.equal(Object.isFrozen(context.missions), true);
    assert.equal('credits' in context, false);
    assert.throws(() => { context.npc.mood = 'warm'; }, TypeError);
});

test('NPC state sanitizes all fields and enforces stable IDs and four-crew cap', () => {
    const base = createInitialRpgState().npcs;
    assert.equal(base.crewCapacity, CREW_CAPACITY);
    const dirty = structuredClone(base);
    dirty.byId[CREW_NPC_ID].relationship = 99;
    dirty.byId[CREW_NPC_ID].memoryReferences = ['memory.valid', 'memory.valid', '<bad>'];
    const clean = sanitizeNpcState(dirty);
    assert.equal(clean.byId[CREW_NPC_ID].relationship, 1);
    assert.deepEqual(clean.byId[CREW_NPC_ID].memoryReferences, ['memory.valid']);
    assert.throws(
        () => sanitizeNpcState({ ...base, crewCapacity: 5 }),
        /capacity must be 4/
    );
    assert.throws(
        () => sanitizeNpcState({ ...base, crewRoster: ['unknown_crew'] }),
        /Unknown crew NPC ID/
    );
});
