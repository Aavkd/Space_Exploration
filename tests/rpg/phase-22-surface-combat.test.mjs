import assert from 'node:assert/strict';
import test from 'node:test';

import {
    SURFACE_COMBAT_ENCOUNTER_ID,
    SURFACE_COMBAT_MISSION_ID,
    SURFACE_COMBAT_SITE_ID,
    SURFACE_COMBAT_SYSTEM_ID,
    SurfaceCombatRuntime,
    createRpgRuntime,
    findSurfacePoiForPlanet,
    findSurfacePoisForPlanet,
    isSurfaceCombatLineClear,
    sanitizeSurfaceCombatState,
    segmentIntersectsAabb,
    selectSurfaceCombatSpawn
} from '../../src/rpg/index.js';
import {
    LocalSaveSlots,
    SlotRpgPersistence,
    createSaveEnvelope,
    sanitizeSaveEnvelope
} from '../../src/save/index.js';
import {
    SURFACE_COMBAT_GAMEPAD_FIRE_BUTTON,
    canEquipSurfaceWeaponInPlayerState,
    canToggleCombatModeInPlayerState
} from '../../src/input/combatModeInput.js';

class MemoryStorage {
    constructor() {
        this.values = new Map();
        this.failWrites = false;
    }
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) {
        if (this.failWrites) throw new Error('phase22 storage unavailable');
        this.values.set(key, String(value));
    }
    removeItem(key) { this.values.delete(key); }
}

function createHarness({ gameTime = 200, storage = new MemoryStorage() } = {}) {
    let time = gameTime;
    let tick = 0;
    const now = () => new Date(Date.UTC(2026, 5, 28, 0, 0, tick++)).toISOString();
    const slots = new LocalSaveSlots({
        storage,
        now,
        makeId: () => 'slot-phase22'
    });
    const getGameTime = () => time;
    const rpg = createRpgRuntime({
        persistence: new SlotRpgPersistence({ slots, getGameTime }),
        now
    });
    rpg.setActiveNamedSystem(SURFACE_COMBAT_SYSTEM_ID);
    const combat = new SurfaceCombatRuntime({ slots, rpg, getGameTime, now });
    return {
        slots,
        storage,
        rpg,
        combat,
        getGameTime,
        now,
        setGameTime(value) { time = value; }
    };
}

function world({ lineClear = () => true } = {}) {
    return {
        id: SURFACE_COMBAT_SITE_ID,
        objectivePosition: [0, 0, 30],
        landingPoint: [0, 0, -20],
        structures: [],
        spawnCandidates: [
            { id: 'spawn-a', position: [0, 2, 20], radius: 1.2 },
            { id: 'spawn-b', position: [10, 2, 20], radius: 1.2 }
        ],
        patrolPoints: [[-6, 2, 20], [6, 2, 20]],
        terrainClear: () => true,
        lineClear
    };
}

test('combat mode input is available while piloting, aboard, or in EVA', () => {
    assert.equal(canToggleCombatModeInPlayerState('piloting'), true);
    assert.equal(canToggleCombatModeInPlayerState('walking'), true);
    assert.equal(canToggleCombatModeInPlayerState('eva'), true);
    assert.equal(canToggleCombatModeInPlayerState('surface'), true);
    assert.equal(canToggleCombatModeInPlayerState('derelict-interior'), false);
    assert.equal(canToggleCombatModeInPlayerState('invalid-state'), false);
});

test('surface combat uses R2 without changing the separate ship-combat binding', () => {
    assert.equal(SURFACE_COMBAT_GAMEPAD_FIRE_BUTTON, 'r2');
});

test('armed on-foot states equip the surface weapon without enabling boarding combat', () => {
    assert.equal(canEquipSurfaceWeaponInPlayerState('walking'), true);
    assert.equal(canEquipSurfaceWeaponInPlayerState('eva'), true);
    assert.equal(canEquipSurfaceWeaponInPlayerState('surface'), true);
    assert.equal(canEquipSurfaceWeaponInPlayerState('piloting'), false);
    assert.equal(canEquipSurfaceWeaponInPlayerState('derelict-interior'), false);
});

test('on-foot dry fire remains transient outside a hostile encounter', () => {
    const harness = createHarness();
    const result = harness.combat.fire({
        origin: [1, 2, 3],
        direction: [0, 0, -1],
        visualOrigin: [1.2, 1.8, 2.8]
    });

    assert.equal(result.hit, false);
    assert.deepEqual(result.state.shotEffects[0].start, [1.2, 1.8, 2.8]);
    assert.deepEqual(result.state.shotEffects[0].end, [1, 2, -67]);
    assert.equal(result.state.active, false);
    assert.equal(result.state.saved.enemy.integrity, 100);
});

function start(harness, adapter = world()) {
    harness.combat.scan({
        siteId: SURFACE_COMBAT_SITE_ID,
        systemId: SURFACE_COMBAT_SYSTEM_ID,
        planetId: 'index_hq_planet_1'
    });
    return harness.combat.syncContext({
        systemId: SURFACE_COMBAT_SYSTEM_ID,
        planetId: 'index_hq_planet_1',
        siteId: SURFACE_COMBAT_SITE_ID,
        playerState: 'surface',
        landed: true,
        withinLandingArea: true,
        playerPosition: [0, 2, 0],
        shipPosition: [0, 0, -20],
        placement: adapter
    });
}

function reopen(harness) {
    const rpg = createRpgRuntime({
        persistence: new SlotRpgPersistence({
            slots: harness.slots,
            getGameTime: harness.getGameTime
        }),
        now: harness.now
    });
    rpg.setActiveNamedSystem(SURFACE_COMBAT_SYSTEM_ID);
    return {
        ...harness,
        rpg,
        combat: new SurfaceCombatRuntime({
            slots: harness.slots,
            rpg,
            getGameTime: harness.getGameTime,
            now: harness.now
        })
    };
}

test('Phase 21 v10/RPG v8 save migrates to v11/RPG v9 with clean Phase 22 state', () => {
    const previous = createSaveEnvelope({
        slotId: 'slot-phase22-migration',
        slotName: 'Phase 21 Fixture',
        now: '2026-06-27T23:59:00.000Z'
    });
    previous.version = 10;
    previous.rpg.version = 8;
    previous.rpg.worldFlags['phase21.fixture-preserved'] = true;
    delete previous.rpg.surfaceCombat;
    const migrated = sanitizeSaveEnvelope(previous);
    assert.equal(migrated.version, 13);
    assert.equal(migrated.rpg.version, 10);
    assert.equal(migrated.rpg.worldFlags['phase21.fixture-preserved'], true);
    assert.equal(
        migrated.rpg.surfaceCombat.byId[SURFACE_COMBAT_ENCOUNTER_ID].checkpoint,
        'undiscovered'
    );
});

test('K-7 exposes both deterministic surface POIs and excludes invalid planets', () => {
    const query = {
        systemId: 'index_hq',
        planetId: 'index_hq_planet_1',
        planetIndex: 0,
        kind: 'terrestrial',
        landable: true
    };
    const first = findSurfacePoiForPlanet(query);
    const all = findSurfacePoisForPlanet(query);
    assert.equal(first.id, 'index_k7_cartography_outpost');
    assert.deepEqual(all.map((entry) => entry.id), [
        'index_k7_cartography_outpost',
        SURFACE_COMBAT_SITE_ID
    ]);
    assert.deepEqual(findSurfacePoisForPlanet({ ...query, kind: 'gas' }), []);
    assert.deepEqual(findSurfacePoisForPlanet({ ...query, planetId: 'wrong' }), []);
});

test('spawn selection and cover LOS reject terrain, structures, player, and ship', () => {
    const box = { id: 'cover', min: [-2, 0, 8], max: [2, 4, 12] };
    assert.equal(segmentIntersectsAabb([0, 2, 0], [0, 2, 20], box), true);
    assert.equal(isSurfaceCombatLineClear({
        start: [0, 2, 0],
        end: [0, 2, 20],
        structures: [box]
    }), false);
    assert.equal(isSurfaceCombatLineClear({
        start: [5, 2, 0],
        end: [5, 2, 20],
        structures: [box],
        terrainBlocked: () => true
    }), false);
    const selected = selectSurfaceCombatSpawn({
        candidates: [
            { id: 'terrain', position: [0, 0, 0], radius: 1 },
            { id: 'structure', position: [0, 2, 10], radius: 1 },
            { id: 'player', position: [5, 2, 0], radius: 1 },
            { id: 'ship', position: [40, 2, 0], radius: 1 },
            { id: 'safe', position: [80, 2, 0], radius: 1 }
        ],
        structures: [box],
        playerPosition: [5, 2, 0],
        shipPosition: [40, 2, 0],
        terrainClear: (position) => position[0] !== 0 || position[2] !== 0
    });
    assert.equal(selected.id, 'safe');
    assert.throws(() => selectSurfaceCombatSpawn({
        candidates: [{ id: 'bad', position: [0, 0, 0], radius: 1 }],
        terrainClear: () => false
    }), /No terrain\/structure\/player\/ship-safe/);
});

test('authored evasion recovers the objective and pays exactly once after safe return', () => {
    const harness = createHarness();
    start(harness);
    const recovered = harness.combat.recoverObjective({ playerPosition: [0, 0, 30] });
    assert.equal(recovered.route, 'evaded');
    assert.equal(recovered.state.saved.enemy.disposition, 'bypassed');
    const creditsBefore = harness.slots.getActiveEnvelope().ship.credits;
    const completed = harness.combat.recordBoarded();
    assert.equal(completed.route, 'evaded');
    assert.equal(harness.slots.getActiveEnvelope().ship.credits, creditsBefore + 600);
    assert.equal(harness.combat.recordBoarded().changed, false);
    assert.equal(harness.slots.getActiveEnvelope().ship.credits, creditsBefore + 600);
    const restored = reopen(harness);
    assert.equal(restored.combat.getState().saved.checkpoint, 'completed');
    assert.equal(restored.rpg.getMission(SURFACE_COMBAT_MISSION_ID).state.outcomeId, 'evaded');
});

test('approach, active, objective, completion, and reset checkpoints round-trip coherently', () => {
    let harness = createHarness();
    harness.combat.scan({
        siteId: SURFACE_COMBAT_SITE_ID,
        systemId: SURFACE_COMBAT_SYSTEM_ID,
        planetId: 'index_hq_planet_1'
    });
    harness = reopen(harness);
    assert.equal(harness.combat.getState().saved.checkpoint, 'approach');
    start(harness);
    harness = reopen(harness);
    assert.equal(harness.combat.getState().saved.checkpoint, 'active');
    harness.combat.syncContext({
        systemId: SURFACE_COMBAT_SYSTEM_ID,
        planetId: 'index_hq_planet_1',
        siteId: SURFACE_COMBAT_SITE_ID,
        playerState: 'surface',
        landed: true,
        withinLandingArea: true,
        playerPosition: [0, 2, 0],
        shipPosition: [0, 0, -20],
        placement: world()
    });
    harness.combat.recoverObjective({ playerPosition: [0, 0, 30] });
    harness = reopen(harness);
    assert.equal(harness.combat.getState().saved.checkpoint, 'objective_recovered');
    harness.combat.recordBoarded();
    harness = reopen(harness);
    assert.equal(harness.combat.getState().saved.checkpoint, 'completed');
    harness.slots.resetActiveSlot();
    harness = reopen(harness);
    assert.equal(harness.combat.getState().saved.checkpoint, 'undiscovered');
    assert.equal(harness.rpg.getMission(SURFACE_COMBAT_MISSION_ID).state.status, 'unavailable');
});

test('four deterministic carbine hits resolve combat before the same exact reward', () => {
    const harness = createHarness();
    start(harness);
    for (let shot = 0; shot < 4; shot += 1) {
        const result = harness.combat.fire({ origin: [0, 2, 0], direction: [0, 0, 1] });
        assert.equal(result.hit, true);
        for (let frame = 0; frame < 15; frame += 1) {
            harness.combat.update(1 / 60, { playerPosition: [0, 2, 0] });
        }
    }
    assert.equal(harness.combat.getState().saved.enemy.disposition, 'destroyed');
    assert.equal(harness.combat.recoverObjective({ playerPosition: [0, 0, 30] }).route, 'combat_resolved');
    const creditsBefore = harness.slots.getActiveEnvelope().ship.credits;
    harness.combat.recordBoarded();
    assert.equal(harness.slots.getActiveEnvelope().ship.credits, creditsBefore + 600);
    assert.equal(harness.rpg.getMission(SURFACE_COMBAT_MISSION_ID).state.outcomeId, 'combat_resolved');
});

test('surface hits remain crosshair-authoritative while the visual beam starts at the muzzle', () => {
    const harness = createHarness();
    start(harness);
    const result = harness.combat.fire({
        origin: [0, 2, 0],
        direction: [0, 0, 1],
        visualOrigin: [0.3, 1.7, 0.5]
    });
    assert.equal(result.hit, true);
    assert.deepEqual(result.state.shotEffects.at(-1).start, [0.3, 1.7, 0.5]);
    assert.deepEqual(result.state.shotEffects.at(-1).end, result.state.enemy.position);
});

test('cover blocks both player hits and enemy fire while fixed-step feedback stays bounded', () => {
    const harness = createHarness();
    start(harness, world({ lineClear: () => false }));
    assert.equal(
        harness.combat.fire({ origin: [0, 2, 0], direction: [0, 0, 1] }).hit,
        false
    );
    for (let index = 0; index < 1200; index += 1) {
        harness.combat.update(1 / 60, { playerPosition: [0, 2, 0] });
    }
    const state = harness.combat.getState();
    assert.equal(state.saved.suitIntegrity, 100);
    assert.ok(state.feedback.length <= 24);
    assert.ok(state.shotEffects.length <= 16);
    assert.ok(state.performance.samples > 0);
});

test('120-second deterministic performance scene stays bounded and under the CPU budget', () => {
    const harness = createHarness();
    start(harness, world({ lineClear: () => false }));
    for (let frame = 0; frame < 7200; frame += 1) {
        harness.combat.update(1 / 60, { playerPosition: [0, 2, 0] });
    }
    const performance = harness.combat.getPerformance();
    assert.equal(performance.liveEnemies, 1);
    assert.ok(performance.liveShotEffects <= 16);
    assert.ok(performance.averageMs <= 1, `average ${performance.averageMs} ms`);
    assert.ok(performance.p95Ms <= 2, `p95 ${performance.p95Ms} ms`);
});

test('defeat recovers aboard state, grants nothing, and preserves retryable mission progress', () => {
    const harness = createHarness();
    const startingCredits = harness.slots.getActiveEnvelope().ship.credits;
    start(harness);
    for (let index = 0; index < 1200 && harness.combat.getState().saved.lastOutcome !== 'defeat'; index += 1) {
        harness.combat.update(1 / 60, { playerPosition: [0, 2, 0] });
    }
    const state = harness.combat.getState();
    assert.equal(state.saved.lastOutcome, 'defeat');
    assert.equal(state.saved.checkpoint, 'approach');
    assert.equal(state.saved.suitIntegrity, 100);
    assert.equal(state.saved.enemy.disposition, 'available');
    assert.equal(state.saved.attempts.at(-1).outcome, 'defeat');
    assert.equal(harness.combat.consumeRecoveryRequest(), true);
    assert.equal(harness.combat.consumeRecoveryRequest(), false);
    assert.equal(harness.slots.getActiveEnvelope().ship.credits, startingCredits);
    assert.equal(harness.rpg.getMission(SURFACE_COMBAT_MISSION_ID).state.status, 'accepted');
});

test('surface-combat persistence rejects corrupt IDs, outcomes, invariants, and non-finite state', () => {
    const harness = createHarness();
    const clean = harness.rpg.getState().surfaceCombat;
    const unknown = structuredClone(clean);
    unknown.byId.bad = unknown.byId[SURFACE_COMBAT_ENCOUNTER_ID];
    assert.throws(() => sanitizeSurfaceCombatState(unknown), /Unknown saved surface-combat encounter ID/);
    const corrupt = structuredClone(clean);
    corrupt.byId[SURFACE_COMBAT_ENCOUNTER_ID].enemy.integrity = Number.NaN;
    assert.throws(() => sanitizeSurfaceCombatState(corrupt), /must be finite/);
    const forged = structuredClone(clean);
    forged.byId[SURFACE_COMBAT_ENCOUNTER_ID].reward.claimed = true;
    forged.byId[SURFACE_COMBAT_ENCOUNTER_ID].reward.claimedAtGameTime = 2;
    assert.throws(() => sanitizeSurfaceCombatState(forged), /requires a completed recovered objective/);
});

test('storage failure remains visible while in-memory defeat/recovery state stays authoritative', () => {
    const harness = createHarness();
    start(harness);
    harness.storage.failWrites = true;
    assert.doesNotThrow(() => harness.combat.recoverFromDefeat());
    assert.match(harness.slots.getStatus().lastError.message, /phase22 storage unavailable/);
    assert.equal(harness.combat.getState().saved.lastOutcome, 'defeat');
});
