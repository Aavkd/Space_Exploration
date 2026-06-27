import assert from 'node:assert/strict';
import test from 'node:test';

import {
    LocalRpgPersistence,
    RPG_LOCAL_STORAGE_KEY,
    RpgRuntime,
    createInitialRpgState,
    migrateRpgState
} from '../../src/rpg/index.js';

class MemoryStorage {
    constructor(entries = []) {
        this.data = new Map(entries);
    }

    getItem(key) {
        return this.data.has(key) ? this.data.get(key) : null;
    }

    setItem(key, value) {
        this.data.set(key, String(value));
    }

    removeItem(key) {
        this.data.delete(key);
    }
}

function createRuntime(storage, secondOffset = 0) {
    let tick = secondOffset;
    return new RpgRuntime({
        persistence: new LocalRpgPersistence({ storage }),
        now: () => `2026-06-27T12:00:${String(tick++).padStart(2, '0')}.000Z`
    });
}

function openPortMeridianComms(runtime) {
    assert.deepEqual(runtime.getAvailableContacts(), []);
    runtime.setActiveNamedSystem('entry_hub');
    assert.deepEqual(
        runtime.getAvailableContacts().map((contact) => contact.id),
        ['port_meridian_harbormaster']
    );
    runtime.startConversation('port_meridian_harbormaster');
}

function reachMissionChoice(runtime) {
    openPortMeridianComms(runtime);
    runtime.chooseDialogue('ask_work');
    assert.equal(runtime.getMission('port_meridian_route_packet').state.status, 'offered');
    runtime.chooseDialogue('accept_route_packet');
    assert.equal(runtime.getMission('port_meridian_route_packet').state.status, 'accepted');
}

test('fresh state is deterministic and reset only clears RPG progress', () => {
    const storage = new MemoryStorage();
    const runtime = createRuntime(storage);

    assert.equal(runtime.getState().version, 8);
    assert.equal(runtime.getState().eventLog.length, 0);
    assert.equal(runtime.getMission('port_meridian_route_packet').state.status, 'unavailable');

    runtime.adjustReputation('commonwealth', 0.5, 'test');
    assert.equal(runtime.getReputation('commonwealth'), 0.5);
    runtime.reset();

    assert.equal(runtime.getReputation('commonwealth'), 0);
    assert.equal(runtime.getState().eventLog.length, 0);
    assert.ok(storage.getItem(RPG_LOCAL_STORAGE_KEY));
});

test('Commonwealth branch persists consequences and resolved dialogue', () => {
    const storage = new MemoryStorage();
    let runtime = createRuntime(storage);
    reachMissionChoice(runtime);
    runtime.chooseDialogue('resolve_route_commonwealth');

    const state = runtime.getState();
    assert.equal(runtime.getMission('port_meridian_route_packet').state.lastBranchId, 'commonwealth');
    assert.equal(runtime.getReputation('commonwealth'), 0.18);
    assert.equal(runtime.getReputation('index'), -0.08);
    assert.equal(state.worldFlags['port_meridian.route_packet_owner'], 'commonwealth');
    assert.equal(state.worldFlags['port_meridian.route_packet_resolved'], true);
    assert.deepEqual(
        state.eventLog
            .filter((event) => event.type.startsWith('mission.'))
            .map((event) => event.type),
        ['mission.offered', 'mission.accepted', 'mission.resolved', 'mission.consequence']
    );

    runtime = createRuntime(storage, 30);
    runtime.setActiveNamedSystem('entry_hub');
    runtime.startConversation('port_meridian_harbormaster');
    assert.equal(runtime.getCommsState().conversationNodeId, 'mission_resolved_commonwealth');
    assert.equal(runtime.getState().worldFlags['port_meridian.route_packet_owner'], 'commonwealth');
});

test('Index branch applies its distinct persistent consequences', () => {
    const storage = new MemoryStorage();
    let runtime = createRuntime(storage);
    reachMissionChoice(runtime);
    runtime.chooseDialogue('resolve_route_index');

    assert.equal(runtime.getMission('port_meridian_route_packet').state.lastBranchId, 'index');
    assert.equal(runtime.getReputation('index'), 0.18);
    assert.equal(runtime.getReputation('commonwealth'), -0.08);
    assert.equal(runtime.getState().worldFlags['port_meridian.route_packet_owner'], 'index');

    runtime = createRuntime(storage, 30);
    runtime.setActiveNamedSystem('entry_hub');
    runtime.startConversation('port_meridian_harbormaster');
    assert.equal(runtime.getCommsState().conversationNodeId, 'mission_resolved_index');
});

test('decline path persists its failure outcome and dialogue', () => {
    const storage = new MemoryStorage();
    let runtime = createRuntime(storage);
    openPortMeridianComms(runtime);
    runtime.chooseDialogue('ask_work');
    runtime.chooseDialogue('decline_route_packet');

    assert.equal(runtime.getMission('port_meridian_route_packet').state.status, 'failed');
    assert.equal(runtime.getMission('port_meridian_route_packet').state.outcomeId, 'declined');

    runtime = createRuntime(storage, 30);
    runtime.setActiveNamedSystem('entry_hub');
    runtime.startConversation('port_meridian_harbormaster');
    assert.equal(runtime.getCommsState().conversationNodeId, 'mission_declined');
});

test('unknown RPG identifiers and illegal outcomes fail descriptively', () => {
    const runtime = createRuntime(new MemoryStorage());

    assert.throws(() => runtime.getFaction('missing'), /Unknown RPG faction ID: missing/);
    assert.throws(() => runtime.getMission('missing'), /Unknown RPG mission ID: missing/);
    assert.throws(() => runtime.startConversation('missing'), /Unknown RPG contact ID: missing/);
    assert.throws(
        () => runtime.resolveMission('port_meridian_route_packet', 'missing'),
        /Unknown RPG mission branch ID/
    );
    assert.throws(
        () => runtime.failMission('port_meridian_route_packet', 'missing'),
        /Unknown RPG mission failure outcome ID/
    );
});

test('persistence recovers from corrupt or unavailable storage', () => {
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(String(args[0]));

    try {
        const corruptStorage = new MemoryStorage([
            [RPG_LOCAL_STORAGE_KEY, '{not-json']
        ]);
        assert.equal(new LocalRpgPersistence({ storage: corruptStorage }).load().version, 8);

        const futureStorage = new MemoryStorage([
            [RPG_LOCAL_STORAGE_KEY, JSON.stringify({
                ...createInitialRpgState(),
                version: 6
            })]
        ]);
        const recoveredFuture = new LocalRpgPersistence({ storage: futureStorage }).load();
        assert.equal(recoveredFuture.version, 8);
        assert.equal(recoveredFuture.eventLog.length, 0);

        const unavailableStorage = {
            getItem() { throw new Error('blocked'); },
            setItem() { throw new Error('quota'); },
            removeItem() { throw new Error('blocked'); }
        };
        const persistence = new LocalRpgPersistence({ storage: unavailableStorage });
        assert.equal(persistence.load().version, 8);
        assert.equal(persistence.save(createInitialRpgState()).version, 8);
        assert.equal(persistence.reset().version, 8);
    } finally {
        console.warn = originalWarn;
    }

    assert.ok(warnings.some((message) => message.includes('Could not load RPG state')));
    assert.ok(warnings.some((message) => message.includes('Could not save RPG state')));
    assert.ok(warnings.some((message) => message.includes('Could not clear RPG state')));
});

test('migration boundary accepts current saves and rejects unsafe versions', () => {
    const state = createInitialRpgState();
    assert.deepEqual(migrateRpgState(state), state);
    assert.notEqual(migrateRpgState(state), state);

    assert.throws(
        () => migrateRpgState({ ...state, version: 9 }),
        /newer than supported version 8/
    );
    assert.throws(
        () => migrateRpgState({ ...state, version: 0 }),
        /Invalid RPG save version: 0/
    );
    assert.throws(
        () => migrateRpgState({ ...state, version: undefined }),
        /Invalid RPG save version: missing/
    );
});
