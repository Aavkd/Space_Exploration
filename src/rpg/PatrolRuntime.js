import {
    PATROL_WORLD_SEED,
    classifyReputation,
    createCargoFingerprint,
    createPatrolEncounterId,
    evaluatePatrolPolicy,
    getFactionTerritoryPolicy,
    queryFactionInfluence,
    scanCargoLegality
} from './factionTerritory.js';
import {
    MAX_PATROL_HISTORY,
    createInitialPatrolState,
    sanitizePatrolState
} from './patrols.js';
import { cloneRpgValue, sanitizeRpgState } from './state.js';

export const PATROL_PHASE_DURATIONS = Object.freeze({
    spawn: 0.25,
    approach: 5,
    hail: 1,
    wait: 60,
    depart: 8,
    abort: 1
});

export class PatrolRuntime {
    constructor({
        slots,
        rpg,
        getGameTime = () => 0,
        now = () => new Date().toISOString(),
        worldSeed = PATROL_WORLD_SEED
    } = {}) {
        if (!slots) throw new Error('PatrolRuntime requires a save-slot manager.');
        if (!rpg) throw new Error('PatrolRuntime requires the RPG runtime.');
        this.slots = slots;
        this.rpg = rpg;
        this.getGameTime = getGameTime;
        this.now = now;
        this.worldSeed = String(worldSeed);
        sanitizePatrolState(this.rpg.getState().patrol);
    }

    reload() {
        return this.getState();
    }

    getState() {
        const rpg = this.rpg.getState();
        return {
            patrol: sanitizePatrolState(rpg.patrol),
            activeEncounter: cloneRpgValue(rpg.patrol.activeEncounter)
        };
    }

    getInfluence(systemId) {
        return queryFactionInfluence({ systemId, rpgState: this.rpg.getState() });
    }

    syncSystem(systemId) {
        const rpg = this.rpg.getState();
        const patrol = sanitizePatrolState(rpg.patrol);
        let territorySystemId = null;
        if (systemId !== null && systemId !== undefined && systemId !== '') {
            const influence = queryFactionInfluence({ systemId, rpgState: rpg });
            territorySystemId = influence.patrolEnabled ? systemId : null;
        } else {
            systemId = null;
        }
        if (patrol.presenceSystemId === territorySystemId) return this.getState();

        if (patrol.activeEncounter) {
            this._setTerminal(patrol.activeEncounter, 'abort', 'aborted', this.getGameTime());
            appendEvent(rpg, 'patrol.aborted', encounterPayload(patrol.activeEncounter, {
                reason: 'left-faction-territory'
            }), this.now());
            patrol.history.push(cloneRpgValue(patrol.activeEncounter));
            patrol.history = patrol.history.slice(-MAX_PATROL_HISTORY);
            patrol.activeEncounter = null;
        }
        patrol.presenceSystemId = territorySystemId;

        if (territorySystemId) {
            const influence = queryFactionInfluence({ systemId: territorySystemId, rpgState: rpg });
            if (influence.patrolEnabled) {
                patrol.activeEncounter = this._createEncounter(rpg, patrol, influence.policyId);
                patrol.nextSequence += 1;
                appendEvent(rpg, 'patrol.spawned', encounterPayload(patrol.activeEncounter), this.now());
            }
        }
        rpg.patrol = patrol;
        this._commit(rpg, territorySystemId ? 'patrol-territory-entered' : 'patrol-territory-exited');
        return this.getState();
    }

    update(gameTime = this.getGameTime()) {
        const time = sanitizeRuntimeTime(gameTime);
        const rpg = this.rpg.getState();
        const patrol = sanitizePatrolState(rpg.patrol);
        const encounter = patrol.activeEncounter;
        if (!encounter) return this.getState();
        let changed = false;
        let archived = false;

        while (encounter && !archived) {
            const elapsed = time - encounter.phaseStartedAtGameTime;
            const duration = PATROL_PHASE_DURATIONS[encounter.phase];
            if (elapsed < duration) break;
            const transitionTime = encounter.phaseStartedAtGameTime + duration;
            if (encounter.phase === 'spawn') {
                this._transition(encounter, 'approach', transitionTime);
            } else if (encounter.phase === 'approach') {
                this._transition(encounter, 'hail', transitionTime);
            } else if (encounter.phase === 'hail') {
                this._transition(encounter, 'wait', transitionTime);
                encounter.responseDeadlineGameTime = transitionTime + PATROL_PHASE_DURATIONS.wait;
            } else if (encounter.phase === 'wait') {
                this._setTerminal(encounter, 'depart', 'ignored_hail', encounter.responseDeadlineGameTime);
            } else {
                patrol.history.push(cloneRpgValue(encounter));
                patrol.history = patrol.history.slice(-MAX_PATROL_HISTORY);
                patrol.activeEncounter = null;
                archived = true;
            }
            appendEvent(rpg, archived ? 'patrol.despawned' : 'patrol.phase.changed', encounterPayload(encounter), this.now());
            changed = true;
        }
        if (changed) {
            rpg.patrol = patrol;
            this._commit(rpg, archived ? 'patrol-despawned' : 'patrol-phase-changed');
        }
        return this.getState();
    }

    acknowledgeHail() {
        const { rpg, patrol, encounter } = this._mutableWaitingEncounter('Patrol hail acknowledgement');
        const evaluation = evaluatePatrolPolicy({
            reputationBand: encounter.reputationBand,
            cargoScan: encounter.cargoScan
        });
        if (evaluation.requiresScan) {
            encounter.scanPending = true;
            appendEvent(rpg, 'patrol.scan.requested', encounterPayload(encounter), this.now());
        } else {
            this._setTerminal(encounter, 'depart', evaluation.action, this.getGameTime());
            appendEvent(rpg, 'patrol.outcome', encounterPayload(encounter), this.now());
        }
        rpg.patrol = patrol;
        this._commit(rpg, evaluation.requiresScan ? 'patrol-scan-requested' : `patrol-${evaluation.action}`);
        return this.getState();
    }

    submitCargoScan() {
        const { rpg, patrol, encounter } = this._mutableWaitingEncounter('Patrol cargo scan');
        if (!encounter.scanPending) throw new Error('Patrol cargo scan was not requested.');
        const outcomeId = encounter.cargoScan.status === 'contraband'
            ? 'warning_refusal'
            : 'inspection_clear';
        encounter.scanPending = false;
        this._setTerminal(encounter, 'depart', outcomeId, this.getGameTime());
        appendEvent(rpg, 'patrol.scan.completed', encounterPayload(encounter), this.now());
        appendEvent(rpg, 'patrol.outcome', encounterPayload(encounter), this.now());
        rpg.patrol = patrol;
        this._commit(rpg, `patrol-${outcomeId}`);
        return this.getState();
    }

    ignoreHail() {
        const { rpg, patrol, encounter } = this._mutableWaitingEncounter('Ignore patrol hail');
        this._setTerminal(encounter, 'depart', 'ignored_hail', this.getGameTime());
        appendEvent(rpg, 'patrol.outcome', encounterPayload(encounter), this.now());
        rpg.patrol = patrol;
        this._commit(rpg, 'patrol-ignored-hail');
        return this.getState();
    }

    abort(reason = 'manual-abort') {
        const rpg = this.rpg.getState();
        const patrol = sanitizePatrolState(rpg.patrol);
        const encounter = patrol.activeEncounter;
        if (!encounter) return { changed: false, ...this.getState() };
        this._setTerminal(encounter, 'abort', 'aborted', this.getGameTime());
        appendEvent(rpg, 'patrol.aborted', encounterPayload(encounter, { reason }), this.now());
        rpg.patrol = patrol;
        this._commit(rpg, 'patrol-aborted');
        return { changed: true, ...this.getState() };
    }

    _createEncounter(rpg, patrol, policyId) {
        const policy = getFactionTerritoryPolicy(policyId);
        const sequence = patrol.nextSequence;
        const gameTime = sanitizeRuntimeTime(this.getGameTime());
        const reputationSnapshot = Number(rpg.factions.byId[policy.factionId]?.reputation);
        const previousBand = [...patrol.history].reverse()
            .find((entry) => entry.factionId === policy.factionId)?.reputationBand ?? null;
        const reputationBand = classifyReputation(reputationSnapshot, previousBand);
        const ship = this.slots.getActiveEnvelope().ship;
        const cargoFingerprint = createCargoFingerprint(ship);
        const cargoScan = scanCargoLegality(ship, policy.id);
        return {
            id: createPatrolEncounterId({
                worldSeed: this.worldSeed,
                policyId: policy.id,
                systemId: policy.systemId,
                sequence,
                gameTime,
                reputationSnapshot,
                cargoFingerprint
            }),
            policyId: policy.id,
            agentId: policy.agentId,
            systemId: policy.systemId,
            factionId: policy.factionId,
            sequence,
            phase: 'spawn',
            outcomeId: null,
            reputationSnapshot,
            reputationBand,
            cargoFingerprint,
            cargoScan,
            spawnedAtGameTime: gameTime,
            phaseStartedAtGameTime: gameTime,
            responseDeadlineGameTime: null,
            scanPending: false
        };
    }

    _mutableWaitingEncounter(action) {
        const rpg = this.rpg.getState();
        const patrol = sanitizePatrolState(rpg.patrol);
        const encounter = patrol.activeEncounter;
        if (!encounter) throw new Error(`${action} requires an active patrol encounter.`);
        if (!['hail', 'wait'].includes(encounter.phase)) {
            throw new Error(`${action} requires patrol phase hail or wait; current phase is ${encounter.phase}.`);
        }
        return { rpg, patrol, encounter };
    }

    _transition(encounter, phase, gameTime) {
        encounter.phase = phase;
        encounter.phaseStartedAtGameTime = gameTime;
    }

    _setTerminal(encounter, phase, outcomeId, gameTime) {
        encounter.phase = phase;
        encounter.outcomeId = outcomeId;
        encounter.phaseStartedAtGameTime = sanitizeRuntimeTime(gameTime);
        encounter.responseDeadlineGameTime = null;
        encounter.scanPending = false;
    }

    _commit(rpg, reason) {
        const activeSystemId = this.rpg.activeNamedSystemId;
        this.slots.saveDomains(
            { rpg: sanitizeRpgState(rpg), gameTime: this.getGameTime() },
            { kind: 'auto', reason }
        );
        this.rpg.reload();
        this.rpg.setActiveNamedSystem(activeSystemId);
    }
}

function encounterPayload(encounter, extra = {}) {
    return {
        encounterId: encounter.id,
        agentId: encounter.agentId,
        policyId: encounter.policyId,
        factionId: encounter.factionId,
        namedSystemId: encounter.systemId,
        phase: encounter.phase,
        outcomeId: encounter.outcomeId,
        ...extra
    };
}

function appendEvent(rpg, type, payload, now) {
    const nextNumber = rpg.eventLog.reduce((maximum, event) => {
        const value = Number(String(event.id).split('-').at(-1));
        return Number.isFinite(value) ? Math.max(maximum, value) : maximum;
    }, 0) + 1;
    rpg.eventLog.push({
        id: `event-${String(nextNumber).padStart(6, '0')}`,
        type,
        payload: cloneRpgValue(payload),
        createdAt: now
    });
}

function sanitizeRuntimeTime(value) {
    const time = Number(value);
    if (!Number.isFinite(time) || time < 0) throw new Error('Patrol game time must be a non-negative finite number.');
    return time;
}
