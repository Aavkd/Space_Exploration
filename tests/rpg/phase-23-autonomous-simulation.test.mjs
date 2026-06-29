import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
    AGENDAS,
    LOD_TIERS,
    MAX_EMBODIED_ENTITIES,
    MAX_SIMULATED_AGENTS,
    MAX_WORLD_EVENT_LOG,
    WORLD_FACTION_IDS,
    WORLD_SEED,
    WORLD_TICK_SECONDS,
    WorldRuntime,
    advanceWorld,
    compactWorldEvents,
    createInitialWorldState,
    enforceEmbodiedBudget,
    enforceSimulatedBudget,
    foldAgents,
    getWorldTerritory,
    materializeAgents,
    sanitizeWorldState,
    setEntityLod,
    simStep,
    EconomyRuntime,
    createRpgRuntime,
    queryFactionInfluence
} from '../../src/rpg/index.js';
import {
    LocalSaveSlots,
    SlotRpgPersistence,
    createSaveEnvelope,
    sanitizeSaveEnvelope
} from '../../src/save/index.js';

class MemoryStorage {
    constructor() {
        this.values = new Map();
        this.failNextWrite = false;
    }
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) {
        if (this.failNextWrite) {
            this.failNextWrite = false;
            throw new Error('simulated interrupted transaction');
        }
        this.values.set(key, String(value));
    }
    removeItem(key) { this.values.delete(key); }
}

function createHarness({ storage = new MemoryStorage(), gameTime = 0 } = {}) {
    let time = gameTime;
    let stamp = 0;
    const now = () => new Date(Date.UTC(2026, 5, 29, 12, 0, stamp++)).toISOString();
    const slots = new LocalSaveSlots({ storage, now, makeId: () => 'slot-phase23' });
    const getGameTime = () => time;
    const rpg = createRpgRuntime({
        persistence: new SlotRpgPersistence({ slots, getGameTime }),
        now
    });
    return {
        storage,
        slots,
        rpg,
        now,
        getGameTime,
        setGameTime: (value) => { time = value; },
        world: new WorldRuntime({ slots, getGameTime }),
        economy: new EconomyRuntime({ slots, getGameTime })
    };
}

function reopen(harness, { newSlotManager = false } = {}) {
    const slots = newSlotManager
        ? new LocalSaveSlots({ storage: harness.storage, now: harness.now, makeId: () => 'slot-unused' })
        : harness.slots;
    return {
        ...harness,
        slots,
        world: new WorldRuntime({ slots, getGameTime: harness.getGameTime }),
        economy: new EconomyRuntime({ slots, getGameTime: harness.getGameTime })
    };
}

const fixturePath = (name) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

// --- T1 Domain ---------------------------------------------------------------

test('the simulation core imports no renderer, DOM, audio, or three module', () => {
    const source = readFileSync(fileURLToPath(new URL('../../src/rpg/simWorld.js', import.meta.url)), 'utf8');
    for (const forbidden of [/from\s+['"]three['"]/, /\bdocument\./, /\bwindow\./, /\bTHREE\./, /new\s+THREE\b/, /AudioContext/]) {
        assert.ok(!forbidden.test(source), `simWorld.js must not reference ${forbidden}`);
    }
});

test('simStep is a pure function of (seed, state, commands, span)', () => {
    const initial = createInitialWorldState(0);
    const commands = [{ id: 'c1', type: 'incite_conflict', a: 'commonwealth', b: 'drifters', gameTime: 120 }];
    const args = { state: initial, fromGameTime: 0, toGameTime: 50 * WORLD_TICK_SECONDS, seed: WORLD_SEED, commands };
    const first = simStep(args);
    const second = simStep(args);
    assert.deepEqual(first.state, second.state, `world seed: ${WORLD_SEED}`);
    assert.deepEqual(first.events, second.events);
    // fromGameTime must equal the state's last tick boundary.
    assert.throws(() => simStep({ ...args, fromGameTime: 30 }), /must equal state\.lastTickGameTime/);
    assert.throws(() => simStep({ ...args, seed: 'wrong' }), /seed mismatch/);
});

test('three factions behave distinctly from their authored drive seeds alone', () => {
    const initial = createInitialWorldState(0);
    assert.deepEqual(WORLD_FACTION_IDS, ['commonwealth', 'index', 'drifters']);
    assert.equal(initial.factions.byId.commonwealth.agenda, 'expanding');
    assert.equal(initial.factions.byId.index.agenda, 'trading');
    assert.equal(initial.factions.byId.drifters.agenda, 'consolidating');
    for (const agenda of Object.values(initial.factions.byId).map((f) => f.agenda)) {
        assert.ok(AGENDAS.includes(agenda));
    }

    // Over a long quiet run, wealth trajectories diverge per accumulation drive.
    const advanced = advanceWorld(initial, 5000 * WORLD_TICK_SECONDS).world;
    const wealth = Object.fromEntries(
        WORLD_FACTION_IDS.map((id) => [id, advanced.factions.byId[id].aggregates.wealth])
    );
    assert.ok(wealth.index > wealth.commonwealth, 'index accumulates more than commonwealth');
    assert.ok(wealth.commonwealth > wealth.drifters, 'commonwealth accumulates more than drifters');
});

test('relationship attitudes stay bounded and band crossings emit traceable events', () => {
    const initial = createInitialWorldState(0);
    const commands = [{ id: 'c1', type: 'incite_conflict', a: 'index', b: 'drifters', gameTime: 0 }];
    const { state, events } = simStep({
        state: initial,
        fromGameTime: 0,
        toGameTime: 200 * WORLD_TICK_SECONDS,
        seed: WORLD_SEED,
        commands
    });
    for (const pair of Object.values(state.relationships.pairs)) {
        assert.ok(pair.attitude >= -1 && pair.attitude <= 1);
    }
    const relEvents = events.filter((e) => e.type === 'relationship.changed'
        && e.subjectIds.includes('index') && e.subjectIds.includes('drifters'));
    assert.ok(relEvents.length >= 1, 'a relationship band change must emit a stable-ID event');
    assert.match(relEvents[0].id, /^world-event-\d{6}$/);
    // The forced-hostility input drives the band down through wary to hostile.
    assert.ok(relEvents.some((e) => e.after.band === 'hostile'), 'attitude reaches the hostile band');
    assert.equal(state.relationships.pairs.drifters__index.forced, 'hostile');
});

test('LOD promotion L1->L2->L1 with no intervening simulation is a verified no-op', () => {
    const initial = createInitialWorldState(0);
    for (const id of WORLD_FACTION_IDS) {
        const faction = initial.factions.byId[id];
        const materialized = materializeAgents(faction, initial.seed);
        assert.ok(materialized.agents.length >= 1 && materialized.agents.length <= MAX_SIMULATED_AGENTS);
        // Agents partition the extensive aggregates exactly.
        assert.deepEqual(foldAgents(materialized), faction.aggregates, `round trip ${id}`);
        // Reconstruction depends on (seed, aggregates) only, not retained detail.
        assert.deepEqual(materializeAgents(faction, initial.seed), materialized);
    }
});

test('LOD tier set and hard caps demote over-budget entities by interest deterministically', () => {
    let state = createInitialWorldState(0);
    assert.deepEqual(LOD_TIERS, ['dormant', 'statistical', 'simulated', 'embodied']);
    state = setEntityLod(state, 'commonwealth', 'embodied');
    state = setEntityLod(state, 'index', 'embodied');
    state = setEntityLod(state, 'drifters', 'embodied');
    assert.equal(state.lod.byEntityId.commonwealth.tier, 'embodied');

    const enforced = enforceEmbodiedBudget(state, { index: 0.9, commonwealth: 0.5, drifters: 0.1 }, { maxEmbodied: 1 });
    assert.equal(enforced.lod.byEntityId.index.tier, 'embodied');
    assert.equal(enforced.lod.byEntityId.commonwealth.tier, 'simulated');
    assert.equal(enforced.lod.byEntityId.drifters.tier, 'simulated');
    // Determinism: same interest map yields the same selection.
    assert.deepEqual(enforceEmbodiedBudget(state, { index: 0.9, commonwealth: 0.5, drifters: 0.1 }, { maxEmbodied: 1 }), enforced);

    assert.throws(() => setEntityLod(state, 'unknown', 'embodied'), /Unknown world LOD entity/);
    assert.throws(() => setEntityLod(state, 'commonwealth', 'rendered'), /Unknown simulation LOD tier/);
});

test('the simulated-tier budget demotes over-budget entities to statistical by interest', () => {
    let state = createInitialWorldState(0);
    state = setEntityLod(state, 'commonwealth', 'simulated');
    state = setEntityLod(state, 'index', 'simulated');
    state = setEntityLod(state, 'drifters', 'simulated');

    const interest = { drifters: 0.9, commonwealth: 0.4, index: 0.2 };
    const enforced = enforceSimulatedBudget(state, interest, { maxSimulated: 1 });
    // Highest-interest entity stays simulated; the rest fold back to L1.
    assert.equal(enforced.lod.byEntityId.drifters.tier, 'simulated');
    assert.equal(enforced.lod.byEntityId.commonwealth.tier, 'statistical');
    assert.equal(enforced.lod.byEntityId.index.tier, 'statistical');
    // Determinism: same interest map yields the same selection.
    assert.deepEqual(enforceSimulatedBudget(state, interest, { maxSimulated: 1 }), enforced);
    // A budget that fits leaves every tier untouched.
    assert.deepEqual(enforceSimulatedBudget(state, interest, { maxSimulated: 8 }), state);
});

test('sustained at-war from an intervention descends a civ tier as data, reversible only via events', () => {
    let world = createInitialWorldState(0);
    const beforeTier = world.factions.byId.drifters.civTier;
    const commands = [{ id: 'c1', type: 'incite_conflict', a: 'commonwealth', b: 'drifters', gameTime: 0 }];
    let result = simStep({ state: world, fromGameTime: 0, toGameTime: 400 * WORLD_TICK_SECONDS, seed: WORLD_SEED, commands });
    world = result.state;
    const transition = result.events.find((e) => e.type === 'faction.tier.transition' && e.subjectIds.includes('drifters'));
    assert.ok(transition, 'a sustained-war faction must descend a civ tier');
    assert.ok(world.factions.byId.drifters.civTier < beforeTier);
    assert.ok(transition.after.civTier < transition.before.civTier);

    // Brokering peace clears the forced hostility (a tick input) but does NOT
    // silently restore the lost tier — only further events can.
    const droppedTier = world.factions.byId.drifters.civTier;
    const peace = [{ id: 'p1', type: 'broker_peace', a: 'commonwealth', b: 'drifters', gameTime: world.lastTickGameTime }];
    world = simStep({
        state: world,
        fromGameTime: world.lastTickGameTime,
        toGameTime: world.lastTickGameTime + 300 * WORLD_TICK_SECONDS,
        seed: WORLD_SEED,
        commands: peace
    }).state;
    assert.equal(world.factions.byId.drifters.civTier, droppedTier, 'tier is not silently restored');
});

test('bounded catch-up: split steps equal a single step and closing the game adds no ticks', () => {
    const commands = [{ id: 'c1', type: 'incite_conflict', a: 'index', b: 'drifters', gameTime: 180 }];
    const single = advanceWorld(createInitialWorldState(0), 600 * WORLD_TICK_SECONDS, { commands }).world;
    let split = createInitialWorldState(0);
    let time = 0;
    for (const span of [137, 200, 263]) {
        time += span;
        split = advanceWorld(split, time * WORLD_TICK_SECONDS, { commands }).world;
    }
    assert.deepEqual(split, single);

    // Sub-tick spans and zero elapsed time advance nothing.
    const initial = createInitialWorldState(0);
    assert.equal(advanceWorld(initial, 59).ticksApplied, 0);
    assert.deepEqual(advanceWorld(initial, 0).world, initial);
    // maxTicks caps the work per update.
    assert.equal(advanceWorld(initial, 100000 * WORLD_TICK_SECONDS, { maxTicks: 10 }).ticksApplied, 10);
});

test('an intervention changes the event history rather than selecting a scripted outcome', () => {
    const baseline = advanceWorld(createInitialWorldState(0), 300 * WORLD_TICK_SECONDS).events;
    const intervened = advanceWorld(createInitialWorldState(0), 300 * WORLD_TICK_SECONDS, {
        commands: [{ id: 'c1', type: 'incite_conflict', a: 'commonwealth', b: 'index', gameTime: 0 }]
    }).events;
    assert.notDeepEqual(baseline, intervened);
    const applied = intervened.find((e) => e.type === 'command.applied');
    assert.ok(applied);
    assert.deepEqual(applied.cause, { commandId: 'c1' });
});

test('a long seeded soak preserves population/wealth/stability invariants', () => {
    const run = () => {
        let world = createInitialWorldState(0);
        for (let chunk = 1; chunk <= 50; chunk += 1) {
            world = advanceWorld(world, chunk * 2000 * WORLD_TICK_SECONDS).world;
        }
        return world;
    };
    const first = run();
    const second = run();
    assert.deepEqual(first, second, `world soak seed: ${first.seed}`);
    for (const id of WORLD_FACTION_IDS) {
        const aggregates = first.factions.byId[id].aggregates;
        assert.ok(Number.isSafeInteger(aggregates.population) && aggregates.population >= 0);
        assert.ok(Number.isSafeInteger(aggregates.wealth) && aggregates.wealth >= 0);
        assert.ok(Number.isFinite(aggregates.stability) && aggregates.stability >= 0 && aggregates.stability <= 1);
        assert.ok(Number.isFinite(aggregates.controlProgress));
    }
    assert.ok(first.events.length <= MAX_WORLD_EVENT_LOG);
});

test('event-log compaction is bounded and preserves tier transitions', () => {
    const events = [];
    for (let sequence = 1; sequence <= MAX_WORLD_EVENT_LOG + 50; sequence += 1) {
        events.push({
            id: `world-event-${String(sequence).padStart(6, '0')}`,
            sequence,
            type: sequence % 137 === 0 ? 'faction.tier.transition' : 'relationship.changed',
            gameTime: sequence,
            subjectIds: ['drifters'],
            cause: { tick: sequence },
            before: null,
            after: null
        });
    }
    const compacted = compactWorldEvents(events);
    assert.ok(compacted.length <= MAX_WORLD_EVENT_LOG);
    const tierTransitions = events.filter((e) => e.type === 'faction.tier.transition');
    for (const transition of tierTransitions) {
        assert.ok(compacted.some((e) => e.id === transition.id), 'tier transitions survive compaction');
    }
    for (let index = 1; index < compacted.length; index += 1) {
        assert.ok(compacted[index].sequence > compacted[index - 1].sequence);
    }
});

// --- T2 Persistence ----------------------------------------------------------

test('version-11 save migrates to v12 and initializes the world facet non-destructively', () => {
    const raw = JSON.parse(readFileSync(fixturePath('phase-22-v11-clean.json'), 'utf8'));
    assert.equal(raw.version, 11);
    assert.equal(raw.simulation.world, undefined);

    const migrated = sanitizeSaveEnvelope(raw);
    assert.equal(migrated.version, 13);
    assert.equal(migrated.autosave.reason, 'phase-24-v12');
    // The world is initialized at the saved gameTime, not back-simulated.
    assert.equal(migrated.simulation.world.lastTickGameTime, 7200);
    assert.deepEqual(migrated.simulation.world, createInitialWorldState(7200));
    // Economy, ship, and reputation migrate unchanged.
    assert.equal(migrated.ship.credits, 980);
    assert.equal(migrated.rpg.factions.byId.commonwealth.reputation, 0.25);
    assert.equal(migrated.simulation.economy.lastTickGameTime, 7200);
});

test('a version-12 envelope round-trips through serialization unchanged', () => {
    const harness = createHarness({ gameTime: 1000 });
    harness.world.update();
    const envelope = harness.slots.getActiveEnvelope();
    const roundTripped = sanitizeSaveEnvelope(JSON.parse(JSON.stringify(envelope)));
    assert.deepEqual(roundTripped.simulation.world, envelope.simulation.world);
});

test('demote -> save/reload -> promote reconstructs L2 state from (seed, aggregates), not retained detail', () => {
    let harness = createHarness({ gameTime: 0 });
    // Promote L1 -> L2 and capture the derived concrete agents.
    harness.world.promote('index', 'simulated');
    const before = harness.world.materialize('index');
    const aggregatesBefore = structuredClone(harness.world.getFaction('index').aggregates);
    // The derived agents fold back to exactly the L1 aggregates (extensive split).
    assert.deepEqual(harness.world.foldback(before), aggregatesBefore);

    // Demote L2 -> L1 and persist. Only the tier is retained; no agent detail is.
    harness.world.demote('index', 'statistical');
    assert.equal(harness.world.getLod('index'), 'statistical');
    const stored = harness.slots.getActiveEnvelope().simulation.world;
    assert.equal(stored.lod.byEntityId.index.tier, 'statistical');
    assert.equal(stored.factions.byId.index.agents, undefined, 'no L2 detail is persisted');

    // Reopen from durable storage with a fresh slot manager, then promote again.
    harness = reopen(harness, { newSlotManager: true });
    harness.world.promote('index', 'simulated');
    const after = harness.world.materialize('index');
    // Reconstruction is equivalent and depends only on (seed, aggregates).
    assert.deepEqual(after, before, `world seed: ${harness.world.getWorld().seed}`);
    assert.deepEqual(harness.world.foldback(after), aggregatesBefore);
});

test('world validation rejects forged aggregates, bad attitudes, sequences, time, IDs, and LOD budget', () => {
    const base = createInitialWorldState(0);
    const cases = [
        [(s) => { s.factions.byId.index.aggregates.stability = 1.5; }, /stability must be a finite number within 0\.\.1/],
        [(s) => { s.factions.byId.index.aggregates.population = -1; }, /population must be a non-negative safe integer/],
        [(s) => { s.relationships.pairs.commonwealth__index.attitude = 2; }, /attitude must be within -1\.\.1/],
        [(s) => { s.factions.byId.forged = {}; }, /Invalid world faction ID/],
        [(s) => { s.factions.byId.index.territory.systemIds = ['nowhere']; }, /unknown system ID/],
        [(s) => { s.lastTickGameTime = 10; }, /cannot exceed simulation\.gameTime/],
        [(s) => { s.lod.byEntityId.index.tier = 'rendered'; }, /Invalid simulation LOD tier/]
    ];
    for (const [mutate, pattern] of cases) {
        const dirty = structuredClone(base);
        mutate(dirty);
        assert.throws(() => sanitizeWorldState(dirty, { gameTime: 0 }), pattern);
    }

    // Non-monotonic event sequences are rejected.
    const withEvents = structuredClone(base);
    withEvents.events = [
        { id: 'world-event-000002', sequence: 2, type: 'relationship.changed', gameTime: 0, subjectIds: ['index'], cause: { tick: 1 }, before: null, after: null },
        { id: 'world-event-000002', sequence: 2, type: 'relationship.changed', gameTime: 0, subjectIds: ['index'], cause: { tick: 1 }, before: null, after: null }
    ];
    withEvents.nextEventSequence = 3;
    assert.throws(() => sanitizeWorldState(withEvents, { gameTime: 0 }), /sequences must be strictly increasing/);
});

test('active-slot reset restores the initial world facet', () => {
    const harness = createHarness({ gameTime: 600 });
    harness.world.enqueueCommand({ type: 'incite_conflict', a: 'commonwealth', b: 'drifters' });
    assert.notDeepEqual(
        harness.slots.getActiveEnvelope().simulation.world,
        createInitialWorldState(600)
    );
    harness.slots.resetActiveSlot();
    const reopened = reopen(harness);
    assert.deepEqual(
        reopened.slots.getActiveEnvelope().simulation.world,
        createInitialWorldState(0)
    );
});

// --- T3 Integration ----------------------------------------------------------

test('the world territory projection agrees with Phase 17 faction influence', () => {
    const harness = createHarness();
    const territory = harness.world.getTerritory();
    assert.equal(territory.bySystem.entry_hub, 'commonwealth');
    assert.equal(territory.bySystem.index_hq, 'index');
    assert.equal(territory.bySystem.drifter_convergence, 'drifters');
    // Phase 17's independent query resolves the same controlling faction.
    const influence = queryFactionInfluence({ systemId: 'entry_hub', rpgState: harness.rpg.getState() });
    assert.equal(influence.controllingFactionId, territory.bySystem.entry_hub);
});

test('WorldRuntime advances on play time, persists, and an intervention survives reload', () => {
    let harness = createHarness({ gameTime: 0 });
    harness.setGameTime(120 * WORLD_TICK_SECONDS);
    const ticked = harness.world.update();
    assert.ok(ticked.changed && ticked.ticksApplied === 120);

    harness.world.enqueueCommand({ type: 'incite_conflict', a: 'commonwealth', b: 'index' });
    const eventsBefore = harness.world.getEvents();
    const commandEvent = eventsBefore.find((e) => e.type === 'command.applied');
    assert.ok(commandEvent, 'the intervention is recorded as a command.applied event');

    // Reload from durable storage reconstructs the same world + history.
    harness = reopen(harness, { newSlotManager: true });
    const reloadedEvents = harness.world.getEvents();
    assert.ok(reloadedEvents.some((e) => e.id === commandEvent.id));
    assert.equal(harness.world.getWorld().relationships.pairs.commonwealth__index.forced, 'hostile');
});

test('closing the game (reopening at the same play time) advances no world time', () => {
    let harness = createHarness({ gameTime: 240 * WORLD_TICK_SECONDS });
    harness.world.update();
    const beforeClose = structuredClone(harness.slots.getActiveEnvelope().simulation.world);
    harness = reopen(harness, { newSlotManager: true });
    assert.deepEqual(harness.slots.getActiveEnvelope().simulation.world, beforeClose);
});

test('a corrupt world facet isolates the simulation without disabling the economy or rpg', () => {
    const harness = createHarness();
    const envelope = harness.slots.getActiveEnvelope();
    envelope.simulation.world.factions.byId.index.aggregates.stability = 9;
    // saveDomains re-sanitizes the envelope, so corruption is rejected at write.
    // (At the App level the throwing tick is contained by _updateWorldSafely /
    // _createWorldRuntimeSafely so flight/render keep running — locked rule 7.)
    assert.throws(
        () => harness.slots.saveDomains({ world: envelope.simulation.world, gameTime: harness.getGameTime() }),
        /stability/
    );
    // The rejected world write does not corrupt shared persistence: other facets
    // on the same slots remain fully operable.
    harness.economy.syncSystem('entry_hub');
    assert.ok(harness.economy.buy('field_rations', 1).changed);
    assert.ok(harness.rpg.getState(), 'rpg state stays readable after a rejected world write');
});
