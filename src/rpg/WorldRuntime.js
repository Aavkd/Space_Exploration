// Phase 23 — WorldRuntime.
//
// A pure *view and command source* over the headless `simWorld` substrate. It
// owns no simulation logic: it reads the authoritative `simulation.world` facet
// from the save slots, advances it through the deterministic core on accumulated
// Phase 13 `gameTime`, stages player interventions as tick-input commands, and
// commits via the same `saveDomains` transaction the rest of the RPG uses.
//
// Mirrors EconomyRuntime so an RPG/sim failure can never stop flight or render.

import {
    MAX_WORLD_TICKS_PER_UPDATE,
    WORLD_FACTION_IDS,
    WORLD_TICK_SECONDS,
    advanceWorld,
    enforceEmbodiedBudget,
    enforceSimulatedBudget,
    foldAgents,
    getEntityLod,
    getWorldTerritory,
    materializeAgents,
    sanitizeWorldState,
    setEntityLod
} from './simWorld.js';

export class WorldRuntime {
    constructor({ slots, getGameTime = () => 0 } = {}) {
        if (!slots) throw new Error('WorldRuntime requires a save-slot manager.');
        this.slots = slots;
        this.getGameTime = getGameTime;
        this.pendingCommands = [];
        this._commandSequence = 0;
        this._read();
    }

    reload() {
        this.pendingCommands = [];
        this._read();
        return this.getState();
    }

    getState() {
        const world = this.getWorld();
        return {
            world,
            territory: getWorldTerritory(world),
            lod: this.getLodMap(),
            pendingCommandCount: this.pendingCommands.length
        };
    }

    getWorld() {
        const envelope = this.slots.getActiveEnvelope();
        return sanitizeWorldState(envelope.simulation.world, {
            gameTime: envelope.simulation.gameTime
        });
    }

    getFaction(id) {
        const faction = this.getWorld().factions.byId[id];
        if (!faction) throw new Error(`Unknown world faction ID: ${id}`);
        return faction;
    }

    getRelationships() {
        return this.getWorld().relationships;
    }

    getLod(entityId) {
        return getEntityLod(this.getWorld(), entityId);
    }

    getLodMap() {
        const world = this.getWorld();
        const map = {};
        for (const id of WORLD_FACTION_IDS) map[id] = world.lod.byEntityId[id].tier;
        return map;
    }

    getTerritory() {
        return getWorldTerritory(this.getWorld());
    }

    getEvents({ since = 0, limit = 200, newestFirst = false } = {}) {
        const sinceSequence = Math.max(0, Math.floor(Number(since) || 0));
        const boundedLimit = Math.max(0, Math.min(MAX_WORLD_TICKS_PER_UPDATE, Math.floor(Number(limit) || 0)));
        let events = this.getWorld().events.filter((event) => event.sequence > sinceSequence);
        if (newestFirst) events = [...events].reverse();
        return events.slice(0, boundedLimit);
    }

    update(gameTime = this.getGameTime()) {
        const envelope = this.slots.getActiveEnvelope();
        const rawLastTick = Number(envelope.simulation.world?.lastTickGameTime);
        const hasCommands = this.pendingCommands.length > 0;
        if (
            !hasCommands
            && Number.isFinite(rawLastTick)
            && gameTime >= rawLastTick
            && gameTime - rawLastTick < WORLD_TICK_SECONDS
        ) {
            return { changed: false, ticksApplied: 0, events: [] };
        }
        const { world, ticksApplied, events } = advanceWorld(envelope.simulation.world, gameTime, {
            commands: this.pendingCommands
        });
        this.pendingCommands = [];
        if (ticksApplied <= 0 && events.length === 0) {
            return { changed: false, ticksApplied: 0, events: [] };
        }
        this._commit(world, 'world-tick');
        return { changed: true, ticksApplied, events, state: this.getState() };
    }

    // The only intervention input: a command changes a *tick input* (here, the
    // forced attitude between two factions) — never a scripted outcome. It is
    // applied at the current game time and produces a stable `command.applied`
    // event whose downstream history diverges deterministically.
    enqueueCommand(command) {
        if (!command || typeof command !== 'object') {
            throw new Error('World command must be an object.');
        }
        const gameTime = Number(this.getGameTime());
        this._commandSequence += 1;
        const id = `world-command-${String(this._commandSequence).padStart(4, '0')}`;
        this.pendingCommands.push({
            id,
            type: command.type,
            a: command.a,
            b: command.b,
            gameTime: Number.isFinite(gameTime) && gameTime >= 0 ? gameTime : 0
        });
        return this.update(gameTime);
    }

    setLod(entityId, tier) {
        const envelope = this.slots.getActiveEnvelope();
        const world = setEntityLod(envelope.simulation.world, entityId, tier, {
            gameTime: this.getGameTime()
        });
        this._commit(world, `lod-${tier}`);
        return this.getState();
    }

    promote(entityId, tier) {
        return this.setLod(entityId, tier);
    }

    demote(entityId, tier) {
        return this.setLod(entityId, tier);
    }

    enforceEmbodiedBudget(interestById = {}, options = {}) {
        const envelope = this.slots.getActiveEnvelope();
        const world = enforceEmbodiedBudget(envelope.simulation.world, interestById, {
            ...options,
            gameTime: this.getGameTime()
        });
        this._commit(world, 'lod-budget');
        return this.getState();
    }

    enforceSimulatedBudget(interestById = {}, options = {}) {
        const envelope = this.slots.getActiveEnvelope();
        const world = enforceSimulatedBudget(envelope.simulation.world, interestById, {
            ...options,
            gameTime: this.getGameTime()
        });
        this._commit(world, 'lod-budget');
        return this.getState();
    }

    // Reversible promotion round trip (no intervening sim is a no-op): derive
    // concrete agents from the L1 aggregates, then fold them back.
    materialize(entityId) {
        const world = this.getWorld();
        return materializeAgents(world.factions.byId[entityId], world.seed);
    }

    foldback(materialized) {
        return foldAgents(materialized);
    }

    // Debug-only seeded invariant soak. Runs entirely in memory and never
    // commits, so it cannot inject world time (locked rule 4).
    soak(tickCount = 100000, { chunk = 1000 } = {}) {
        const cappedChunk = Math.max(1, Math.min(MAX_WORLD_TICKS_PER_UPDATE, Math.floor(chunk)));
        const totalTicks = Math.max(0, Math.floor(Number(tickCount) || 0));
        let world = this.getWorld();
        let time = world.lastTickGameTime;
        let processed = 0;
        let ok = true;
        while (processed < totalTicks) {
            const step = Math.min(cappedChunk, totalTicks - processed);
            time += step * WORLD_TICK_SECONDS;
            world = advanceWorld(world, time, { maxTicks: step }).world;
            processed += step;
        }
        for (const id of WORLD_FACTION_IDS) {
            const aggregates = world.factions.byId[id].aggregates;
            ok &&= Number.isSafeInteger(aggregates.population) && aggregates.population >= 0
                && Number.isSafeInteger(aggregates.wealth) && aggregates.wealth >= 0
                && Number.isFinite(aggregates.stability) && aggregates.stability >= 0 && aggregates.stability <= 1
                && Number.isFinite(aggregates.controlProgress);
        }
        return {
            ok,
            seed: world.seed,
            ticks: processed,
            lastTickGameTime: world.lastTickGameTime,
            eventCount: world.events.length,
            factions: Object.fromEntries(
                WORLD_FACTION_IDS.map((id) => [id, structuredClone(world.factions.byId[id].aggregates)])
            )
        };
    }

    _read() {
        const envelope = this.slots.getActiveEnvelope();
        return sanitizeWorldState(envelope.simulation.world, {
            gameTime: envelope.simulation.gameTime
        });
    }

    _commit(world, reason) {
        return this.slots.saveDomains(
            {
                world: sanitizeWorldState(world, { gameTime: this.getGameTime() }),
                gameTime: this.getGameTime()
            },
            { kind: 'auto', reason }
        );
    }
}
