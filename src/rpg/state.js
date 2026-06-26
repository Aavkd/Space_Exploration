import {
    FACTION_DEFINITIONS,
    FACTION_IDS,
    NAMED_SYSTEM_DEFINITIONS,
    NAMED_SYSTEM_IDS
} from './registries.js';
import { CONTACT_DEFINITIONS, CONTACT_IDS } from './contacts.js';
import {
    MISSION_DEFINITIONS,
    MISSION_IDS,
    MISSION_STATUSES,
    OBJECTIVE_STATUSES
} from './missions.js';

export const RPG_STATE_VERSION = 2;
export const INITIAL_RPG_TIMESTAMP = '2026-06-26T00:00:00.000Z';

export function createInitialRpgState() {
    const factionsById = {};
    for (const id of FACTION_IDS) {
        const faction = FACTION_DEFINITIONS[id];
        factionsById[id] = {
            id: faction.id,
            name: faction.name,
            civTier: faction.civTier,
            reputation: 0
        };
    }

    const namedSystemsById = {};
    for (const id of NAMED_SYSTEM_IDS) {
        const system = NAMED_SYSTEM_DEFINITIONS[id];
        namedSystemsById[id] = {
            id: system.id,
            name: system.name ?? system.id,
            navigationLabel: system.navigationLabel ?? system.name ?? system.id,
            role: system.role,
            startingTier: system.startingTier,
            startingFactionId: system.startingFactionId,
            seed: system.seed ?? null,
            position: Array.isArray(system.position) ? [...system.position] : null,
            star: system.star ? cloneRpgValue(system.star) : null
        };
    }

    const contactsById = {};
    for (const id of CONTACT_IDS) {
        const contact = CONTACT_DEFINITIONS[id];
        contactsById[id] = {
            id: contact.id,
            type: contact.type,
            name: contact.name,
            title: contact.title,
            factionId: contact.factionId,
            civTier: contact.civTier,
            namedSystemId: contact.namedSystemId,
            relationship: 0,
            alive: true,
            persistent: true,
            conversation: {
                nodeId: contact.initialNodeId,
                startedAt: null,
                updatedAt: null,
                lastChoiceId: null,
                choiceCount: 0
            }
        };
    }

    const missionsById = {};
    for (const id of MISSION_IDS) {
        const mission = MISSION_DEFINITIONS[id];
        missionsById[id] = {
            id: mission.id,
            name: mission.name,
            status: mission.initialStatus ?? MISSION_STATUSES.UNAVAILABLE,
            contactId: mission.contactId,
            namedSystemId: mission.namedSystemId,
            offeredAt: null,
            acceptedAt: null,
            resolvedAt: null,
            failedAt: null,
            outcomeId: null,
            lastBranchId: null,
            updatedAt: null,
            objectives: createInitialObjectives(mission)
        };
    }

    return {
        version: RPG_STATE_VERSION,
        createdAt: INITIAL_RPG_TIMESTAMP,
        updatedAt: INITIAL_RPG_TIMESTAMP,
        factions: {
            byId: factionsById
        },
        namedSystems: {
            byId: namedSystemsById
        },
        contacts: {
            byId: contactsById
        },
        missions: {
            byId: missionsById
        },
        comms: {
            activeContactId: null,
            llmFlavorEnabled: false
        },
        eventLog: [],
        worldFlags: {}
    };
}

export function cloneRpgValue(value) {
    return structuredClone(value);
}

export function sanitizeRpgState(value) {
    if (!value || typeof value !== 'object') {
        throw new Error('RPG save data is not an object.');
    }
    if (value.version !== RPG_STATE_VERSION) {
        throw new Error(`Unsupported RPG save version: ${value.version ?? 'missing'}.`);
    }

    const base = createInitialRpgState();
    const next = {
        ...base,
        createdAt: isString(value.createdAt) ? value.createdAt : base.createdAt,
        updatedAt: isString(value.updatedAt) ? value.updatedAt : base.updatedAt,
        factions: {
            byId: { ...base.factions.byId }
        },
        namedSystems: {
            byId: { ...base.namedSystems.byId }
        },
        contacts: {
            byId: { ...base.contacts.byId }
        },
        missions: {
            byId: { ...base.missions.byId }
        },
        comms: sanitizeComms(value.comms, base.comms),
        eventLog: Array.isArray(value.eventLog)
            ? value.eventLog
                .filter((entry) => entry && typeof entry === 'object' && isString(entry.id) && isString(entry.type))
                .map((entry) => ({
                    id: entry.id,
                    type: entry.type,
                    payload: cloneRpgValue(entry.payload ?? {}),
                    createdAt: isString(entry.createdAt) ? entry.createdAt : base.updatedAt
                }))
            : [],
        worldFlags: value.worldFlags && typeof value.worldFlags === 'object' && !Array.isArray(value.worldFlags)
            ? cloneRpgValue(value.worldFlags)
            : {}
    };

    const savedFactions = value.factions?.byId ?? {};
    for (const id of FACTION_IDS) {
        const saved = savedFactions[id];
        next.factions.byId[id] = {
            ...base.factions.byId[id],
            reputation: clampReputation(Number(saved?.reputation ?? 0))
        };
    }

    const savedSystems = value.namedSystems?.byId ?? {};
    for (const id of NAMED_SYSTEM_IDS) {
        next.namedSystems.byId[id] = {
            ...base.namedSystems.byId[id],
            ...sanitizeNamedSystemOverride(savedSystems[id], base.namedSystems.byId[id])
        };
    }

    const savedContacts = value.contacts?.byId ?? {};
    for (const id of CONTACT_IDS) {
        next.contacts.byId[id] = {
            ...base.contacts.byId[id],
            ...sanitizeContactOverride(savedContacts[id], base.contacts.byId[id])
        };
    }

    const savedMissions = value.missions?.byId ?? {};
    for (const id of MISSION_IDS) {
        next.missions.byId[id] = {
            ...base.missions.byId[id],
            ...sanitizeMissionOverride(savedMissions[id], base.missions.byId[id])
        };
    }

    return next;
}

export function clampReputation(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(-1, Math.min(1, value));
}

export function createRpgSummary(state, { activeNamedSystemId = null } = {}) {
    const factions = {};
    for (const [id, faction] of Object.entries(state.factions.byId)) {
        factions[id] = faction.reputation;
    }

    return {
        version: state.version,
        factions,
        eventCount: state.eventLog.length,
        namedSystemCount: Object.keys(state.namedSystems.byId).length,
        missions: createMissionSummary(state),
        worldFlags: cloneRpgValue(state.worldFlags ?? {}),
        activeNamedSystemId,
        comms: createCommsSummary(state)
    };
}

function sanitizeNamedSystemOverride(saved, base) {
    if (!saved || typeof saved !== 'object') return {};
    return {
        name: isString(saved.name) ? saved.name : base.name,
        navigationLabel: isString(saved.navigationLabel) ? saved.navigationLabel : base.navigationLabel,
        role: isString(saved.role) ? saved.role : base.role,
        startingTier: Number.isFinite(Number(saved.startingTier)) ? Number(saved.startingTier) : base.startingTier,
        startingFactionId: saved.startingFactionId === null || isString(saved.startingFactionId)
            ? saved.startingFactionId
            : base.startingFactionId,
        seed: saved.seed === null || isString(saved.seed) ? saved.seed : base.seed,
        position: sanitizePosition(saved.position, base.position),
        star: sanitizeStar(saved.star, base.star)
    };
}

function isString(value) {
    return typeof value === 'string';
}

function sanitizePosition(value, base) {
    if (!Array.isArray(value) || value.length !== 3) return base ? [...base] : null;
    const next = value.map((entry) => Number(entry));
    if (next.some((entry) => !Number.isFinite(entry))) return base ? [...base] : null;
    return next;
}

function sanitizeStar(value, base) {
    if (!value || typeof value !== 'object') return base ? cloneRpgValue(base) : null;
    return {
        color: isString(value.color) ? value.color : base?.color ?? '#ffd89a',
        temperatureK: Number.isFinite(Number(value.temperatureK)) ? Number(value.temperatureK) : base?.temperatureK ?? 5800,
        luminosity: Number.isFinite(Number(value.luminosity)) ? Number(value.luminosity) : base?.luminosity ?? 1
    };
}

function sanitizeContactOverride(saved, base) {
    if (!saved || typeof saved !== 'object') return {};
    const conversation = saved.conversation && typeof saved.conversation === 'object'
        ? saved.conversation
        : {};
    return {
        relationship: clampReputation(Number(saved.relationship ?? base.relationship)),
        alive: typeof saved.alive === 'boolean' ? saved.alive : base.alive,
        conversation: {
            nodeId: isString(conversation.nodeId) ? conversation.nodeId : base.conversation.nodeId,
            startedAt: conversation.startedAt === null || isString(conversation.startedAt)
                ? conversation.startedAt
                : base.conversation.startedAt,
            updatedAt: conversation.updatedAt === null || isString(conversation.updatedAt)
                ? conversation.updatedAt
                : base.conversation.updatedAt,
            lastChoiceId: conversation.lastChoiceId === null || isString(conversation.lastChoiceId)
                ? conversation.lastChoiceId
                : base.conversation.lastChoiceId,
            choiceCount: Number.isFinite(Number(conversation.choiceCount))
                ? Math.max(0, Math.floor(Number(conversation.choiceCount)))
                : base.conversation.choiceCount
        }
    };
}

function sanitizeComms(saved, base) {
    if (!saved || typeof saved !== 'object') return { ...base };
    const activeContactId = CONTACT_IDS.includes(saved.activeContactId) ? saved.activeContactId : base.activeContactId;
    return {
        activeContactId,
        llmFlavorEnabled: typeof saved.llmFlavorEnabled === 'boolean'
            ? saved.llmFlavorEnabled
            : base.llmFlavorEnabled
    };
}

function sanitizeMissionOverride(saved, base) {
    if (!saved || typeof saved !== 'object') return {};
    const status = Object.values(MISSION_STATUSES).includes(saved.status)
        ? saved.status
        : base.status;
    return {
        status,
        offeredAt: saved.offeredAt === null || isString(saved.offeredAt) ? saved.offeredAt : base.offeredAt,
        acceptedAt: saved.acceptedAt === null || isString(saved.acceptedAt) ? saved.acceptedAt : base.acceptedAt,
        resolvedAt: saved.resolvedAt === null || isString(saved.resolvedAt) ? saved.resolvedAt : base.resolvedAt,
        failedAt: saved.failedAt === null || isString(saved.failedAt) ? saved.failedAt : base.failedAt,
        outcomeId: saved.outcomeId === null || isString(saved.outcomeId) ? saved.outcomeId : base.outcomeId,
        lastBranchId: saved.lastBranchId === null || isString(saved.lastBranchId) ? saved.lastBranchId : base.lastBranchId,
        updatedAt: saved.updatedAt === null || isString(saved.updatedAt) ? saved.updatedAt : base.updatedAt,
        objectives: sanitizeObjectives(saved.objectives, base.objectives)
    };
}

function createInitialObjectives(mission) {
    const byId = {};
    for (const objective of Object.values(mission.objectives ?? {})) {
        byId[objective.id] = {
            id: objective.id,
            status: OBJECTIVE_STATUSES.PENDING,
            activatedAt: null,
            completedAt: null,
            failedAt: null
        };
    }
    return {
        currentObjectiveId: null,
        byId
    };
}

function sanitizeObjectives(saved, base) {
    const byId = {};
    const savedById = saved?.byId ?? {};
    for (const [id, initial] of Object.entries(base.byId)) {
        const value = savedById[id];
        byId[id] = {
            ...initial,
            status: Object.values(OBJECTIVE_STATUSES).includes(value?.status)
                ? value.status
                : initial.status,
            activatedAt: value?.activatedAt === null || isString(value?.activatedAt)
                ? value.activatedAt
                : initial.activatedAt,
            completedAt: value?.completedAt === null || isString(value?.completedAt)
                ? value.completedAt
                : initial.completedAt,
            failedAt: value?.failedAt === null || isString(value?.failedAt)
                ? value.failedAt
                : initial.failedAt
        };
    }
    const currentObjectiveId = Object.hasOwn(byId, saved?.currentObjectiveId)
        ? saved.currentObjectiveId
        : null;
    return { currentObjectiveId, byId };
}

function createMissionSummary(state) {
    const missions = {};
    for (const [id, mission] of Object.entries(state.missions?.byId ?? {})) {
        missions[id] = {
            status: mission.status,
            outcomeId: mission.outcomeId ?? null,
            lastBranchId: mission.lastBranchId ?? null
        };
    }
    return missions;
}

function createCommsSummary(state) {
    const activeContactId = state.comms?.activeContactId ?? null;
    const contact = activeContactId ? state.contacts?.byId?.[activeContactId] ?? null : null;
    return {
        activeContactId,
        conversationNodeId: contact?.conversation?.nodeId ?? null,
        lastChoiceId: contact?.conversation?.lastChoiceId ?? null,
        llmFlavorEnabled: Boolean(state.comms?.llmFlavorEnabled)
    };
}
