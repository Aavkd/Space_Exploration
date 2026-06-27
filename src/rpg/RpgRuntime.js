import { LocalRpgPersistence } from './persistence.js';
import {
    clampReputation,
    cloneRpgValue,
    createRpgSummary,
    sanitizeRpgState
} from './state.js';
import { CONTACT_DEFINITIONS, CONTACT_IDS } from './contacts.js';
import {
    MISSION_DEFINITIONS,
    MISSION_IDS,
    MISSION_STATUSES,
    OBJECTIVE_STATUSES
} from './missions.js';

export class RpgRuntime {
    constructor({ persistence = new LocalRpgPersistence(), now = () => new Date().toISOString() } = {}) {
        this.persistence = persistence;
        this.now = now;
        this.state = this.persistence.load();
        this.activeNamedSystemId = null;
    }

    getState() {
        return cloneRpgValue(this.state);
    }

    getSummary() {
        return {
            ...createRpgSummary(this.state, { activeNamedSystemId: this.activeNamedSystemId }),
            activeNamedSystem: this.getActiveNamedSystem()
        };
    }

    getNamedSystem(id) {
        return cloneRpgValue(this._getNamedSystemRef(id));
    }

    getActiveNamedSystem() {
        if (!this.activeNamedSystemId) return null;
        return this.getNamedSystem(this.activeNamedSystemId);
    }

    setActiveNamedSystem(id) {
        if (id === null || id === undefined || id === '') {
            this.activeNamedSystemId = null;
            return null;
        }

        const system = this._getNamedSystemRef(id);
        this.activeNamedSystemId = system.id;
        return cloneRpgValue(system);
    }

    getContacts() {
        return CONTACT_IDS.map((id) => this.getContact(id));
    }

    getAvailableContacts() {
        return this.getContacts().filter((contact) => contact.available);
    }

    getContact(id) {
        const definition = this._getContactDefinitionRef(id);
        const state = this._getContactStateRef(id);
        return cloneRpgValue({
            id: definition.id,
            type: definition.type,
            name: definition.name,
            title: definition.title,
            factionId: definition.factionId,
            civTier: definition.civTier,
            namedSystemId: definition.namedSystemId,
            available: this._isContactAvailable(definition, state),
            state,
            node: this._createConversationNodeView(definition, state.conversation.nodeId),
            llmFlavor: this._getLlmFlavorStub()
        });
    }

    getCommsState() {
        const availableContacts = this.getAvailableContacts();
        const activeContactId = this.state.comms.activeContactId;
        const activeContact = activeContactId ? this.getContact(activeContactId) : null;
        const activeAvailable = Boolean(activeContact?.available);
        const activeNode = activeAvailable ? activeContact.node : null;
        return cloneRpgValue({
            activeNamedSystemId: this.activeNamedSystemId,
            availableContacts,
            activeContactId,
            activeContact: activeAvailable ? activeContact : null,
            conversationNodeId: activeAvailable ? activeContact.state.conversation.nodeId : null,
            visibleChoices: activeNode?.choices ?? [],
            llmFlavor: this._getLlmFlavorStub()
        });
    }

    startConversation(contactId = null) {
        const id = contactId ?? this.getAvailableContacts()[0]?.id;
        if (!id) return this.getCommsState();

        const definition = this._getContactDefinitionRef(id);
        const contact = this._getContactStateRef(id);
        if (!this._isContactAvailable(definition, contact)) {
            throw new Error(`RPG contact is not available in the current context: ${id}`);
        }

        if (!definition.nodes[contact.conversation.nodeId]) {
            contact.conversation.nodeId = definition.initialNodeId;
        }

        const firstStart = !contact.conversation.startedAt;
        const now = this.now();
        if (firstStart) contact.conversation.startedAt = now;
        contact.conversation.updatedAt = now;
        this.state.comms.activeContactId = id;
        if (firstStart) {
            this._appendEventRef('comms.conversation.started', {
                contactId: id,
                namedSystemId: this.activeNamedSystemId
            });
        }
        this._touch();
        this.save();
        return this.getCommsState();
    }

    chooseDialogue(choiceId) {
        const contactId = this.state.comms.activeContactId;
        if (!contactId) throw new Error('No active RPG comms conversation.');

        const definition = this._getContactDefinitionRef(contactId);
        const contact = this._getContactStateRef(contactId);
        if (!this._isContactAvailable(definition, contact)) {
            throw new Error(`RPG contact is not available in the current context: ${contactId}`);
        }

        const node = this._createConversationNodeView(definition, contact.conversation.nodeId);
        const choice = node.choices.find((entry) => entry.id === choiceId);
        if (!choice) throw new Error(`Unknown RPG dialogue choice ID: ${choiceId}`);

        const previousNodeId = contact.conversation.nodeId;
        const missionActionResult = choice.missionAction
            ? this._applyMissionActionRef(choice.missionAction)
            : null;
        const nextNodeId = this._resolveChoiceNextNodeId(choice);
        if (nextNodeId) {
            contact.conversation.nodeId = this._getConversationNode(definition, nextNodeId).id;
        }
        contact.conversation.lastChoiceId = choice.id;
        contact.conversation.choiceCount += 1;
        contact.conversation.updatedAt = this.now();
        this._appendEventRef('comms.dialogue.choice', {
            contactId,
            choiceId: choice.id,
            previousNodeId,
            nextNodeId: contact.conversation.nodeId,
            missionActionResult,
            closed: Boolean(choice.close)
        });
        if (choice.close) this.state.comms.activeContactId = null;
        this._touch();
        this.save();
        return this.getCommsState();
    }

    exitConversation() {
        this.state.comms.activeContactId = null;
        this._touch();
        this.save();
        return this.getCommsState();
    }

    setCommsLlmFlavorEnabled(enabled) {
        this.state.comms.llmFlavorEnabled = Boolean(enabled);
        this._touch();
        this.save();
        return this.getCommsState();
    }

    getFaction(id) {
        return cloneRpgValue(this._getFactionRef(id));
    }

    getReputation(id) {
        return this._getFactionRef(id).reputation;
    }

    setReputation(id, value, reason = 'unspecified') {
        const faction = this._getFactionRef(id);
        const previous = faction.reputation;
        const next = clampReputation(Number(value));
        faction.reputation = next;
        this._touch();
        const event = this._appendEventRef('reputation.changed', {
            factionId: id,
            previous,
            next,
            delta: next - previous,
            reason
        });
        this.save();
        return cloneRpgValue(event);
    }

    adjustReputation(id, delta, reason = 'unspecified') {
        const current = this.getReputation(id);
        return this.setReputation(id, current + Number(delta), reason);
    }

    getMissions() {
        return MISSION_IDS.map((id) => this.getMission(id));
    }

    getMission(id) {
        const definition = this._getMissionDefinitionRef(id);
        const state = this._getMissionStateRef(id);
        return cloneRpgValue({
            id: definition.id,
            name: definition.name,
            description: definition.description,
            contactId: definition.contactId,
            namedSystemId: definition.namedSystemId,
            branches: definition.branches,
            failureOutcomes: definition.failureOutcomes,
            objectives: definition.objectives ?? {},
            state
        });
    }

    offerMission(id) {
        const result = this._offerMissionRef(id);
        this._touch();
        this.save();
        return cloneRpgValue(result);
    }

    acceptMission(id) {
        const result = this._acceptMissionRef(id);
        this._touch();
        this.save();
        return cloneRpgValue(result);
    }

    failMission(id, outcomeId = 'declined') {
        const result = this._failMissionRef(id, outcomeId);
        this._touch();
        this.save();
        return cloneRpgValue(result);
    }

    resolveMission(id, branchId) {
        const result = this._resolveMissionRef(id, branchId);
        this._touch();
        this.save();
        return cloneRpgValue(result);
    }

    appendEvent(type, payload = {}) {
        const event = this._appendEventRef(type, payload);
        this._touch();
        this.save();
        return cloneRpgValue(event);
    }

    queryEvents({ type = null, missionId = null, factionId = null, limit = 100, newestFirst = false } = {}) {
        if (type !== null && (typeof type !== 'string' || !type)) {
            throw new Error('RPG event query type must be a non-empty string or null.');
        }
        const boundedLimit = Math.max(0, Math.min(500, Math.floor(Number(limit) || 0)));
        let entries = this.state.eventLog.filter((entry) => (
            (type === null || entry.type === type)
            && (missionId === null || entry.payload?.missionId === missionId)
            && (factionId === null || entry.payload?.factionId === factionId)
        ));
        if (newestFirst) entries = [...entries].reverse();
        return cloneRpgValue(entries.slice(0, boundedLimit));
    }

    save() {
        this.state = this.persistence.save(this.state);
        return this.getState();
    }

    replaceState(state, reason = 'authoritative-rpg-change') {
        this.state = sanitizeRpgState(state);
        this.state = this.persistence.save(this.state, reason);
        return this.getState();
    }

    reload() {
        this.state = this.persistence.load();
        this.activeNamedSystemId = null;
        return this.getState();
    }

    reset() {
        this.state = this.persistence.reset();
        this.activeNamedSystemId = null;
        return this.getState();
    }

    _getFactionRef(id) {
        const faction = this.state.factions.byId[id];
        if (!faction) throw new Error(`Unknown RPG faction ID: ${id}`);
        return faction;
    }

    _getNamedSystemRef(id) {
        const system = this.state.namedSystems.byId[id];
        if (!system) throw new Error(`Unknown RPG named system ID: ${id}`);
        return system;
    }

    _getContactDefinitionRef(id) {
        const contact = CONTACT_DEFINITIONS[id];
        if (!contact) throw new Error(`Unknown RPG contact ID: ${id}`);
        return contact;
    }

    _getContactStateRef(id) {
        const contact = this.state.contacts.byId[id];
        if (!contact) throw new Error(`Unknown RPG contact state ID: ${id}`);
        return contact;
    }

    _getMissionDefinitionRef(id) {
        const mission = MISSION_DEFINITIONS[id];
        if (!mission) throw new Error(`Unknown RPG mission ID: ${id}`);
        return mission;
    }

    _getMissionStateRef(id) {
        const mission = this.state.missions.byId[id];
        if (!mission) throw new Error(`Unknown RPG mission state ID: ${id}`);
        return mission;
    }

    _isContactAvailable(definition, state) {
        return Boolean(state.alive && definition.namedSystemId === this.activeNamedSystemId);
    }

    _getConversationNode(definition, nodeId) {
        const node = definition.nodes[nodeId] ?? definition.nodes[definition.initialNodeId];
        if (!node) throw new Error(`RPG contact has no valid conversation node: ${definition.id}`);
        return node;
    }

    _createConversationNodeView(definition, nodeId) {
        const node = this._getConversationNode(definition, nodeId);
        return {
            ...node,
            choices: (node.choices ?? []).map((choice) => ({ ...choice }))
        };
    }

    _resolveChoiceNextNodeId(choice) {
        if (!choice.missionNodeMap) return choice.nextNodeId ?? null;

        const missionId = choice.missionAction?.missionId;
        if (!missionId) return choice.missionNodeMap.default ?? choice.nextNodeId ?? null;

        const mission = this._getMissionStateRef(missionId);
        const branchKey = mission.lastBranchId ? `${mission.status}:${mission.lastBranchId}` : null;
        const outcomeKey = mission.outcomeId ? `${mission.status}:${mission.outcomeId}` : null;
        return (branchKey && choice.missionNodeMap[branchKey])
            ?? (outcomeKey && choice.missionNodeMap[outcomeKey])
            ?? choice.missionNodeMap[mission.status]
            ?? choice.missionNodeMap.default
            ?? choice.nextNodeId
            ?? null;
    }

    _applyMissionActionRef(action) {
        if (!action || typeof action !== 'object') {
            throw new Error('RPG mission action must be an object.');
        }
        if (action.type === 'offer') return this._offerMissionRef(action.missionId);
        if (action.type === 'accept') return this._acceptMissionRef(action.missionId);
        if (action.type === 'fail') return this._failMissionRef(action.missionId, action.outcomeId);
        if (action.type === 'resolve') return this._resolveMissionRef(action.missionId, action.branchId);
        throw new Error(`Unknown RPG mission action type: ${action.type ?? 'missing'}`);
    }

    _offerMissionRef(id) {
        const mission = this._getMissionStateRef(id);
        this._getMissionDefinitionRef(id);
        if (mission.status !== MISSION_STATUSES.UNAVAILABLE) {
            return {
                missionId: id,
                status: mission.status,
                changed: false
            };
        }

        const now = this.now();
        mission.status = MISSION_STATUSES.OFFERED;
        mission.offeredAt = now;
        mission.updatedAt = now;
        const event = this._appendEventRef('mission.offered', {
            missionId: id,
            contactId: mission.contactId,
            namedSystemId: mission.namedSystemId
        });
        return {
            missionId: id,
            status: mission.status,
            changed: true,
            eventId: event.id
        };
    }

    _acceptMissionRef(id) {
        const mission = this._getMissionStateRef(id);
        this._getMissionDefinitionRef(id);
        if (mission.status === MISSION_STATUSES.UNAVAILABLE) this._offerMissionRef(id);
        if (mission.status === MISSION_STATUSES.ACCEPTED) {
            return {
                missionId: id,
                status: mission.status,
                changed: false
            };
        }
        if (mission.status !== MISSION_STATUSES.OFFERED) {
            throw new Error(`RPG mission cannot be accepted from status ${mission.status}: ${id}`);
        }

        const now = this.now();
        mission.status = MISSION_STATUSES.ACCEPTED;
        mission.acceptedAt = now;
        mission.updatedAt = now;
        const firstObjectiveId = Object.keys(mission.objectives?.byId ?? {})[0] ?? null;
        if (firstObjectiveId) {
            const objective = mission.objectives.byId[firstObjectiveId];
            objective.status = OBJECTIVE_STATUSES.ACTIVE;
            objective.activatedAt = now;
            mission.objectives.currentObjectiveId = firstObjectiveId;
        }
        const event = this._appendEventRef('mission.accepted', {
            missionId: id,
            contactId: mission.contactId,
            namedSystemId: mission.namedSystemId
        });
        return {
            missionId: id,
            status: mission.status,
            changed: true,
            eventId: event.id
        };
    }

    _failMissionRef(id, outcomeId = 'declined') {
        const definition = this._getMissionDefinitionRef(id);
        const mission = this._getMissionStateRef(id);
        const outcome = definition.failureOutcomes?.[outcomeId];
        if (!outcome) throw new Error(`Unknown RPG mission failure outcome ID: ${id}/${outcomeId}`);
        if (definition.requiresExternalResolution && mission.status === MISSION_STATUSES.ACCEPTED) {
            throw new Error(`RPG mission failure requires its authoritative domain runtime: ${id}`);
        }
        if (mission.status === MISSION_STATUSES.RESOLVED) {
            throw new Error(`RPG mission cannot fail after resolution: ${id}`);
        }
        if (mission.status === MISSION_STATUSES.FAILED && mission.outcomeId === outcomeId) {
            return {
                missionId: id,
                status: mission.status,
                outcomeId,
                changed: false
            };
        }
        if (mission.status === MISSION_STATUSES.UNAVAILABLE) this._offerMissionRef(id);

        const now = this.now();
        mission.status = MISSION_STATUSES.FAILED;
        mission.failedAt = now;
        mission.outcomeId = outcomeId;
        mission.lastBranchId = null;
        mission.updatedAt = now;
        for (const objective of Object.values(mission.objectives?.byId ?? {})) {
            if (objective.status === OBJECTIVE_STATUSES.PENDING || objective.status === OBJECTIVE_STATUSES.ACTIVE) {
                objective.status = OBJECTIVE_STATUSES.FAILED;
                objective.failedAt = now;
            }
        }
        if (mission.objectives) mission.objectives.currentObjectiveId = null;
        const worldFlags = this._applyWorldFlagsRef(outcome.worldFlags ?? {});
        const event = this._appendEventRef('mission.failed', {
            missionId: id,
            outcomeId,
            contactId: mission.contactId,
            namedSystemId: mission.namedSystemId,
            worldFlags
        });
        return {
            missionId: id,
            status: mission.status,
            outcomeId,
            changed: true,
            eventId: event.id
        };
    }

    _resolveMissionRef(id, branchId) {
        const definition = this._getMissionDefinitionRef(id);
        const mission = this._getMissionStateRef(id);
        const branch = definition.branches?.[branchId];
        if (!branch) throw new Error(`Unknown RPG mission branch ID: ${id}/${branchId}`);
        if (definition.requiresExternalResolution) {
            throw new Error(`RPG mission resolution requires its authoritative domain runtime: ${id}`);
        }
        if (mission.status === MISSION_STATUSES.RESOLVED && mission.lastBranchId === branchId) {
            return {
                missionId: id,
                status: mission.status,
                branchId,
                changed: false
            };
        }
        if (mission.status === MISSION_STATUSES.UNAVAILABLE) this._offerMissionRef(id);
        if (mission.status === MISSION_STATUSES.OFFERED) this._acceptMissionRef(id);
        if (mission.status !== MISSION_STATUSES.ACCEPTED) {
            throw new Error(`RPG mission cannot be resolved from status ${mission.status}: ${id}`);
        }

        const now = this.now();
        mission.status = MISSION_STATUSES.RESOLVED;
        mission.resolvedAt = now;
        mission.outcomeId = branchId;
        mission.lastBranchId = branchId;
        mission.updatedAt = now;
        for (const objective of Object.values(mission.objectives?.byId ?? {})) {
            if (objective.status !== OBJECTIVE_STATUSES.COMPLETE) {
                objective.status = OBJECTIVE_STATUSES.COMPLETE;
                objective.completedAt = now;
            }
        }
        if (mission.objectives) mission.objectives.currentObjectiveId = null;
        this._appendEventRef('mission.resolved', {
            missionId: id,
            branchId,
            contactId: mission.contactId,
            namedSystemId: mission.namedSystemId
        });

        const reputation = {};
        for (const [factionId, delta] of Object.entries(branch.reputation ?? {})) {
            reputation[factionId] = this._adjustReputationRef(factionId, Number(delta), `mission:${id}:${branchId}`);
        }
        const worldFlags = this._applyWorldFlagsRef(branch.worldFlags ?? {});
        const consequenceEvent = this._appendEventRef('mission.consequence', {
            missionId: id,
            branchId,
            reputation,
            worldFlags
        });
        return {
            missionId: id,
            status: mission.status,
            branchId,
            changed: true,
            eventId: consequenceEvent.id,
            reputation,
            worldFlags
        };
    }

    _adjustReputationRef(id, delta, reason) {
        const faction = this._getFactionRef(id);
        const previous = faction.reputation;
        const next = clampReputation(previous + Number(delta));
        faction.reputation = next;
        this._appendEventRef('reputation.changed', {
            factionId: id,
            previous,
            next,
            delta: next - previous,
            reason
        });
        return {
            previous,
            next,
            delta: next - previous
        };
    }

    _applyWorldFlagsRef(flags) {
        const changed = {};
        for (const [key, value] of Object.entries(flags ?? {})) {
            if (!key || typeof key !== 'string') {
                throw new Error('RPG world flag keys must be non-empty strings.');
            }
            this.state.worldFlags[key] = cloneRpgValue(value);
            changed[key] = cloneRpgValue(value);
        }
        return changed;
    }

    _getLlmFlavorStub() {
        return {
            enabled: Boolean(this.state.comms?.llmFlavorEnabled),
            source: 'stub',
            text: null
        };
    }

    _appendEventRef(type, payload = {}) {
        if (!type || typeof type !== 'string') {
            throw new Error('RPG event type must be a non-empty string.');
        }

        const event = {
            id: nextEventId(this.state.eventLog),
            type,
            payload: cloneRpgValue(payload),
            createdAt: this.now()
        };
        this.state.eventLog.push(event);
        return event;
    }

    _touch() {
        this.state.updatedAt = this.now();
        this.state = sanitizeRpgState(this.state);
    }
}

export function createRpgRuntime(options = {}) {
    return new RpgRuntime(options);
}

function nextEventId(eventLog) {
    return `event-${String(eventLog.length + 1).padStart(6, '0')}`;
}
