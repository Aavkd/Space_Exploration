import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DeliveryRuntime,
    PatrolRuntime,
    classifyReputation,
    createInitialPatrolState,
    createPatrolEncounterId,
    createRpgRuntime,
    evaluatePatrolPolicy,
    queryFactionInfluence,
    sanitizePatrolState,
    scanCargoLegality
} from '../../src/rpg/index.js';
import {
    LocalSaveSlots,
    SlotRpgPersistence,
    createSaveEnvelope,
    sanitizeSaveEnvelope
} from '../../src/save/index.js';
import {
    findAuthoredNavigationReplacement,
    findLiveNavigationReplacement,
    navigationTargetBelongsToDepth
} from '../../src/ui/navigationTargetFrame.js';

class MemoryStorage {
    constructor() { this.values = new Map(); }
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) { this.values.set(key, String(value)); }
    removeItem(key) { this.values.delete(key); }
}

function createHarness({ gameTime = 100, worldSeed = 'phase17-test-seed' } = {}) {
    let time = gameTime;
    let tick = 0;
    const now = () => new Date(Date.UTC(2026, 5, 27, 18, 0, tick++)).toISOString();
    const slots = new LocalSaveSlots({
        storage: new MemoryStorage(),
        now,
        makeId: () => 'slot-phase17'
    });
    const getGameTime = () => time;
    const rpg = createRpgRuntime({
        persistence: new SlotRpgPersistence({ slots, getGameTime }),
        now
    });
    const delivery = new DeliveryRuntime({ slots, rpg, getGameTime, now });
    const patrol = new PatrolRuntime({ slots, rpg, getGameTime, now, worldSeed });
    return {
        slots,
        rpg,
        delivery,
        patrol,
        now,
        getGameTime,
        setGameTime: (value) => { time = value; }
    };
}

function reopen(harness) {
    const rpg = createRpgRuntime({
        persistence: new SlotRpgPersistence({
            slots: harness.slots,
            getGameTime: harness.getGameTime
        }),
        now: harness.now
    });
    return {
        ...harness,
        rpg,
        delivery: new DeliveryRuntime({
            slots: harness.slots,
            rpg,
            getGameTime: harness.getGameTime,
            now: harness.now
        }),
        patrol: new PatrolRuntime({
            slots: harness.slots,
            rpg,
            getGameTime: harness.getGameTime,
            now: harness.now,
            worldSeed: 'phase17-test-seed'
        })
    };
}

function advanceToWait(harness) {
    harness.setGameTime(106.25);
    harness.patrol.update();
    assert.equal(harness.patrol.getState().activeEncounter.phase, 'wait');
}

function setReputation(harness, value) {
    harness.rpg.setReputation('commonwealth', value, 'phase17-test');
}

test('Phase 16 envelope v5/RPG v4 migrates to v6/v5 with initialized patrol state', () => {
    const current = createSaveEnvelope({
        slotId: 'slot-phase17-migration',
        now: '2026-06-27T00:00:00.000Z'
    });
    current.ship.credits = 1150;
    current.rpg.worldFlags['index_hq.archive_delivery_complete'] = true;
    const previous = structuredClone(current);
    previous.version = 5;
    previous.rpg.version = 4;
    delete previous.rpg.patrol;

    const migrated = sanitizeSaveEnvelope(previous);
    assert.equal(migrated.version, 13);
    assert.equal(migrated.rpg.version, 10);
    assert.equal(migrated.autosave.reason, 'phase-24-v12');
    assert.deepEqual(migrated.rpg.patrol, createInitialPatrolState());
    assert.equal(migrated.ship.credits, 1150);
    assert.equal(migrated.rpg.worldFlags['index_hq.archive_delivery_complete'], true);
});

test('faction influence and encounter identity are deterministic and validate IDs', () => {
    const first = createHarness();
    const second = createHarness();
    assert.deepEqual(
        queryFactionInfluence({ systemId: 'entry_hub', rpgState: first.rpg.getState() }),
        queryFactionInfluence({ systemId: 'entry_hub', rpgState: second.rpg.getState() })
    );
    assert.equal(first.patrol.getInfluence('entry_hub').controllingFactionId, 'commonwealth');
    assert.equal(first.patrol.getInfluence('index_hq').patrolEnabled, false);
    assert.throws(() => first.patrol.getInfluence('missing'), /Unknown RPG named system ID/);

    first.patrol.syncSystem('entry_hub');
    second.patrol.syncSystem('entry_hub');
    assert.deepEqual(
        first.patrol.getState().activeEncounter,
        second.patrol.getState().activeEncounter
    );
    const encounter = first.patrol.getState().activeEncounter;
    assert.equal(encounter.id, createPatrolEncounterId({
        worldSeed: 'phase17-test-seed',
        policyId: encounter.policyId,
        systemId: encounter.systemId,
        sequence: encounter.sequence,
        gameTime: encounter.spawnedAtGameTime,
        reputationSnapshot: encounter.reputationSnapshot,
        cargoFingerprint: encounter.cargoFingerprint,
        contrabandValue: encounter.cargoScan.contrabandValue
    }));
});

test('spawn, approach, hail, wait, depart, and despawn use active play time only', () => {
    const harness = createHarness();
    harness.patrol.syncSystem('entry_hub');
    assert.equal(harness.patrol.getState().activeEncounter.phase, 'spawn');
    harness.patrol.update();
    assert.equal(harness.patrol.getState().activeEncounter.phase, 'spawn');
    harness.setGameTime(100.25);
    harness.patrol.update();
    assert.equal(harness.patrol.getState().activeEncounter.phase, 'approach');
    harness.setGameTime(105.25);
    harness.patrol.update();
    assert.equal(harness.patrol.getState().activeEncounter.phase, 'hail');
    advanceToWait(harness);
    harness.setGameTime(166.25);
    harness.patrol.update();
    assert.equal(harness.patrol.getState().activeEncounter.phase, 'depart');
    assert.equal(harness.patrol.getState().activeEncounter.outcomeId, 'ignored_hail');
    harness.setGameTime(174.25);
    harness.patrol.update();
    assert.equal(harness.patrol.getState().activeEncounter, null);
    assert.equal(harness.patrol.getState().patrol.history.at(-1).outcomeId, 'ignored_hail');
});

test('reputation hysteresis prevents boundary flapping and active encounters snapshot their band', () => {
    assert.equal(classifyReputation(0.35), 'positive');
    assert.equal(classifyReputation(0.32, 'positive'), 'positive');
    assert.equal(classifyReputation(0.29, 'positive'), 'neutral');
    assert.equal(classifyReputation(-0.25), 'negative');
    assert.equal(classifyReputation(-0.22, 'negative'), 'negative');
    assert.equal(classifyReputation(-0.19, 'negative'), 'neutral');
    assert.equal(classifyReputation(-0.60), 'hostile');
    assert.equal(classifyReputation(-0.57, 'hostile'), 'hostile');
    assert.equal(classifyReputation(-0.54, 'hostile'), 'negative');

    const harness = createHarness();
    setReputation(harness, 0.35);
    harness.patrol.syncSystem('entry_hub');
    setReputation(harness, -1);
    assert.equal(harness.patrol.getState().activeEncounter.reputationBand, 'positive');
    assert.equal(harness.patrol.getState().activeEncounter.reputationSnapshot, 0.35);
});

test('welcome, inspection, refusal, ignored hail, and safe hostility all depart without mutation', () => {
    const scenarios = [
        { reputation: 0.5, expected: 'welcome', scan: false },
        { reputation: 0, expected: 'inspection_clear', scan: true },
        { reputation: -0.3, expected: 'warning_refusal', scan: false },
        { reputation: -0.7, expected: 'safe_hostility', scan: false }
    ];
    for (const scenario of scenarios) {
        const harness = createHarness();
        setReputation(harness, scenario.reputation);
        const beforeShip = harness.slots.getActiveEnvelope().ship;
        harness.patrol.syncSystem('entry_hub');
        advanceToWait(harness);
        harness.patrol.acknowledgeHail();
        if (scenario.scan) {
            assert.equal(harness.patrol.getState().activeEncounter.scanPending, true);
            harness.patrol.submitCargoScan();
        }
        const encounter = harness.patrol.getState().activeEncounter;
        assert.equal(encounter.phase, 'depart');
        assert.equal(encounter.outcomeId, scenario.expected);
        assert.deepEqual(harness.slots.getActiveEnvelope().ship, beforeShip);
    }

    const ignored = createHarness();
    ignored.patrol.syncSystem('entry_hub');
    advanceToWait(ignored);
    ignored.patrol.ignoreHail();
    assert.equal(ignored.patrol.getState().activeEncounter.outcomeId, 'ignored_hail');
});

test('cargo scan detects restricted and contraband tags without confiscating cargo', () => {
    const restricted = createHarness();
    restricted.delivery.addCargoForDebug('index_archive_canister', 1);
    const restrictedShip = restricted.slots.getActiveEnvelope().ship;
    assert.equal(scanCargoLegality(restrictedShip, 'commonwealth_port_meridian').status, 'restricted');
    restricted.patrol.syncSystem('entry_hub');
    advanceToWait(restricted);
    restricted.patrol.acknowledgeHail();
    restricted.patrol.submitCargoScan();
    assert.equal(restricted.patrol.getState().activeEncounter.outcomeId, 'inspection_clear');

    const contraband = createHarness();
    contraband.delivery.addCargoForDebug('unregistered_signal_scrambler', 1);
    const before = contraband.slots.getActiveEnvelope().ship;
    contraband.patrol.syncSystem('entry_hub');
    assert.equal(contraband.patrol.getState().activeEncounter.cargoScan.status, 'contraband');
    advanceToWait(contraband);
    contraband.patrol.acknowledgeHail();
    contraband.patrol.submitCargoScan();
    assert.equal(contraband.patrol.getState().activeEncounter.outcomeId, 'warning_refusal');
    assert.deepEqual(contraband.slots.getActiveEnvelope().ship, before);
    assert.deepEqual(
        evaluatePatrolPolicy({ reputationBand: 'neutral', cargoScan: { status: 'contraband' } }),
        { action: null, requiresScan: true }
    );
});

test('reload and same-system scale sync retain one agent; exit aborts and re-entry creates one new visit', () => {
    let harness = createHarness();
    harness.patrol.syncSystem('entry_hub');
    const firstId = harness.patrol.getState().activeEncounter.id;
    harness = reopen(harness);
    harness.patrol.syncSystem('entry_hub');
    assert.equal(harness.patrol.getState().activeEncounter.id, firstId);
    assert.equal(harness.rpg.queryEvents({ type: 'patrol.spawned' }).length, 1);

    harness.patrol.syncSystem('entry_hub');
    assert.equal(harness.rpg.queryEvents({ type: 'patrol.spawned' }).length, 1);
    harness.patrol.syncSystem(null);
    assert.equal(harness.patrol.getState().activeEncounter, null);
    assert.equal(harness.patrol.getState().patrol.history.at(-1).phase, 'abort');
    assert.equal(harness.patrol.getState().patrol.history.at(-1).outcomeId, 'aborted');

    harness.patrol.syncSystem('entry_hub');
    const secondId = harness.patrol.getState().activeEncounter.id;
    assert.notEqual(secondId, firstId);
    assert.equal(harness.rpg.queryEvents({ type: 'patrol.spawned' }).length, 2);
});

test('wait, scan-pending, and departure checkpoints reload coherently without duplicate outcomes', () => {
    let harness = createHarness();
    harness.patrol.syncSystem('entry_hub');
    advanceToWait(harness);
    const encounterId = harness.patrol.getState().activeEncounter.id;

    harness = reopen(harness);
    harness.patrol.syncSystem('entry_hub');
    assert.equal(harness.patrol.getState().activeEncounter.id, encounterId);
    assert.equal(harness.patrol.getState().activeEncounter.phase, 'wait');

    harness.patrol.acknowledgeHail();
    assert.equal(harness.patrol.getState().activeEncounter.scanPending, true);
    harness = reopen(harness);
    harness.patrol.syncSystem('entry_hub');
    assert.equal(harness.patrol.getState().activeEncounter.scanPending, true);

    harness.patrol.submitCargoScan();
    assert.equal(harness.patrol.getState().activeEncounter.phase, 'depart');
    harness = reopen(harness);
    harness.patrol.syncSystem('entry_hub');
    assert.equal(harness.patrol.getState().activeEncounter.outcomeId, 'inspection_clear');
    assert.equal(harness.rpg.queryEvents({ type: 'patrol.outcome' }).length, 1);
});

test('non-patrol authored systems are observational and do not write patrol presence or saves', () => {
    const harness = createHarness();
    const before = harness.slots.getActiveEnvelope();
    harness.patrol.syncSystem('index_hq');
    const after = harness.slots.getActiveEnvelope();
    assert.equal(harness.patrol.getState().patrol.presenceSystemId, null);
    assert.equal(harness.patrol.getState().activeEncounter, null);
    assert.equal(after.autosave.sequence, before.autosave.sequence);
    assert.deepEqual(after.rpg.patrol, before.rpg.patrol);
});

test('authored navigation locks remain owned by their scale frame and remap by stable system ID', () => {
    assert.equal(navigationTargetBelongsToDepth(0, 0), true);
    assert.equal(navigationTargetBelongsToDepth(0, 1), false);
    assert.equal(navigationTargetBelongsToDepth(null, 0), false);
    const stale = { name: 'stale', rpg: { namedSystemId: 'index_hq' } };
    const live = { name: 'Index Relay K-7', rpg: { namedSystemId: 'index_hq' } };
    const surface = {
        name: 'K-7 Cartography Annex',
        rpg: { namedSystemId: 'index_hq', surfacePoiId: 'index_k7_cartography_outpost' }
    };
    assert.equal(
        findAuthoredNavigationReplacement([surface, live], stale.rpg.namedSystemId),
        live
    );
    assert.equal(findAuthoredNavigationReplacement([live], 'entry_hub'), null);
});

test('locked navigation targets refresh moving positions by stable identity', () => {
    const stalePlanet = {
        id: 'planet-1',
        type: 'planet',
        name: 'Moving world',
        position: { x: 1, y: 2, z: 3 }
    };
    const livePlanet = {
        ...stalePlanet,
        position: { x: 40, y: 50, z: 60 }
    };
    assert.equal(findLiveNavigationReplacement([livePlanet], stalePlanet), livePlanet);

    const staleSurface = {
        type: 'surface outpost signal',
        name: 'Old surface label',
        rpg: { namedSystemId: 'index_hq', surfacePoiId: 'index_k7_black_cache' }
    };
    const liveSurface = {
        type: 'surface outpost',
        name: 'K-7 Black Cache',
        position: { x: 7, y: 8, z: 9 },
        rpg: { namedSystemId: 'index_hq', surfacePoiId: 'index_k7_black_cache' }
    };
    assert.equal(findLiveNavigationReplacement([liveSurface], staleSurface), liveSurface);
    assert.equal(findLiveNavigationReplacement([livePlanet], {
        rpg: { combatTargetId: 'hostile' }
    }), null);
});

test('active-slot reset clears patrol progress and a reopened runtime recovers clean state', () => {
    let harness = createHarness();
    harness.patrol.syncSystem('entry_hub');
    assert.ok(harness.patrol.getState().activeEncounter);
    harness.slots.resetActiveSlot();
    harness = reopen(harness);
    assert.deepEqual(harness.patrol.getState().patrol, createInitialPatrolState());
    assert.equal(harness.patrol.getState().activeEncounter, null);
});

test('patrol persistence rejects corrupt IDs, phases, outcomes, time, and mismatched policy state', () => {
    const harness = createHarness();
    harness.patrol.syncSystem('entry_hub');
    const base = harness.patrol.getState().patrol;
    for (const [mutate, pattern] of [
        [(state) => { state.activeEncounter.agentId = 'forged'; }, /does not match patrol policy/],
        [(state) => { state.activeEncounter.phase = 'attack'; }, /Unknown patrol phase/],
        [(state) => { state.activeEncounter.outcomeId = 'destroyed'; }, /Unknown patrol outcome/],
        [(state) => { state.activeEncounter.spawnedAtGameTime = -1; }, /non-negative finite/],
        [(state) => { state.presenceSystemId = 'index_hq'; }, /must match patrol.presenceSystemId/]
    ]) {
        const dirty = structuredClone(base);
        mutate(dirty);
        assert.throws(() => sanitizePatrolState(dirty), pattern);
    }
});
