// Phase 23 — Autonomous World Simulation substrate.
//
// This module is the headless, deterministic simulation core. It has NO
// `three`, DOM, audio, or renderer import and advances world state purely from
// accumulated Phase 13 `gameTime`. Its single public contract is:
//
//   simStep({ state, fromGameTime, toGameTime, seed, commands }) -> { state, events }
//
// Same (seed, state, command sequence, time span) always yields the same
// (state, events). It is structured so it can later be moved to a Web Worker,
// WASM, or a local sim server without changing this contract (locked rule:
// platform is not a constraint; the boundary is drawn here).
//
// Two orthogonal axes are kept strictly separate (never conflated):
//   - simulation LOD tier: dormant -> statistical -> simulated -> embodied
//     (how finely an entity is resolved; the "resolution" the player observes)
//   - civilization tier (0-4): an in-world property of a faction, mutated only
//     by events.

import { FACTION_DEFINITIONS, NAMED_SYSTEM_IDS } from './registries.js';

export const WORLD_STATE_VERSION = 1;
export const WORLD_SEED = 'deep-space-vr-world-v1';
export const WORLD_TICK_SECONDS = 60;
export const MAX_WORLD_TICKS_PER_UPDATE = 100000;
export const MAX_WORLD_EVENT_LOG = 400;
export const MAX_AT_WAR_TICKS = 1000000;

// --- Simulation LOD contract -------------------------------------------------

export const LOD_TIERS = Object.freeze(['dormant', 'statistical', 'simulated', 'embodied']);
const LOD_TIER_INDEX = Object.freeze(
    Object.fromEntries(LOD_TIERS.map((tier, index) => [tier, index]))
);
export const MAX_SIMULATED_AGENTS = 8;
export const MAX_EMBODIED_ENTITIES = 4;

// --- Faction fixture (three locked Tier 2 factions, reusing Phase 17 IDs) ----
//
// The doc placeholders `faction_*` are "placeholder until §24B content"; this
// substrate reuses the existing registry faction IDs so Phase 17 territory and
// reputation read as projections of the same identities.

export const WORLD_FACTION_IDS = Object.freeze(['commonwealth', 'index', 'drifters']);
export const DRIVE_KEYS = Object.freeze(['expansion', 'accumulation', 'aggression', 'isolation']);
export const AGENDAS = Object.freeze([
    'expanding',
    'consolidating',
    'trading',
    'retreating',
    'at_war'
]);
export const ATTITUDE_BANDS = Object.freeze(['allied', 'friendly', 'neutral', 'wary', 'hostile']);
export const WORLD_EVENT_TYPES = Object.freeze([
    'command.applied',
    'faction.agenda.changed',
    'relationship.changed',
    'faction.tier.transition'
]);
export const WORLD_COMMAND_TYPES = Object.freeze(['incite_conflict', 'broker_peace']);

const POPULATION_MAX = 1000000;
const WEALTH_MAX = 1000000;

const FACTION_FIXTURE = Object.freeze({
    commonwealth: fixture({
        drives: { expansion: 0.75, accumulation: 0.55, aggression: 0.20, isolation: 0.15 },
        aggregates: { population: 50000, wealth: 60000, stability: 0.70, controlProgress: 0.60 },
        territory: ['entry_hub']
    }),
    index: fixture({
        drives: { expansion: 0.25, accumulation: 0.80, aggression: 0.25, isolation: 0.70 },
        aggregates: { population: 20000, wealth: 80000, stability: 0.75, controlProgress: 0.55 },
        territory: ['index_hq']
    }),
    drifters: fixture({
        drives: { expansion: 0.55, accumulation: 0.35, aggression: 0.55, isolation: 0.20 },
        aggregates: { population: 15000, wealth: 30000, stability: 0.55, controlProgress: 0.40 },
        territory: ['drifter_convergence']
    })
});

// Tier-transition rule (the one tier-fluidity proof for this phase): a faction
// whose stability stays below the floor while sustaining `at_war` for the drop
// duration descends one civ tier. The descent is an event and mutates civTier as
// data; it is reversible only via further events, never silently.
const AT_WAR_PRESSURE = 0.5;
const TIER_DROP_AT_WAR_TICKS = 50;
const TIER_DROP_STABILITY = 0.30;

// --- Public construction / validation ---------------------------------------

export function createInitialWorldState(gameTime = 0) {
    const time = sanitizeGameTime(gameTime, 'world initial gameTime');
    const factions = {};
    const lod = {};
    for (const id of WORLD_FACTION_IDS) {
        const fixtureEntry = FACTION_FIXTURE[id];
        factions[id] = {
            id,
            civTier: FACTION_DEFINITIONS[id].civTier,
            drives: { ...fixtureEntry.drives },
            agenda: 'consolidating',
            aggregates: { ...fixtureEntry.aggregates },
            territory: { systemIds: [...fixtureEntry.territory] },
            atWarTicks: 0
        };
        lod[id] = { tier: 'statistical' };
    }
    const relationships = { pairs: {} };
    for (const [a, b] of factionPairs()) {
        relationships.pairs[pairKey(a, b)] = {
            attitude: roundAttitude(equilibriumAttitude(factions[a], factions[b])),
            forced: null
        };
    }
    // Agendas derive from drives + initial relationships so the three factions
    // start observably distinct (expanding / trading / consolidating).
    for (const id of WORLD_FACTION_IDS) {
        factions[id].agenda = deriveAgenda(factions[id], conflictPressure(id, factions, relationships));
    }
    return {
        version: WORLD_STATE_VERSION,
        seed: WORLD_SEED,
        lastTickGameTime: time,
        nextEventSequence: 1,
        lod: { byEntityId: lod },
        factions: { byId: factions },
        relationships,
        events: []
    };
}

export function sanitizeWorldState(value, { gameTime = Number.MAX_SAFE_INTEGER } = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('simulation.world must be an object.');
    }
    if (value.version !== WORLD_STATE_VERSION) {
        throw new Error(`Unsupported world state version: ${value.version ?? 'missing'}.`);
    }
    if (value.seed !== WORLD_SEED) throw new Error(`Unknown world seed: ${value.seed ?? 'missing'}.`);
    const currentGameTime = sanitizeGameTime(gameTime, 'simulation.gameTime');
    const lastTickGameTime = sanitizeGameTime(value.lastTickGameTime, 'simulation.world.lastTickGameTime');
    if (lastTickGameTime > currentGameTime) {
        throw new Error('simulation.world.lastTickGameTime cannot exceed simulation.gameTime.');
    }

    assertExactIds(value.factions?.byId, WORLD_FACTION_IDS, 'world faction');
    const factions = {};
    for (const id of WORLD_FACTION_IDS) {
        factions[id] = sanitizeFaction(value.factions.byId[id], id);
    }

    assertExactIds(value.lod?.byEntityId, WORLD_FACTION_IDS, 'world LOD entity');
    const lod = {};
    let simulatedCount = 0;
    let embodiedCount = 0;
    for (const id of WORLD_FACTION_IDS) {
        const tier = value.lod.byEntityId[id]?.tier;
        if (!LOD_TIERS.includes(tier)) {
            throw new Error(`Invalid simulation LOD tier for ${id}: ${tier ?? 'missing'}.`);
        }
        if (tier === 'simulated') simulatedCount += 1;
        if (tier === 'embodied') embodiedCount += 1;
        lod[id] = { tier };
    }
    if (simulatedCount + embodiedCount > MAX_SIMULATED_AGENTS) {
        throw new Error('Simulated/embodied LOD entity count exceeds the configured budget.');
    }
    if (embodiedCount > MAX_EMBODIED_ENTITIES) {
        throw new Error('Embodied LOD entity count exceeds the configured budget.');
    }

    const expectedPairs = new Set(factionPairs().map(([a, b]) => pairKey(a, b)));
    assertExactIds(value.relationships?.pairs, [...expectedPairs], 'world relationship pair');
    const pairs = {};
    for (const key of expectedPairs) {
        pairs[key] = sanitizeRelationship(value.relationships.pairs[key], key);
    }

    if (!Array.isArray(value.events)) throw new Error('simulation.world.events must be an array.');
    if (value.events.length > MAX_WORLD_EVENT_LOG) {
        throw new Error(`World event log exceeds ${MAX_WORLD_EVENT_LOG} entries.`);
    }
    const events = value.events.map((entry, index) => sanitizeEvent(entry, index, lastTickGameTime));
    for (let index = 1; index < events.length; index += 1) {
        if (events[index].sequence <= events[index - 1].sequence) {
            throw new Error('World event sequences must be strictly increasing.');
        }
    }
    const nextEventSequence = sanitizePositiveInteger(value.nextEventSequence, 'simulation.world.nextEventSequence');
    if (events.length && nextEventSequence <= events.at(-1).sequence) {
        throw new Error('World next event sequence must follow the retained event log.');
    }

    return {
        version: WORLD_STATE_VERSION,
        seed: WORLD_SEED,
        lastTickGameTime,
        nextEventSequence,
        lod: { byEntityId: lod },
        factions: { byId: factions },
        relationships: { pairs },
        events
    };
}

// --- The headless deterministic tick (pure core) -----------------------------

export function simStep({ state, fromGameTime, toGameTime, seed = WORLD_SEED, commands = [] } = {}) {
    const from = sanitizeGameTime(fromGameTime, 'simStep fromGameTime');
    const to = sanitizeGameTime(toGameTime, 'simStep toGameTime');
    if (to < from) throw new Error('simStep toGameTime cannot precede fromGameTime.');
    if (seed !== WORLD_SEED) throw new Error(`simStep seed mismatch: ${seed}.`);
    const world = sanitizeWorldState(state, { gameTime: to });
    if (world.lastTickGameTime !== from) {
        throw new Error('simStep fromGameTime must equal state.lastTickGameTime.');
    }

    const queue = sanitizeCommands(commands)
        .filter((command) => command.gameTime >= from && command.gameTime <= to)
        .sort((a, b) => a.gameTime - b.gameTime || a.id.localeCompare(b.id));
    let queueIndex = 0;

    const events = [];
    const emit = (type, subjectIds, cause, before, after, atTime) => {
        const event = {
            id: worldEventId(world.nextEventSequence),
            sequence: world.nextEventSequence,
            type,
            gameTime: atTime,
            subjectIds: [...subjectIds],
            cause,
            before,
            after
        };
        world.events.push(event);
        events.push(event);
        world.nextEventSequence += 1;
    };

    const applyCommandsDueBy = (time) => {
        while (queueIndex < queue.length && queue[queueIndex].gameTime <= time) {
            const command = queue[queueIndex];
            queueIndex += 1;
            const result = applyCommand(world, command);
            if (result) emit('command.applied', result.subjectIds, { commandId: command.id }, result.before, result.after, command.gameTime);
        }
    };

    const ticks = Math.floor((to - from) / WORLD_TICK_SECONDS);
    const baseTickIndex = Math.round(from / WORLD_TICK_SECONDS);
    for (let i = 1; i <= ticks; i += 1) {
        const tickEnd = from + i * WORLD_TICK_SECONDS;
        applyCommandsDueBy(tickEnd);
        advanceOneTick(world, baseTickIndex + i, tickEnd, emit);
        world.lastTickGameTime = tickEnd;
    }
    // Commands due after the final tick boundary still take effect (their
    // persistent inputs are folded into state); they evolve on the next call.
    applyCommandsDueBy(to);

    world.events = compactWorldEvents(world.events);
    return { state: sanitizeWorldState(world, { gameTime: to }), events };
}

// Bounded catch-up wrapper (mirrors advanceEconomy): caps ticks per update and
// uses only accumulated active play; closing the game advances no world time.
export function advanceWorld(value, gameTime, { maxTicks = MAX_WORLD_TICKS_PER_UPDATE, commands = [] } = {}) {
    const time = sanitizeGameTime(gameTime, 'world update gameTime');
    const world = sanitizeWorldState(value, { gameTime: time });
    const availableTicks = Math.floor((time - world.lastTickGameTime) / WORLD_TICK_SECONDS);
    const cappedTicks = Math.min(availableTicks, clampInteger(Number(maxTicks), 0, MAX_WORLD_TICKS_PER_UPDATE));
    if (cappedTicks <= 0 && sanitizeCommands(commands).length === 0) {
        return { world, ticksApplied: 0, events: [] };
    }
    const toGameTime = world.lastTickGameTime + cappedTicks * WORLD_TICK_SECONDS;
    const { state, events } = simStep({
        state: world,
        fromGameTime: world.lastTickGameTime,
        toGameTime,
        seed: world.seed,
        commands
    });
    return { world: state, ticksApplied: cappedTicks, events };
}

function advanceOneTick(world, tickIndex, tickEnd, emit) {
    const factions = world.factions.byId;
    // Relationship matrix first: attitudes drift toward their drive-determined
    // (or command-forced) equilibrium. Band crossings emit events.
    for (const [a, b] of factionPairs()) {
        const key = pairKey(a, b);
        const pair = world.relationships.pairs[key];
        const target = pair.forced === 'hostile'
            ? -1
            : equilibriumAttitude(factions[a], factions[b]);
        const beforeAttitude = pair.attitude;
        const beforeBand = attitudeBand(beforeAttitude);
        const nextAttitude = roundAttitude(beforeAttitude + (target - beforeAttitude) * 0.02);
        pair.attitude = nextAttitude;
        const afterBand = attitudeBand(nextAttitude);
        if (afterBand !== beforeBand) {
            emit(
                'relationship.changed',
                [a, b],
                { tick: tickIndex },
                { attitude: beforeAttitude, band: beforeBand },
                { attitude: nextAttitude, band: afterBand },
                tickEnd
            );
        }
    }

    for (const id of WORLD_FACTION_IDS) {
        const faction = factions[id];
        const pressure = conflictPressure(id, factions, world.relationships);
        const jitter = (tickRandom(world.seed, id, tickIndex) - 0.5) * 0.002;

        const targetStability = clamp01(
            0.55 + 0.35 * faction.drives.isolation - 0.45 * faction.drives.aggression - 0.6 * pressure
        );
        faction.aggregates.stability = clamp01(
            faction.aggregates.stability + (targetStability - faction.aggregates.stability) * 0.02 + jitter
        );

        const targetWealth = Math.round(WEALTH_MAX * (0.05 + 0.25 * faction.drives.accumulation));
        faction.aggregates.wealth = clampInteger(
            faction.aggregates.wealth + Math.round((targetWealth - faction.aggregates.wealth) * 0.01),
            0,
            WEALTH_MAX
        );

        const targetPopulation = Math.round(
            POPULATION_MAX * (0.02 + 0.08 * faction.drives.expansion) * faction.aggregates.stability
        );
        faction.aggregates.population = clampInteger(
            faction.aggregates.population + Math.round((targetPopulation - faction.aggregates.population) * 0.01),
            0,
            POPULATION_MAX
        );

        faction.aggregates.controlProgress = clamp01(
            faction.aggregates.controlProgress + faction.drives.expansion * 0.001 * faction.aggregates.stability
        );

        const beforeAgenda = faction.agenda;
        const nextAgenda = deriveAgenda(faction, pressure);
        if (nextAgenda !== beforeAgenda) {
            faction.agenda = nextAgenda;
            emit(
                'faction.agenda.changed',
                [id],
                { tick: tickIndex },
                { agenda: beforeAgenda },
                { agenda: nextAgenda },
                tickEnd
            );
        }

        if (faction.agenda === 'at_war') {
            faction.atWarTicks = Math.min(MAX_AT_WAR_TICKS, faction.atWarTicks + 1);
        } else {
            faction.atWarTicks = Math.max(0, faction.atWarTicks - 1);
        }

        if (
            faction.atWarTicks >= TIER_DROP_AT_WAR_TICKS
            && faction.aggregates.stability < TIER_DROP_STABILITY
            && faction.civTier > 0
        ) {
            const beforeTier = faction.civTier;
            faction.civTier -= 1;
            faction.atWarTicks = 0;
            emit(
                'faction.tier.transition',
                [id],
                { tick: tickIndex },
                { civTier: beforeTier },
                { civTier: faction.civTier },
                tickEnd
            );
        }
    }
}

// --- Commands (the only intervention input) ----------------------------------

function applyCommand(world, command) {
    if (command.type === 'incite_conflict' || command.type === 'broker_peace') {
        const key = pairKey(command.a, command.b);
        const pair = world.relationships.pairs[key];
        if (!pair) throw new Error(`World command references an unknown faction pair: ${command.a}/${command.b}.`);
        const before = { attitude: pair.attitude, forced: pair.forced };
        // A command changes only the *input* to the tick (the forced attitude
        // target). The attitude then evolves toward it over subsequent ticks,
        // crossing bands and emitting events — never a scripted jump/outcome.
        pair.forced = command.type === 'incite_conflict' ? 'hostile' : null;
        return { subjectIds: [command.a, command.b].sort(), before, after: { attitude: pair.attitude, forced: pair.forced } };
    }
    throw new Error(`Unknown world command type: ${command.type ?? 'missing'}.`);
}

function sanitizeCommands(commands) {
    if (!Array.isArray(commands)) throw new Error('World commands must be an array.');
    return commands.map((command, index) => {
        if (!command || typeof command !== 'object') {
            throw new Error(`World command ${index} must be an object.`);
        }
        if (!WORLD_COMMAND_TYPES.includes(command.type)) {
            throw new Error(`Unknown world command type: ${command.type ?? 'missing'}.`);
        }
        if (!WORLD_FACTION_IDS.includes(command.a) || !WORLD_FACTION_IDS.includes(command.b)) {
            throw new Error(`World command references an unknown faction ID: ${command.a}/${command.b}.`);
        }
        if (command.a === command.b) throw new Error('World command requires two distinct factions.');
        const id = typeof command.id === 'string' && command.id ? command.id : `command-${index}`;
        const gameTime = sanitizeGameTime(command.gameTime ?? 0, `world command ${id} gameTime`);
        return { id, type: command.type, a: command.a, b: command.b, gameTime };
    });
}

// --- Simulation LOD: tier transitions + reversible promotion/demotion --------

export function setEntityLod(state, entityId, tier, { gameTime = Number.MAX_SAFE_INTEGER } = {}) {
    const world = sanitizeWorldState(state, { gameTime });
    if (!WORLD_FACTION_IDS.includes(entityId)) {
        throw new Error(`Unknown world LOD entity ID: ${entityId}.`);
    }
    if (!LOD_TIERS.includes(tier)) throw new Error(`Unknown simulation LOD tier: ${tier}.`);
    world.lod.byEntityId[entityId] = { tier };
    return sanitizeWorldState(world, { gameTime });
}

export function getEntityLod(state, entityId) {
    const tier = state?.lod?.byEntityId?.[entityId]?.tier;
    if (!LOD_TIERS.includes(tier)) throw new Error(`Unknown world LOD entity ID: ${entityId}.`);
    return tier;
}

// Promote L1 (statistical) -> L2 (simulated): derive concrete agents from the
// aggregates + seed. The split is exact so that demotion (folding agents back)
// is a perfect inverse — the §23 "round trip with no intervening simulation is
// a no-op" rule. No L2 detail is ever persisted; it is always reconstructable
// from (seed, aggregates).
export function materializeAgents(faction, seed = WORLD_SEED) {
    const aggregates = faction?.aggregates;
    if (!aggregates) throw new Error('materializeAgents requires a faction with aggregates.');
    const count = clampInteger(
        Math.max(1, Math.round(2 + aggregates.controlProgress * (MAX_SIMULATED_AGENTS - 2))),
        1,
        MAX_SIMULATED_AGENTS
    );
    const popShares = integerShares(aggregates.population, count, seed, `${faction.id}|pop`);
    const wealthShares = integerShares(aggregates.wealth, count, seed, `${faction.id}|wealth`);
    const agents = [];
    for (let index = 0; index < count; index += 1) {
        agents.push({
            id: `${faction.id}-agent-${String(index).padStart(2, '0')}`,
            population: popShares[index],
            wealth: wealthShares[index]
        });
    }
    return {
        factionId: faction.id,
        agents,
        residual: { stability: aggregates.stability, controlProgress: aggregates.controlProgress }
    };
}

export function foldAgents(materialized) {
    if (!materialized || !Array.isArray(materialized.agents)) {
        throw new Error('foldAgents requires a materialized agent set.');
    }
    return {
        population: materialized.agents.reduce((total, agent) => total + agent.population, 0),
        wealth: materialized.agents.reduce((total, agent) => total + agent.wealth, 0),
        stability: materialized.residual.stability,
        controlProgress: materialized.residual.controlProgress
    };
}

// Over-budget selection: keep the highest-interest entities embodied, demote
// the rest to `simulated` deterministically (ties broken by ID).
export function enforceEmbodiedBudget(state, interestById = {}, {
    maxEmbodied = MAX_EMBODIED_ENTITIES,
    gameTime = Number.MAX_SAFE_INTEGER
} = {}) {
    const world = sanitizeWorldState(state, { gameTime });
    const budget = clampInteger(Number(maxEmbodied), 0, MAX_EMBODIED_ENTITIES);
    const embodied = WORLD_FACTION_IDS
        .filter((id) => world.lod.byEntityId[id].tier === 'embodied')
        .sort((a, b) => (Number(interestById[b] ?? 0) - Number(interestById[a] ?? 0)) || a.localeCompare(b));
    for (let index = budget; index < embodied.length; index += 1) {
        world.lod.byEntityId[embodied[index]] = { tier: 'simulated' };
    }
    return sanitizeWorldState(world, { gameTime });
}

// The simulated-tier counterpart to enforceEmbodiedBudget: keep the highest-
// interest entities `simulated`, demote the rest to `statistical` (L1)
// deterministically (ties broken by ID). Together the two functions hold the
// §2 rule-4 hard caps on both resolved tiers, not just the embodied one.
export function enforceSimulatedBudget(state, interestById = {}, {
    maxSimulated = MAX_SIMULATED_AGENTS,
    gameTime = Number.MAX_SAFE_INTEGER
} = {}) {
    const world = sanitizeWorldState(state, { gameTime });
    const budget = clampInteger(Number(maxSimulated), 0, MAX_SIMULATED_AGENTS);
    const simulated = WORLD_FACTION_IDS
        .filter((id) => world.lod.byEntityId[id].tier === 'simulated')
        .sort((a, b) => (Number(interestById[b] ?? 0) - Number(interestById[a] ?? 0)) || a.localeCompare(b));
    for (let index = budget; index < simulated.length; index += 1) {
        world.lod.byEntityId[simulated[index]] = { tier: 'statistical' };
    }
    return sanitizeWorldState(world, { gameTime });
}

// --- Projections (Phase 17 territory / Phase 20 economy read the substrate) --

export function getWorldTerritory(state) {
    const byFaction = {};
    const bySystem = {};
    for (const id of WORLD_FACTION_IDS) {
        const systemIds = [...state.factions.byId[id].territory.systemIds].sort();
        byFaction[id] = systemIds;
        for (const systemId of systemIds) bySystem[systemId] = id;
    }
    return { byFaction, bySystem };
}

export function getFactionAggregates(state, factionId) {
    const faction = state?.factions?.byId?.[factionId];
    if (!faction) throw new Error(`Unknown world faction ID: ${factionId}.`);
    return structuredClone(faction.aggregates);
}

export function getRelationshipAttitude(state, a, b) {
    const pair = state?.relationships?.pairs?.[pairKey(a, b)];
    if (!pair) throw new Error(`Unknown world relationship pair: ${a}/${b}.`);
    return pair.attitude;
}

export function compactWorldEvents(events, maxEntries = MAX_WORLD_EVENT_LOG) {
    if (!Array.isArray(events) || events.length <= maxEntries) return events ?? [];
    // Tier transitions are the protected, referentially-significant events; keep
    // them all plus the most recent remainder so no surviving state references a
    // compacted event without a retained record.
    const protectedEvents = events.filter((event) => event.type === 'faction.tier.transition');
    const protectedIds = new Set(protectedEvents.map((event) => event.id));
    const remaining = events.filter((event) => !protectedIds.has(event.id));
    const available = Math.max(0, maxEntries - protectedEvents.length);
    return [...protectedEvents, ...remaining.slice(-available)]
        .sort((a, b) => a.sequence - b.sequence);
}

// --- Derivation helpers ------------------------------------------------------

function deriveAgenda(faction, pressure) {
    if (pressure >= AT_WAR_PRESSURE) return 'at_war';
    if (faction.aggregates.stability < 0.25) return 'retreating';
    if (faction.drives.expansion >= 0.6 && faction.aggregates.stability >= 0.4) return 'expanding';
    if (faction.drives.accumulation >= 0.6) return 'trading';
    return 'consolidating';
}

function equilibriumAttitude(a, b) {
    const maxAggression = Math.max(a.drives.aggression, b.drives.aggression);
    const expansionClash = a.drives.expansion * b.drives.expansion;
    return clampAttitude(0.35 - 0.7 * maxAggression - 0.3 * expansionClash);
}

function conflictPressure(factionId, factions, relationships) {
    let total = 0;
    let count = 0;
    for (const otherId of WORLD_FACTION_IDS) {
        if (otherId === factionId) continue;
        const pair = relationships.pairs[pairKey(factionId, otherId)];
        total += Math.max(0, -pair.attitude);
        count += 1;
    }
    return count ? total / count : 0;
}

function attitudeBand(attitude) {
    if (attitude >= 0.5) return 'allied';
    if (attitude >= 0.15) return 'friendly';
    if (attitude > -0.15) return 'neutral';
    if (attitude > -0.5) return 'wary';
    return 'hostile';
}

function factionPairs() {
    const pairs = [];
    for (let i = 0; i < WORLD_FACTION_IDS.length; i += 1) {
        for (let j = i + 1; j < WORLD_FACTION_IDS.length; j += 1) {
            pairs.push([WORLD_FACTION_IDS[i], WORLD_FACTION_IDS[j]]);
        }
    }
    return pairs;
}

function pairKey(a, b) {
    return [a, b].sort().join('__');
}

function fixture(value) {
    return Object.freeze({
        drives: Object.freeze({ ...value.drives }),
        aggregates: Object.freeze({ ...value.aggregates }),
        territory: Object.freeze([...value.territory])
    });
}

// --- Deterministic seeded RNG ------------------------------------------------

function hashStringToSeed(text) {
    let hash = 2166136261 >>> 0;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function tickRandom(seed, factionId, tickIndex) {
    return mulberry32(hashStringToSeed(`${seed}|${factionId}|${tickIndex}`))();
}

function integerShares(total, count, seed, label) {
    const cleanTotal = sanitizeNonNegativeSafeInteger(total, `${label} total`);
    const random = mulberry32(hashStringToSeed(`${seed}|${label}|${count}`));
    const weights = [];
    let weightSum = 0;
    for (let index = 0; index < count; index += 1) {
        const weight = 0.5 + random();
        weights.push(weight);
        weightSum += weight;
    }
    const shares = new Array(count).fill(0);
    let allocated = 0;
    for (let index = 0; index < count; index += 1) {
        shares[index] = Math.floor((cleanTotal * weights[index]) / weightSum);
        allocated += shares[index];
    }
    // Assign the rounding remainder to the last share so the parts sum exactly.
    shares[count - 1] += cleanTotal - allocated;
    return shares;
}

// --- Field sanitizers --------------------------------------------------------

function sanitizeFaction(value, id) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`World faction ${id} must be an object.`);
    }
    if (value.id !== id) throw new Error(`World faction ID mismatch: ${value.id ?? 'missing'}/${id}.`);
    const civTier = sanitizeNonNegativeSafeInteger(value.civTier, `world.${id}.civTier`);
    if (civTier > 4) throw new Error(`World faction civ tier must be 0-4: ${id}.`);
    assertExactIds(value.drives, DRIVE_KEYS, `world ${id} drive`);
    const drives = {};
    for (const key of DRIVE_KEYS) drives[key] = sanitizeUnitFloat(value.drives[key], `world.${id}.drives.${key}`);
    if (!AGENDAS.includes(value.agenda)) throw new Error(`Unknown world agenda for ${id}: ${value.agenda ?? 'missing'}.`);
    const aggregates = {
        population: clampedInteger(value.aggregates?.population, 0, POPULATION_MAX, `world.${id}.population`),
        wealth: clampedInteger(value.aggregates?.wealth, 0, WEALTH_MAX, `world.${id}.wealth`),
        stability: sanitizeUnitFloat(value.aggregates?.stability, `world.${id}.stability`),
        controlProgress: sanitizeUnitFloat(value.aggregates?.controlProgress, `world.${id}.controlProgress`)
    };
    const systemIds = Array.isArray(value.territory?.systemIds) ? [...value.territory.systemIds] : null;
    if (!systemIds) throw new Error(`World faction ${id} territory.systemIds must be an array.`);
    for (const systemId of systemIds) {
        if (!NAMED_SYSTEM_IDS.includes(systemId)) {
            throw new Error(`World faction ${id} references an unknown system ID: ${systemId}.`);
        }
    }
    const atWarTicks = clampedInteger(value.atWarTicks, 0, MAX_AT_WAR_TICKS, `world.${id}.atWarTicks`);
    return {
        id,
        civTier,
        drives,
        agenda: value.agenda,
        aggregates,
        territory: { systemIds: [...new Set(systemIds)].sort() },
        atWarTicks
    };
}

function sanitizeRelationship(value, key) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`World relationship ${key} must be an object.`);
    }
    const attitude = Number(value.attitude);
    if (!Number.isFinite(attitude) || attitude < -1 || attitude > 1) {
        throw new Error(`World relationship attitude must be within -1..1: ${key}.`);
    }
    const forced = value.forced ?? null;
    if (forced !== null && forced !== 'hostile') {
        throw new Error(`Unknown world relationship forced state: ${key}/${forced}.`);
    }
    return { attitude: roundAttitude(attitude), forced };
}

function sanitizeEvent(value, index, lastTickGameTime) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`World event ${index} must be an object.`);
    }
    const sequence = sanitizePositiveInteger(value.sequence, `world.events[${index}].sequence`);
    const id = worldEventId(sequence);
    if (value.id !== id) throw new Error(`Invalid world event ID: ${value.id ?? 'missing'}.`);
    if (!WORLD_EVENT_TYPES.includes(value.type)) {
        throw new Error(`Unknown world event type: ${value.type ?? 'missing'}.`);
    }
    const gameTime = sanitizeGameTime(value.gameTime, `${id}.gameTime`);
    if (gameTime > lastTickGameTime) {
        throw new Error(`World event ${id} time cannot exceed the last tick time.`);
    }
    if (!Array.isArray(value.subjectIds) || value.subjectIds.length === 0) {
        throw new Error(`World event ${id} requires subjectIds.`);
    }
    for (const subjectId of value.subjectIds) {
        if (!WORLD_FACTION_IDS.includes(subjectId)) {
            throw new Error(`World event ${id} references an unknown subject: ${subjectId}.`);
        }
    }
    if (!value.cause || typeof value.cause !== 'object') {
        throw new Error(`World event ${id} requires a cause.`);
    }
    return {
        id,
        sequence,
        type: value.type,
        gameTime,
        subjectIds: [...value.subjectIds],
        cause: structuredClone(value.cause),
        before: structuredClone(value.before ?? null),
        after: structuredClone(value.after ?? null)
    };
}

function worldEventId(sequence) {
    return `world-event-${String(sequence).padStart(6, '0')}`;
}

function clamp01(value) {
    if (!Number.isFinite(value)) throw new Error(`Cannot clamp non-finite value: ${value}`);
    return Math.max(0, Math.min(1, value));
}

function clampAttitude(value) {
    return Math.max(-1, Math.min(1, value));
}

function roundAttitude(value) {
    return Math.round(clampAttitude(value) * 1e6) / 1e6;
}

function clampInteger(value, minimum, maximum) {
    if (!Number.isFinite(value)) throw new Error(`Cannot clamp non-finite integer: ${value}`);
    return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function clampedInteger(value, minimum, maximum, label) {
    const number = sanitizeNonNegativeSafeInteger(value, label);
    if (number < minimum || number > maximum) {
        throw new Error(`${label} must be within ${minimum}-${maximum}.`);
    }
    return number;
}

function sanitizeUnitFloat(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 1) {
        throw new Error(`${label} must be a finite number within 0..1.`);
    }
    return number;
}

function sanitizePositiveInteger(value, label) {
    const number = sanitizeNonNegativeSafeInteger(value, label);
    if (number <= 0) throw new Error(`${label} must be a positive integer.`);
    return number;
}

function sanitizeNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new Error(`${label} must be a non-negative safe integer.`);
    }
    return number;
}

function sanitizeGameTime(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
        throw new Error(`${label} must be a non-negative finite number.`);
    }
    return number;
}

function assertExactIds(value, expected, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} registry must be an object.`);
    }
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    if (actual.length !== wanted.length || actual.some((id, index) => id !== wanted[index])) {
        const unknown = actual.find((id) => !wanted.includes(id));
        const missing = wanted.find((id) => !actual.includes(id));
        throw new Error(`Invalid ${label} ID: ${unknown ?? `missing ${missing}`}.`);
    }
}
