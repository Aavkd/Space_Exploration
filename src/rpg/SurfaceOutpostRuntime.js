import { cloneRpgValue, sanitizeRpgState } from './state.js';
import { MISSION_DEFINITIONS, MISSION_STATUSES, OBJECTIVE_STATUSES } from './missions.js';
import {
    SURFACE_MISSION_ID,
    SURFACE_OUTPOST_ID,
    getSurfacePoiDefinition,
    surfaceCheckpointIndex
} from './surfaceOutposts.js';

export class SurfaceOutpostRuntime {
    constructor({ slots, rpg, getGameTime = () => 0, now = () => new Date().toISOString() } = {}) {
        if (!slots) throw new Error('SurfaceOutpostRuntime requires a save-slot manager.');
        if (!rpg) throw new Error('SurfaceOutpostRuntime requires the RPG runtime.');
        this.slots = slots;
        this.rpg = rpg;
        this.getGameTime = getGameTime;
        this.now = now;
        this.context = emptyContext();
    }

    reload() {
        this.context = emptyContext();
        return this.getState();
    }

    getState() {
        const rpg = this.rpg.getState();
        return {
            definition: getSurfacePoiDefinition(SURFACE_OUTPOST_ID),
            progress: cloneRpgValue(rpg.surface.byId[SURFACE_OUTPOST_ID]),
            mission: this.rpg.getMission(SURFACE_MISSION_ID),
            context: cloneRpgValue(this.context)
        };
    }

    scan(poiId = SURFACE_OUTPOST_ID, { systemId, planetId } = {}) {
        const definition = this._definition(poiId);
        this._assertLocation(definition, systemId, planetId, 'Outpost scan');
        const rpg = this.rpg.getState();
        const progress = rpg.surface.byId[poiId];
        if (surfaceCheckpointIndex(progress.checkpoint) >= surfaceCheckpointIndex('orbit')) {
            return { changed: false, reason: 'already-discovered', state: this.getState() };
        }

        const now = this.now();
        const mission = rpg.missions.byId[SURFACE_MISSION_ID];
        offerAndAcceptMission(mission, now);
        completeObjective(mission, 'discover_k7_outpost', now);
        activateObjective(mission, 'land_at_k7_outpost', now);
        progress.checkpoint = 'orbit';
        progress.discoveredAt = now;
        appendEvent(rpg, 'surface.poi.discovered', {
            missionId: SURFACE_MISSION_ID,
            surfacePoiId: poiId,
            namedSystemId: systemId,
            planetId
        }, now);
        this.context = { ...this.context, systemId, planetId };
        this._commit(rpg, 'surface-outpost-discovered');
        return { changed: true, state: this.getState() };
    }

    syncContext({
        systemId = null,
        planetId = null,
        landed = false,
        withinLandingArea = false,
        playerState = 'walking'
    } = {}) {
        this.context = { systemId, planetId, landed: Boolean(landed), withinLandingArea: Boolean(withinLandingArea), playerState };
        const definition = getSurfacePoiDefinition(SURFACE_OUTPOST_ID);
        if (systemId !== definition.systemId || planetId !== definition.planetId) return this.getState();

        const rpg = this.rpg.getState();
        const progress = rpg.surface.byId[SURFACE_OUTPOST_ID];
        if (progress.checkpoint === 'undiscovered') return this.getState();
        const mission = rpg.missions.byId[SURFACE_MISSION_ID];
        if (mission.status !== MISSION_STATUSES.ACCEPTED) return this.getState();

        const now = this.now();
        let reason = null;
        if (!progress.visitedAt) {
            progress.visitedAt = now;
            appendEvent(rpg, 'surface.poi.visited', {
                missionId: SURFACE_MISSION_ID,
                surfacePoiId: SURFACE_OUTPOST_ID,
                planetId
            }, now);
            reason = 'surface-outpost-visited';
        }
        if (
            landed
            && withinLandingArea
            && surfaceCheckpointIndex(progress.checkpoint) < surfaceCheckpointIndex('landed')
        ) {
            progress.checkpoint = 'landed';
            progress.landedAt = now;
            completeObjective(mission, 'land_at_k7_outpost', now);
            activateObjective(mission, 'access_k7_surface_terminal', now);
            appendEvent(rpg, 'surface.poi.landed', {
                missionId: SURFACE_MISSION_ID,
                surfacePoiId: SURFACE_OUTPOST_ID,
                planetId
            }, now);
            reason = 'surface-outpost-landed';
        }
        if (
            playerState === 'surface'
            && surfaceCheckpointIndex(progress.checkpoint) === surfaceCheckpointIndex('landed')
        ) {
            progress.checkpoint = 'walking';
            appendEvent(rpg, 'surface.poi.disembarked', {
                missionId: SURFACE_MISSION_ID,
                surfacePoiId: SURFACE_OUTPOST_ID
            }, now);
            reason = 'surface-outpost-disembarked';
        }
        if (reason) this._commit(rpg, reason);
        return this.getState();
    }

    interact(poiId = SURFACE_OUTPOST_ID, { playerState, distanceMetres } = {}) {
        const definition = this._definition(poiId);
        const distance = Number(distanceMetres);
        if (playerState !== 'surface') {
            throw new Error('Surface terminal interaction requires the player to be walking on the surface.');
        }
        if (!Number.isFinite(distance) || distance > definition.interactionRadiusMetres) {
            throw new Error(
                `Surface terminal is out of range: ${Number.isFinite(distance) ? distance.toFixed(1) : 'unknown'} m; `
                + `${definition.interactionRadiusMetres} m required.`
            );
        }

        const rpg = this.rpg.getState();
        const progress = rpg.surface.byId[poiId];
        if (surfaceCheckpointIndex(progress.checkpoint) < surfaceCheckpointIndex('walking')) {
            throw new Error(`Surface terminal cannot be used from checkpoint ${progress.checkpoint}.`);
        }
        if (surfaceCheckpointIndex(progress.checkpoint) >= surfaceCheckpointIndex('objective_complete')) {
            return { changed: false, reason: 'already-verified', state: this.getState() };
        }
        const mission = rpg.missions.byId[SURFACE_MISSION_ID];
        assertMissionAccepted(mission, 'Surface terminal interaction');
        const now = this.now();
        progress.checkpoint = 'objective_complete';
        progress.interactedAt = now;
        completeObjective(mission, 'access_k7_surface_terminal', now);
        activateObjective(mission, 'return_to_ship', now);
        appendEvent(rpg, 'surface.terminal.verified', {
            missionId: SURFACE_MISSION_ID,
            surfacePoiId: poiId,
            terminalId: definition.terminalId
        }, now);
        this._commit(rpg, 'surface-terminal-verified');
        return { changed: true, state: this.getState() };
    }

    recordBoarded(poiId = SURFACE_OUTPOST_ID) {
        this._definition(poiId);
        const rpg = this.rpg.getState();
        const progress = rpg.surface.byId[poiId];
        if (surfaceCheckpointIndex(progress.checkpoint) < surfaceCheckpointIndex('objective_complete')) {
            throw new Error('Return cannot be recorded before the surface terminal objective is complete.');
        }
        if (surfaceCheckpointIndex(progress.checkpoint) >= surfaceCheckpointIndex('returned')) {
            return { changed: false, reason: 'already-returned', state: this.getState() };
        }
        const mission = rpg.missions.byId[SURFACE_MISSION_ID];
        assertMissionAccepted(mission, 'Return to ship');
        const now = this.now();
        progress.checkpoint = 'returned';
        progress.returnedAt = now;
        completeObjective(mission, 'return_to_ship', now);
        activateObjective(mission, 'report_k7_surface_survey', now);
        appendEvent(rpg, 'surface.player.returned', {
            missionId: SURFACE_MISSION_ID,
            surfacePoiId: poiId
        }, now);
        this._commit(rpg, 'surface-player-returned');
        return { changed: true, state: this.getState() };
    }

    report(poiId = SURFACE_OUTPOST_ID) {
        this._definition(poiId);
        const rpg = this.rpg.getState();
        const progress = rpg.surface.byId[poiId];
        if (progress.checkpoint === 'completed') {
            return { changed: false, reason: 'already-completed', state: this.getState() };
        }
        if (progress.checkpoint !== 'returned') {
            throw new Error(`Surface survey report requires checkpoint returned; current checkpoint is ${progress.checkpoint}.`);
        }
        const mission = rpg.missions.byId[SURFACE_MISSION_ID];
        assertMissionAccepted(mission, 'Surface survey report');
        const now = this.now();
        completeObjective(mission, 'report_k7_surface_survey', now);
        mission.objectives.currentObjectiveId = null;
        mission.status = MISSION_STATUSES.RESOLVED;
        mission.resolvedAt = now;
        mission.outcomeId = 'survey_reported';
        mission.lastBranchId = 'survey_reported';
        mission.updatedAt = now;
        progress.checkpoint = 'completed';
        progress.completedAt = now;
        const branch = MISSION_DEFINITIONS[SURFACE_MISSION_ID].branches.survey_reported;
        Object.assign(rpg.worldFlags, cloneRpgValue(branch.worldFlags));
        appendEvent(rpg, 'mission.resolved', {
            missionId: SURFACE_MISSION_ID,
            branchId: 'survey_reported',
            namedSystemId: 'index_hq',
            surfacePoiId: poiId
        }, now);
        appendEvent(rpg, 'mission.consequence', {
            missionId: SURFACE_MISSION_ID,
            branchId: 'survey_reported',
            worldFlags: cloneRpgValue(branch.worldFlags)
        }, now);
        this._commit(rpg, 'surface-survey-reported');
        return { changed: true, state: this.getState() };
    }

    _definition(id) {
        return getSurfacePoiDefinition(id);
    }

    _assertLocation(definition, systemId, planetId, action) {
        if (systemId !== definition.systemId || planetId !== definition.planetId) {
            throw new Error(
                `${action} requires ${definition.systemId}/${definition.planetId}; `
                + `received ${systemId ?? 'none'}/${planetId ?? 'none'}.`
            );
        }
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

function emptyContext() {
    return { systemId: null, planetId: null, landed: false, withinLandingArea: false, playerState: 'walking' };
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
        activateObjective(mission, 'discover_k7_outpost', now);
        return;
    }
    if (mission.status !== MISSION_STATUSES.ACCEPTED) {
        throw new Error(`Surface mission cannot be accepted from status ${mission.status}.`);
    }
}

function assertMissionAccepted(mission, action) {
    if (mission.status !== MISSION_STATUSES.ACCEPTED) {
        throw new Error(`${action} requires an accepted surface mission; current status is ${mission.status}.`);
    }
}

function activateObjective(mission, id, now) {
    const objective = mission.objectives.byId[id];
    if (!objective) throw new Error(`Unknown surface mission objective ID: ${SURFACE_MISSION_ID}/${id}`);
    if (objective.status === OBJECTIVE_STATUSES.PENDING) {
        objective.status = OBJECTIVE_STATUSES.ACTIVE;
        objective.activatedAt = now;
    }
    mission.objectives.currentObjectiveId = id;
}

function completeObjective(mission, id, now) {
    const objective = mission.objectives.byId[id];
    if (!objective) throw new Error(`Unknown surface mission objective ID: ${SURFACE_MISSION_ID}/${id}`);
    objective.status = OBJECTIVE_STATUSES.COMPLETE;
    objective.completedAt = now;
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
