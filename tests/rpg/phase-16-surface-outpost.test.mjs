import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
    SURFACE_MISSION_ID,
    SURFACE_OUTPOST_ID,
    SurfaceOutpostRuntime,
    angularSurfaceDistanceMetres,
    createRpgRuntime,
    directionFromLatLon,
    findSurfacePoiForPlanet,
    sanitizeSurfaceState
} from '../../src/rpg/index.js';
import {
    LocalSaveSlots,
    SlotRpgPersistence,
    sanitizeSaveEnvelope
} from '../../src/save/index.js';

class MemoryStorage {
    constructor() { this.values = new Map(); }
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) { this.values.set(key, String(value)); }
    removeItem(key) { this.values.delete(key); }
}

function createHarness() {
    let tick = 0;
    const now = () => new Date(Date.UTC(2026, 5, 27, 16, 0, tick++)).toISOString();
    const slots = new LocalSaveSlots({
        storage: new MemoryStorage(),
        now,
        makeId: () => 'slot-phase16'
    });
    const rpg = createRpgRuntime({
        persistence: new SlotRpgPersistence({ slots, getGameTime: () => 900 }),
        now
    });
    const surface = new SurfaceOutpostRuntime({ slots, rpg, getGameTime: () => 900, now });
    return { now, rpg, slots, surface };
}

function reopen(harness) {
    const rpg = createRpgRuntime({
        persistence: new SlotRpgPersistence({ slots: harness.slots, getGameTime: () => 900 }),
        now: harness.now
    });
    return {
        ...harness,
        rpg,
        surface: new SurfaceOutpostRuntime({
            slots: harness.slots,
            rpg,
            getGameTime: () => 900,
            now: harness.now
        })
    };
}

function scan(harness) {
    return harness.surface.scan(SURFACE_OUTPOST_ID, {
        systemId: 'index_hq',
        planetId: 'index_hq_planet_1'
    });
}

test('Phase 15 v4 fixture migrates to envelope v5/RPG v4 without prior consequence loss', async () => {
    const fixture = JSON.parse(await readFile(
        new URL('../fixtures/phase-15-v4-clean.json', import.meta.url),
        'utf8'
    ));
    const migrated = sanitizeSaveEnvelope(fixture);
    assert.equal(migrated.version, 12);
    assert.equal(migrated.rpg.version, 9);
    assert.equal(migrated.autosave.reason, 'phase-23-v11');
    assert.equal(migrated.ship.credits, 1150);
    assert.equal(migrated.ship.fuel.current, 72);
    assert.equal(migrated.rpg.factions.byId.index.reputation, 0.15);
    assert.equal(migrated.rpg.npcs.byId.crew_quartermaster_lyra.relationship, 0.15);
    assert.equal(migrated.rpg.worldFlags['index_hq.archive_delivery_complete'], true);
    assert.equal(migrated.rpg.surface.byId[SURFACE_OUTPOST_ID].checkpoint, 'undiscovered');
});

test('authored placement selector is deterministic and excludes gas giants and unrelated planets', () => {
    const query = {
        systemId: 'index_hq',
        planetId: 'index_hq_planet_1',
        planetIndex: 0,
        kind: 'terrestrial',
        landable: true
    };
    assert.deepEqual(findSurfacePoiForPlanet(query), findSurfacePoiForPlanet(query));
    assert.equal(findSurfacePoiForPlanet({ ...query, kind: 'gas', landable: false }), null);
    assert.equal(findSurfacePoiForPlanet({ ...query, planetId: 'index_hq_planet_2' }), null);
    assert.equal(findSurfacePoiForPlanet({ ...query, systemId: 'entry_hub' }), null);

    const direction = directionFromLatLon(17, -34);
    assert.ok(Math.abs(Math.hypot(...direction) - 1) < 1e-12);
    assert.equal(angularSurfaceDistanceMetres(direction, direction, 6_000_000), 0);
});

test('scan, orbit, landing, walking, terminal, return, and report round-trip every checkpoint', () => {
    let harness = createHarness();
    scan(harness);
    assert.equal(harness.surface.getState().progress.checkpoint, 'orbit');
    assert.equal(harness.surface.getState().mission.state.status, 'accepted');
    harness = reopen(harness);
    assert.equal(harness.surface.getState().progress.checkpoint, 'orbit');

    harness.surface.syncContext({
        systemId: 'index_hq',
        planetId: 'index_hq_planet_1',
        landed: false,
        withinLandingArea: false,
        playerState: 'piloting'
    });
    assert.ok(harness.surface.getState().progress.visitedAt);
    harness = reopen(harness);
    assert.ok(harness.surface.getState().progress.visitedAt);

    harness.surface.syncContext({
        systemId: 'index_hq',
        planetId: 'index_hq_planet_1',
        landed: true,
        withinLandingArea: true,
        playerState: 'walking'
    });
    assert.equal(harness.surface.getState().progress.checkpoint, 'landed');
    harness = reopen(harness);
    assert.equal(harness.surface.getState().progress.checkpoint, 'landed');

    harness.surface.syncContext({
        systemId: 'index_hq',
        planetId: 'index_hq_planet_1',
        landed: true,
        withinLandingArea: true,
        playerState: 'surface'
    });
    assert.equal(harness.surface.getState().progress.checkpoint, 'walking');
    harness = reopen(harness);
    assert.equal(harness.surface.getState().progress.checkpoint, 'walking');

    harness.surface.interact(SURFACE_OUTPOST_ID, {
        playerState: 'surface',
        distanceMetres: 2
    });
    assert.equal(harness.surface.getState().progress.checkpoint, 'objective_complete');
    harness = reopen(harness);
    assert.equal(harness.surface.getState().progress.checkpoint, 'objective_complete');

    harness.surface.recordBoarded();
    assert.equal(harness.surface.getState().progress.checkpoint, 'returned');
    harness = reopen(harness);
    assert.equal(harness.surface.getState().progress.checkpoint, 'returned');

    harness.surface.report();
    assert.equal(harness.surface.getState().progress.checkpoint, 'completed');
    assert.equal(harness.surface.getState().mission.state.status, 'resolved');
    assert.equal(harness.rpg.getState().worldFlags['index_hq.k7_surface_verification_complete'], true);
    harness = reopen(harness);
    assert.equal(harness.surface.getState().progress.checkpoint, 'completed');
    assert.equal(harness.surface.report().changed, false);
    assert.equal(
        harness.rpg.queryEvents({ missionId: SURFACE_MISSION_ID, type: 'mission.consequence' }).length,
        1
    );
});

test('invalid locations, order, range, and duplicate actions fail descriptively or stay idempotent', () => {
    const harness = createHarness();
    assert.throws(
        () => harness.surface.scan(SURFACE_OUTPOST_ID, {
            systemId: 'entry_hub',
            planetId: 'index_hq_planet_1'
        }),
        /requires index_hq\/index_hq_planet_1/
    );
    assert.throws(() => harness.surface.scan('missing'), /Unknown surface POI ID/);
    assert.throws(() => harness.surface.recordBoarded(), /before the surface terminal objective/);
    assert.throws(() => harness.surface.report(), /requires checkpoint returned/);

    scan(harness);
    assert.equal(scan(harness).changed, false);
    harness.surface.syncContext({
        systemId: 'index_hq',
        planetId: 'index_hq_planet_1',
        landed: true,
        withinLandingArea: false,
        playerState: 'walking'
    });
    assert.equal(harness.surface.getState().progress.checkpoint, 'orbit');
    assert.throws(
        () => harness.surface.interact(SURFACE_OUTPOST_ID, {
            playerState: 'surface',
            distanceMetres: 20
        }),
        /out of range/
    );
});

test('surface state sanitizes timestamps and rejects unknown stable IDs', () => {
    const base = {
        byId: {
            [SURFACE_OUTPOST_ID]: {
                id: SURFACE_OUTPOST_ID,
                checkpoint: 'walking',
                discoveredAt: '2026-06-27T16:00:00.000Z',
                visitedAt: null,
                landedAt: null,
                interactedAt: null,
                returnedAt: null,
                completedAt: null
            }
        }
    };
    assert.equal(sanitizeSurfaceState(base).byId[SURFACE_OUTPOST_ID].checkpoint, 'walking');
    assert.throws(
        () => sanitizeSurfaceState({ byId: { ...base.byId, unknown: { id: 'unknown' } } }),
        /Unknown saved surface POI ID/
    );
    const badTime = structuredClone(base);
    badTime.byId[SURFACE_OUTPOST_ID].discoveredAt = 'not-a-time';
    assert.throws(() => sanitizeSurfaceState(badTime), /must be an ISO timestamp/);
});
