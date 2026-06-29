import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    BOARDING_DERELICT_ID,
    BOARDING_ENCOUNTER_ID,
    BOARDING_LIMITS,
    BOARDING_LOG_ID,
    BOARDING_MISSION_ID,
    BOARDING_SYSTEM_ID,
    EvaBoardingRuntime,
    advanceEvaMotion,
    createRpgRuntime,
    evaluateBoardingSecureGate,
    findBoardingPoiForSystem,
    sanitizeBoardingState
} from '../../src/rpg/index.js';
import {
    LocalSaveSlots,
    SlotRpgPersistence,
    createSaveEnvelope,
    sanitizeSaveEnvelope
} from '../../src/save/index.js';
import {
    createInitialPlayerState,
    sanitizePlayerState
} from '../../src/player/playerState.js';

class MemoryStorage {
    constructor() {
        this.values = new Map();
        this.failWrites = false;
    }
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) {
        if (this.failWrites) throw new Error('phase21 storage unavailable');
        this.values.set(key, String(value));
    }
    removeItem(key) { this.values.delete(key); }
}

function createHarness({ gameTime = 100, storage = new MemoryStorage() } = {}) {
    let time = gameTime;
    let tick = 0;
    const now = () => new Date(Date.UTC(2026, 5, 27, 23, 0, tick++)).toISOString();
    const slots = new LocalSaveSlots({
        storage,
        now,
        makeId: () => 'slot-phase21'
    });
    const getGameTime = () => time;
    const rpg = createRpgRuntime({
        persistence: new SlotRpgPersistence({ slots, getGameTime }),
        now
    });
    rpg.setActiveNamedSystem(BOARDING_SYSTEM_ID);
    const boarding = new EvaBoardingRuntime({ slots, rpg, getGameTime, now });
    boarding.syncSystem(BOARDING_SYSTEM_ID);
    return {
        slots,
        storage,
        rpg,
        boarding,
        now,
        getGameTime,
        setGameTime(value) { time = value; }
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
    rpg.setActiveNamedSystem(BOARDING_SYSTEM_ID);
    const boarding = new EvaBoardingRuntime({
        slots: harness.slots,
        rpg,
        getGameTime: harness.getGameTime,
        now: harness.now
    });
    boarding.syncSystem(BOARDING_SYSTEM_ID);
    return { ...harness, rpg, boarding };
}

function playerAt(harness, location, overrides = {}) {
    const frames = { ship: 'ship-local', eva: 'boarding-local', derelict: 'derelict-local' };
    return {
        version: 1,
        location,
        referenceFrame: frames[location],
        encounterId: location === 'ship' ? null : BOARDING_ENCOUNTER_ID,
        position: [0, 0, 0],
        velocity: [0, 0, 0],
        yaw: 0,
        pitch: 0,
        oxygenRemaining: BOARDING_LIMITS.oxygenSeconds,
        oxygenUpdatedAtGameTime: harness.getGameTime(),
        ...overrides
    };
}

function discover(harness) {
    return harness.boarding.discover(BOARDING_DERELICT_ID, {
        systemId: BOARDING_SYSTEM_ID
    });
}

function depart(harness) {
    return harness.boarding.depart(playerAt(harness, 'eva'), {
        systemId: BOARDING_SYSTEM_ID,
        distanceMetres: 70,
        speedMetresPerSecond: 1
    });
}

function enter(harness) {
    return harness.boarding.enterDerelict(playerAt(harness, 'derelict'), {
        distanceMetres: 2
    });
}

function recoverLog(harness) {
    return harness.boarding.recoverLog(
        playerAt(harness, 'derelict'),
        BOARDING_LOG_ID,
        { distanceMetres: 1 }
    );
}

test('Phase 20 v9 fixture migrates to envelope v10/RPG v8/player v1 without prior-state loss', async () => {
    const fixture = JSON.parse(await readFile(
        new URL('../fixtures/phase-20-v9-clean.json', import.meta.url),
        'utf8'
    ));
    const migrated = sanitizeSaveEnvelope(fixture);
    assert.equal(migrated.version, 13);
    assert.equal(migrated.rpg.version, 10);
    assert.equal(migrated.player.version, 1);
    assert.equal(migrated.player.location, 'ship');
    assert.equal(migrated.player.oxygenUpdatedAtGameTime, 321);
    assert.equal(migrated.autosave.reason, 'phase-24-v12');
    assert.equal(migrated.ship.credits, 2345);
    assert.equal(migrated.simulation.economy.markets.byId.wayfarer_exchange.goods.field_rations.stock, 17);
    assert.equal(migrated.rpg.worldFlags['phase20.fixture-preserved'], true);
    assert.equal(migrated.rpg.boarding.byId[BOARDING_DERELICT_ID].checkpoint, 'undiscovered');
});

test('Wayfarer placement, secure gates, and EVA integration are deterministic and bounded', () => {
    assert.deepEqual(findBoardingPoiForSystem(BOARDING_SYSTEM_ID), findBoardingPoiForSystem(BOARDING_SYSTEM_ID));
    assert.equal(findBoardingPoiForSystem('index_hq'), null);
    assert.equal(evaluateBoardingSecureGate({
        systemId: BOARDING_SYSTEM_ID,
        distanceMetres: 75,
        speedMetresPerSecond: 1.5
    }).allowed, true);
    assert.match(evaluateBoardingSecureGate({
        systemId: BOARDING_SYSTEM_ID,
        distanceMetres: 76,
        speedMetresPerSecond: 0
    }).reason, /out of secure range/);
    assert.match(evaluateBoardingSecureGate({
        systemId: BOARDING_SYSTEM_ID,
        distanceMetres: 20,
        speedMetresPerSecond: 1.6
    }).reason, /too high to secure/);

    let state = { position: [0, 0, 0], velocity: [0, 0, 0] };
    for (let i = 0; i < 600; i += 1) state = advanceEvaMotion(state, [0, 0, -1], 1 / 60);
    assert.ok(Math.hypot(...state.velocity) <= BOARDING_LIMITS.evaMaxSpeed + 1e-12);
    assert.ok(state.position.every(Number.isFinite));
    for (let i = 0; i < 180; i += 1) state = advanceEvaMotion(state, [0, 0, 0], 1 / 60);
    assert.ok(Math.hypot(...state.velocity) < 1e-9);
});

test('outside, inside, returning, and completed checkpoints round-trip with exact-once log recovery', () => {
    let harness = createHarness();
    discover(harness);
    assert.equal(harness.boarding.getState().progress.checkpoint, 'approach');
    assert.equal(harness.boarding.getState().mission.state.status, 'accepted');

    depart(harness);
    assert.equal(harness.slots.getActiveEnvelope().player.location, 'eva');
    harness = reopen(harness);
    assert.equal(harness.boarding.getState().progress.checkpoint, 'outside');

    enter(harness);
    harness = reopen(harness);
    assert.equal(harness.boarding.getState().progress.checkpoint, 'inside');
    assert.equal(harness.slots.getActiveEnvelope().player.location, 'derelict');

    recoverLog(harness);
    assert.equal(harness.boarding.getState().progress.checkpoint, 'objective_complete');
    assert.equal(recoverLog(harness).changed, false);
    assert.equal(harness.rpg.queryEvents({ type: 'boarding.log.recovered' }).length, 1);

    harness.boarding.exitDerelict(playerAt(harness, 'eva'), { distanceMetres: 1 });
    harness = reopen(harness);
    assert.equal(harness.boarding.getState().progress.checkpoint, 'returning');
    assert.equal(harness.slots.getActiveEnvelope().player.location, 'eva');

    harness.boarding.boardShip(playerAt(harness, 'ship'));
    harness = reopen(harness);
    assert.equal(harness.boarding.getState().progress.checkpoint, 'completed');
    assert.equal(harness.boarding.getState().mission.state.status, 'resolved');
    assert.equal(harness.slots.getActiveEnvelope().player.location, 'ship');
    assert.equal(harness.rpg.queryEvents({ type: 'mission.consequence', missionId: BOARDING_MISSION_ID }).length, 1);
    assert.equal(harness.rpg.getState().worldFlags['drifter_convergence.wayfarer_derelict_log_recovered'], true);
    assert.equal(harness.boarding.boardShip(playerAt(harness, 'ship')).changed, false);
});

test('explicit recovery is retryable before the log and completes after exact-once recovery', () => {
    let harness = createHarness();
    discover(harness);
    depart(harness);
    const first = harness.boarding.recover('explicit', playerAt(harness, 'ship'));
    assert.equal(first.completed, false);
    assert.equal(harness.boarding.getState().progress.checkpoint, 'approach');
    assert.equal(harness.boarding.getState().progress.recoveryCount, 1);

    depart(harness);
    enter(harness);
    recoverLog(harness);
    const second = harness.boarding.recover('explicit', playerAt(harness, 'ship'));
    assert.equal(second.completed, true);
    harness = reopen(harness);
    assert.equal(harness.boarding.getState().progress.checkpoint, 'completed');
    assert.equal(harness.rpg.queryEvents({ type: 'boarding.log.recovered' }).length, 1);
    assert.equal(harness.rpg.queryEvents({ type: 'mission.resolved', missionId: BOARDING_MISSION_ID }).length, 1);
});

test('oxygen and hard range recover from active play without offline catch-up or damage', () => {
    const harness = createHarness();
    discover(harness);
    depart(harness);
    const beforeShip = harness.slots.getActiveEnvelope().ship;
    harness.setGameTime(279);
    const safe = harness.boarding.updatePlayer(playerAt(harness, 'eva', {
        oxygenUpdatedAtGameTime: 100
    }), {
        gameTime: 279,
        distanceFromShip: 100
    });
    assert.equal(safe.recovered, false);
    assert.equal(safe.state.player.oxygenRemaining, 1);

    harness.setGameTime(280);
    const depleted = harness.boarding.updatePlayer(safe.state.player, {
        gameTime: 280,
        distanceFromShip: 100
    });
    assert.equal(depleted.recovered, true);
    assert.equal(harness.boarding.getState().progress.checkpoint, 'approach');
    assert.deepEqual(harness.slots.getActiveEnvelope().ship, beforeShip);

    depart(harness);
    const ranged = harness.boarding.updatePlayer(playerAt(harness, 'eva'), {
        gameTime: 280,
        distanceFromShip: 151
    });
    assert.equal(ranged.recovered, true);
    assert.equal(harness.boarding.getState().progress.lastRecoveryReason, 'range-exceeded');
});

test('illegal order, IDs, range, speed, and duplicate actions fail descriptively without partial saves', () => {
    const harness = createHarness();
    assert.throws(() => harness.boarding.discover('missing'), /Unknown boarding derelict ID/);
    assert.throws(() => harness.boarding.discover(BOARDING_DERELICT_ID, {
        systemId: 'index_hq'
    }), /requires authored system/);
    discover(harness);
    const before = harness.slots.getActiveEnvelope();
    assert.throws(() => harness.boarding.depart(playerAt(harness, 'eva'), {
        systemId: BOARDING_SYSTEM_ID,
        distanceMetres: 80,
        speedMetresPerSecond: 0
    }), /out of secure range/);
    assert.deepEqual(harness.slots.getActiveEnvelope(), before);
    assert.throws(() => harness.boarding.enterDerelict(playerAt(harness, 'derelict'), {
        distanceMetres: 1
    }), /requires checkpoint outside/);
    depart(harness);
    assert.throws(() => harness.boarding.enterDerelict(playerAt(harness, 'derelict'), {
        distanceMetres: 3
    }), /out of range/);
    assert.throws(() => harness.boarding.recoverLog(
        playerAt(harness, 'derelict'),
        'forged-log',
        { distanceMetres: 1 }
    ), /Unknown boarding log ID/);
});

test('player and boarding persistence sanitize bounds and reject corrupt cross-domain frames', () => {
    const cleanPlayer = createInitialPlayerState(10);
    assert.equal(sanitizePlayerState(cleanPlayer, { gameTime: 10 }).location, 'ship');
    const fast = {
        ...cleanPlayer,
        location: 'eva',
        referenceFrame: 'boarding-local',
        encounterId: BOARDING_ENCOUNTER_ID,
        position: [1000, 0, 0],
        velocity: [1000, 0, 0]
    };
    const bounded = sanitizePlayerState(fast, { gameTime: 10 });
    assert.equal(Math.hypot(...bounded.position), BOARDING_LIMITS.recoveryRangeMetres);
    assert.equal(Math.hypot(...bounded.velocity), BOARDING_LIMITS.evaMaxSpeed);
    assert.throws(
        () => sanitizePlayerState({ ...cleanPlayer, location: 'eva' }, { gameTime: 10 }),
        /requires reference frame boarding-local/
    );

    const envelope = createSaveEnvelope({
        slotId: 'slot-phase21-corrupt',
        now: '2026-06-27T00:00:00.000Z',
        gameTime: 10
    });
    envelope.player = fast;
    assert.throws(() => sanitizeSaveEnvelope(envelope), /conflicts with checkpoint undiscovered/);

    const boarding = createHarness().rpg.getState().boarding;
    boarding.byId.forged = { id: 'forged' };
    assert.throws(() => sanitizeBoardingState(boarding), /Unknown saved boarding derelict ID/);
});

test('active-slot reset removes Phase 21 progress while preserving a valid aboard player', () => {
    let harness = createHarness();
    discover(harness);
    depart(harness);
    harness.slots.resetActiveSlot();
    harness = reopen(harness);
    assert.equal(harness.boarding.getState().progress.checkpoint, 'undiscovered');
    assert.equal(harness.slots.getActiveEnvelope().player.location, 'ship');
    assert.equal(harness.slots.getActiveEnvelope().version, 13);
});

test('storage failure stays visible while the authoritative in-memory EVA checkpoint remains usable', () => {
    const harness = createHarness();
    discover(harness);
    harness.storage.failWrites = true;
    assert.doesNotThrow(() => depart(harness));
    assert.equal(harness.boarding.getState().progress.checkpoint, 'outside');
    assert.equal(harness.boarding.getState().player.location, 'eva');
    assert.match(harness.slots.getStatus().lastError.message, /phase21 storage unavailable/);
});
