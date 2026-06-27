import {
    BOARDING_DERELICT_ID,
    BOARDING_LIMITS,
    BOARDING_LOG_ID,
    BOARDING_MISSION_ID,
    BOARDING_RECOVERY_REASONS,
    BOARDING_SYSTEM_ID,
    consumeBoardingOxygen,
    evaluateBoardingSecureGate,
    getBoardingDefinition
} from './boarding.js';
import { MISSION_DEFINITIONS, MISSION_STATUSES, OBJECTIVE_STATUSES } from './missions.js';
import { cloneRpgValue, sanitizeRpgState } from './state.js';
import { sanitizePlayerState } from '../player/playerState.js';

export class EvaBoardingRuntime {
    constructor({ slots, rpg, getGameTime = () => 0, now = () => new Date().toISOString() } = {}) {
        if (!slots) throw new Error('EvaBoardingRuntime requires a save-slot manager.');
        if (!rpg) throw new Error('EvaBoardingRuntime requires the RPG runtime.');
        this.slots = slots;
        this.rpg = rpg;
        this.getGameTime = getGameTime;
        this.now = now;
        this.activeSystemId = null;
        this.livePlayer = this._readPlayer();
        this.lastFeedback = null;
    }

    reload() {
        this.livePlayer = this._readPlayer();
        this.lastFeedback = null;
        return this.getState();
    }

    syncSystem(systemId) {
        if (systemId !== null && typeof systemId !== 'string') {
            throw new Error('Boarding system ID must be a string or null.');
        }
        this.activeSystemId = systemId;
        return this.getState();
    }

    getState() {
        const rpg = this.rpg.getState();
        return cloneRpgValue({
            available: true,
            definition: getBoardingDefinition(),
            activeSystemId: this.activeSystemId,
            progress: rpg.boarding.byId[BOARDING_DERELICT_ID],
            mission: this.rpg.getMission(BOARDING_MISSION_ID),
            player: this.livePlayer,
            feedback: this.lastFeedback
        });
    }

    discover(derelictId = BOARDING_DERELICT_ID, { systemId = this.activeSystemId } = {}) {
        this._definition(derelictId);
        if (systemId !== BOARDING_SYSTEM_ID) {
            throw new Error(
                `Boarding discovery requires authored system ${BOARDING_SYSTEM_ID}; received ${systemId ?? 'none'}.`
            );
        }
        const rpg = this.rpg.getState();
        const progress = rpg.boarding.byId[derelictId];
        if (progress.checkpoint !== 'undiscovered') {
            return { changed: false, reason: 'already-discovered', state: this.getState() };
        }
        const now = this.now();
        const mission = rpg.missions.byId[BOARDING_MISSION_ID];
        offerAndAcceptMission(mission, now);
        activateObjective(mission, 'secure_wayfarer_derelict', now);
        progress.checkpoint = 'approach';
        progress.discoveredAt = now;
        appendEvent(rpg, 'boarding.derelict.discovered', {
            encounterId: progress.id,
            derelictId,
            missionId: BOARDING_MISSION_ID,
            systemId
        }, now);
        this.lastFeedback = { type: 'boarding.discovered', derelictId };
        this._commit(rpg, this.livePlayer, 'boarding-derelict-discovered');
        return { changed: true, state: this.getState() };
    }

    evaluateDeparture(context = {}) {
        const progress = this.rpg.getState().boarding.byId[BOARDING_DERELICT_ID];
        if (progress.checkpoint === 'undiscovered') {
            return { allowed: false, reason: 'Lock the Wayfarer derelict navigation contact before EVA.' };
        }
        if (progress.checkpoint === 'completed') {
            return { allowed: false, reason: 'The Wayfarer derelict recovery is already complete.' };
        }
        if (this.livePlayer.location !== 'ship') {
            return { allowed: false, reason: `Player is already ${this.livePlayer.location}.` };
        }
        return evaluateBoardingSecureGate(context);
    }

    depart(player, context = {}) {
        const gate = this.evaluateDeparture(context);
        if (!gate.allowed) throw new Error(gate.reason);
        const nextPlayer = this._player(player, 'eva');
        const rpg = this.rpg.getState();
        const progress = rpg.boarding.byId[BOARDING_DERELICT_ID];
        const mission = rpg.missions.byId[BOARDING_MISSION_ID];
        assertAccepted(mission, 'Untethered EVA departure');
        const now = this.now();
        progress.checkpoint = 'outside';
        progress.departedAt ??= now;
        completeObjective(mission, 'secure_wayfarer_derelict', now);
        activateObjective(mission, 'board_wayfarer_derelict', now);
        appendEvent(rpg, 'boarding.player.departed', {
            encounterId: progress.id,
            derelictId: BOARDING_DERELICT_ID
        }, now);
        this.lastFeedback = { type: 'boarding.departed' };
        this._commit(rpg, nextPlayer, 'boarding-player-departed');
        return { changed: true, state: this.getState() };
    }

    enterDerelict(player, { distanceMetres } = {}) {
        const distance = finiteNonNegative(distanceMetres, 'Derelict hatch distance');
        if (distance > BOARDING_LIMITS.hatchRangeMetres) {
            throw new Error(
                `Derelict hatch is out of range: ${distance.toFixed(1)} m; ${BOARDING_LIMITS.hatchRangeMetres} m required.`
            );
        }
        const nextPlayer = this._player(player, 'derelict');
        const rpg = this.rpg.getState();
        const progress = rpg.boarding.byId[BOARDING_DERELICT_ID];
        if (progress.checkpoint !== 'outside') {
            throw new Error(`Derelict entry requires checkpoint outside; current checkpoint is ${progress.checkpoint}.`);
        }
        const mission = rpg.missions.byId[BOARDING_MISSION_ID];
        assertAccepted(mission, 'Derelict entry');
        const now = this.now();
        progress.checkpoint = 'inside';
        progress.enteredAt ??= now;
        completeObjective(mission, 'board_wayfarer_derelict', now);
        activateObjective(mission, 'recover_wayfarer_log', now);
        appendEvent(rpg, 'boarding.derelict.entered', {
            encounterId: progress.id,
            derelictId: BOARDING_DERELICT_ID
        }, now);
        this.lastFeedback = { type: 'boarding.entered' };
        this._commit(rpg, nextPlayer, 'boarding-derelict-entered');
        return { changed: true, state: this.getState() };
    }

    recoverLog(player, logId = BOARDING_LOG_ID, { distanceMetres } = {}) {
        if (logId !== BOARDING_LOG_ID) throw new Error(`Unknown boarding log ID: ${logId}`);
        const distance = finiteNonNegative(distanceMetres, 'Derelict log distance');
        if (distance > BOARDING_LIMITS.logRangeMetres) {
            throw new Error(
                `Derelict log is out of range: ${distance.toFixed(1)} m; ${BOARDING_LIMITS.logRangeMetres} m required.`
            );
        }
        const nextPlayer = this._player(player, 'derelict');
        const rpg = this.rpg.getState();
        const progress = rpg.boarding.byId[BOARDING_DERELICT_ID];
        if (progress.logRecoveredAt) {
            return { changed: false, reason: 'already-recovered', state: this.getState() };
        }
        if (progress.checkpoint !== 'inside') {
            throw new Error(`Log recovery requires checkpoint inside; current checkpoint is ${progress.checkpoint}.`);
        }
        const mission = rpg.missions.byId[BOARDING_MISSION_ID];
        assertAccepted(mission, 'Derelict log recovery');
        const now = this.now();
        progress.checkpoint = 'objective_complete';
        progress.logRecoveredAt = now;
        completeObjective(mission, 'recover_wayfarer_log', now);
        activateObjective(mission, 'return_from_wayfarer_derelict', now);
        appendEvent(rpg, 'boarding.log.recovered', {
            encounterId: progress.id,
            derelictId: BOARDING_DERELICT_ID,
            logId
        }, now);
        this.lastFeedback = { type: 'boarding.log.recovered', logId };
        this._commit(rpg, nextPlayer, 'boarding-log-recovered');
        return { changed: true, state: this.getState() };
    }

    exitDerelict(player, { distanceMetres } = {}) {
        const distance = finiteNonNegative(distanceMetres, 'Derelict hatch distance');
        if (distance > BOARDING_LIMITS.hatchRangeMetres) {
            throw new Error(
                `Derelict hatch is out of range: ${distance.toFixed(1)} m; ${BOARDING_LIMITS.hatchRangeMetres} m required.`
            );
        }
        const nextPlayer = this._player(player, 'eva');
        const rpg = this.rpg.getState();
        const progress = rpg.boarding.byId[BOARDING_DERELICT_ID];
        if (!['inside', 'objective_complete'].includes(progress.checkpoint)) {
            throw new Error(`Derelict exit is invalid from checkpoint ${progress.checkpoint}.`);
        }
        const now = this.now();
        const carryingLog = Boolean(progress.logRecoveredAt);
        progress.checkpoint = carryingLog ? 'returning' : 'outside';
        if (carryingLog) progress.returningAt ??= now;
        appendEvent(rpg, 'boarding.derelict.exited', {
            encounterId: progress.id,
            derelictId: BOARDING_DERELICT_ID,
            carryingLog
        }, now);
        this.lastFeedback = { type: 'boarding.exited', carryingLog };
        this._commit(rpg, nextPlayer, carryingLog ? 'boarding-player-returning' : 'boarding-player-exited');
        return { changed: true, state: this.getState() };
    }

    boardShip(player) {
        const nextPlayer = this._player(player, 'ship');
        const rpg = this.rpg.getState();
        const progress = rpg.boarding.byId[BOARDING_DERELICT_ID];
        if (progress.checkpoint === 'completed') {
            return { changed: false, reason: 'already-completed', state: this.getState() };
        }
        if (progress.checkpoint === 'returning') {
            return this._complete(rpg, nextPlayer, 'boarding-player-returned');
        }
        if (progress.checkpoint !== 'outside') {
            throw new Error(`Ship boarding is invalid from checkpoint ${progress.checkpoint}.`);
        }
        progress.checkpoint = 'approach';
        appendEvent(rpg, 'boarding.player.returned-empty', {
            encounterId: progress.id,
            derelictId: BOARDING_DERELICT_ID
        }, this.now());
        this.lastFeedback = { type: 'boarding.returned-empty' };
        this._commit(rpg, nextPlayer, 'boarding-returned-without-log');
        return { changed: true, completed: false, state: this.getState() };
    }

    recover(reason, player) {
        if (!BOARDING_RECOVERY_REASONS.includes(reason)) {
            throw new Error(`Unknown boarding recovery reason: ${reason}`);
        }
        const nextPlayer = this._player(player, 'ship');
        const rpg = this.rpg.getState();
        const progress = rpg.boarding.byId[BOARDING_DERELICT_ID];
        if (!['outside', 'inside', 'objective_complete', 'returning'].includes(progress.checkpoint)) {
            throw new Error(`Boarding recovery is unavailable from checkpoint ${progress.checkpoint}.`);
        }
        progress.recoveryCount += 1;
        progress.lastRecoveryReason = reason;
        appendEvent(rpg, 'boarding.player.recovered', {
            encounterId: progress.id,
            derelictId: BOARDING_DERELICT_ID,
            reason,
            carryingLog: Boolean(progress.logRecoveredAt)
        }, this.now());
        if (progress.logRecoveredAt) return this._complete(rpg, nextPlayer, `boarding-recovery-${reason}`);
        progress.checkpoint = 'approach';
        this.lastFeedback = { type: 'boarding.recovered', reason, completed: false };
        this._commit(rpg, nextPlayer, `boarding-recovery-${reason}`);
        return { changed: true, completed: false, reason, state: this.getState() };
    }

    updatePlayer(player, { gameTime = this.getGameTime(), distanceFromShip = 0 } = {}) {
        this.livePlayer = this._player(player, player.location);
        if (this.livePlayer.location === 'ship') return { recovered: false, state: this.getState() };
        const oxygen = consumeBoardingOxygen({
            remaining: this.livePlayer.oxygenRemaining,
            updatedAtGameTime: this.livePlayer.oxygenUpdatedAtGameTime
        }, gameTime);
        this.livePlayer = sanitizePlayerState({
            ...this.livePlayer,
            oxygenRemaining: oxygen.remaining,
            oxygenUpdatedAtGameTime: oxygen.updatedAtGameTime
        }, { gameTime });
        const distance = finiteNonNegative(distanceFromShip, 'Boarding ship range');
        if (oxygen.remaining <= 0) {
            return { recovered: true, result: this.recover('oxygen-depleted', aboardPlayer(gameTime)) };
        }
        if (distance > BOARDING_LIMITS.recoveryRangeMetres) {
            return { recovered: true, result: this.recover('range-exceeded', aboardPlayer(gameTime)) };
        }
        return { recovered: false, state: this.getState() };
    }

    checkpoint(player = this.livePlayer, reason = 'boarding-player-checkpoint') {
        const nextPlayer = this._player(player, player.location);
        const rpg = this.rpg.getState();
        this._commit(rpg, nextPlayer, reason);
        return this.getState();
    }

    setOxygenForDebug(value) {
        const amount = Number(value);
        if (!Number.isFinite(amount)) throw new Error('Debug oxygen must be finite.');
        this.livePlayer = sanitizePlayerState({
            ...this.livePlayer,
            oxygenRemaining: Math.max(0, Math.min(BOARDING_LIMITS.oxygenSeconds, amount)),
            oxygenUpdatedAtGameTime: this._gameTime()
        }, { gameTime: this._gameTime() });
        return this.checkpoint(this.livePlayer, 'debug-set-boarding-oxygen');
    }

    _complete(rpg, player, reason) {
        const progress = rpg.boarding.byId[BOARDING_DERELICT_ID];
        const mission = rpg.missions.byId[BOARDING_MISSION_ID];
        if (progress.checkpoint === 'completed') {
            return { changed: false, reason: 'already-completed', state: this.getState() };
        }
        if (!progress.logRecoveredAt) throw new Error('Boarding completion requires the recovered operations log.');
        assertAccepted(mission, 'Boarding completion');
        const now = this.now();
        progress.checkpoint = 'completed';
        progress.completedAt = now;
        completeObjective(mission, 'return_from_wayfarer_derelict', now);
        mission.objectives.currentObjectiveId = null;
        mission.status = MISSION_STATUSES.RESOLVED;
        mission.resolvedAt = now;
        mission.outcomeId = 'log_recovered';
        mission.lastBranchId = 'log_recovered';
        mission.updatedAt = now;
        Object.assign(rpg.worldFlags, cloneRpgValue(
            MISSION_DEFINITIONS[BOARDING_MISSION_ID].branches.log_recovered.worldFlags
        ));
        appendEvent(rpg, 'mission.resolved', {
            missionId: BOARDING_MISSION_ID,
            branchId: 'log_recovered',
            derelictId: BOARDING_DERELICT_ID,
            logId: BOARDING_LOG_ID
        }, now);
        appendEvent(rpg, 'mission.consequence', {
            missionId: BOARDING_MISSION_ID,
            branchId: 'log_recovered',
            worldFlags: cloneRpgValue(
                MISSION_DEFINITIONS[BOARDING_MISSION_ID].branches.log_recovered.worldFlags
            )
        }, now);
        this.lastFeedback = { type: 'boarding.completed', reason };
        this._commit(rpg, player, reason);
        return { changed: true, completed: true, state: this.getState() };
    }

    _definition(id) {
        return getBoardingDefinition(id);
    }

    _player(value, expectedLocation) {
        const gameTime = this._gameTime();
        const clean = sanitizePlayerState(value, { gameTime });
        if (clean.location !== expectedLocation) {
            throw new Error(`Boarding transition requires player location ${expectedLocation}; received ${clean.location}.`);
        }
        return clean;
    }

    _readPlayer() {
        const envelope = this.slots.getActiveEnvelope();
        return sanitizePlayerState(envelope.player, { gameTime: envelope.simulation.gameTime });
    }

    _commit(rpg, player, reason) {
        const activeSystemId = this.rpg.activeNamedSystemId;
        this.livePlayer = sanitizePlayerState(player, { gameTime: this._gameTime() });
        this.slots.saveDomains(
            {
                player: this.livePlayer,
                rpg: sanitizeRpgState(rpg),
                gameTime: this._gameTime()
            },
            { kind: 'auto', reason }
        );
        this.rpg.reload();
        this.rpg.setActiveNamedSystem(activeSystemId);
    }

    _gameTime() {
        return finiteNonNegative(this.getGameTime(), 'Boarding game time');
    }
}

function offerAndAcceptMission(mission, now) {
    if (mission.status === MISSION_STATUSES.UNAVAILABLE) {
        mission.status = MISSION_STATUSES.OFFERED;
        mission.offeredAt = now;
    }
    if (mission.status === MISSION_STATUSES.OFFERED) {
        mission.status = MISSION_STATUSES.ACCEPTED;
        mission.acceptedAt = now;
        mission.updatedAt = now;
        return;
    }
    if (mission.status !== MISSION_STATUSES.ACCEPTED) {
        throw new Error(`Boarding mission cannot be accepted from status ${mission.status}.`);
    }
}

function assertAccepted(mission, action) {
    if (mission.status !== MISSION_STATUSES.ACCEPTED) {
        throw new Error(`${action} requires an accepted boarding mission; current status is ${mission.status}.`);
    }
}

function activateObjective(mission, id, now) {
    const objective = mission.objectives.byId[id];
    if (!objective) throw new Error(`Unknown boarding mission objective ID: ${BOARDING_MISSION_ID}/${id}`);
    if (objective.status === OBJECTIVE_STATUSES.PENDING) {
        objective.status = OBJECTIVE_STATUSES.ACTIVE;
        objective.activatedAt = now;
    }
    mission.objectives.currentObjectiveId = id;
    mission.updatedAt = now;
}

function completeObjective(mission, id, now) {
    const objective = mission.objectives.byId[id];
    if (!objective) throw new Error(`Unknown boarding mission objective ID: ${BOARDING_MISSION_ID}/${id}`);
    objective.status = OBJECTIVE_STATUSES.COMPLETE;
    objective.completedAt ??= now;
    mission.updatedAt = now;
}

function appendEvent(rpg, type, payload, createdAt) {
    const nextNumber = rpg.eventLog.reduce((maximum, event) => {
        const value = Number(String(event.id).split('-').at(-1));
        return Number.isFinite(value) ? Math.max(maximum, value) : maximum;
    }, 0) + 1;
    rpg.eventLog.push({
        id: `event-${String(nextNumber).padStart(6, '0')}`,
        type,
        payload: cloneRpgValue(payload),
        createdAt
    });
}

function aboardPlayer(gameTime) {
    return {
        version: 1,
        location: 'ship',
        referenceFrame: 'ship-local',
        encounterId: null,
        position: [0, 0, 0],
        velocity: [0, 0, 0],
        yaw: 0,
        pitch: 0,
        oxygenRemaining: BOARDING_LIMITS.oxygenSeconds,
        oxygenUpdatedAtGameTime: gameTime
    };
}

function finiteNonNegative(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a non-negative finite number.`);
    return number;
}
