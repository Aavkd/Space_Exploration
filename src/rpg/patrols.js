import { CARGO_IDS } from './cargo.js';
import {
    FACTION_TERRITORY_POLICY_IDS,
    REPUTATION_BANDS,
    getFactionTerritoryPolicy
} from './factionTerritory.js';
import { FACTION_IDS, NAMED_SYSTEM_IDS } from './registries.js';

export const PATROL_STATE_VERSION = 2;
export const PATROL_PHASES = Object.freeze(['spawn', 'approach', 'hail', 'wait', 'depart', 'abort']);
export const PATROL_OUTCOMES = Object.freeze([
    'welcome',
    'inspection_clear',
    'warning_refusal',
    'ignored_hail',
    'safe_hostility',
    'aborted'
]);
export const MAX_PATROL_HISTORY = 20;

export function createInitialPatrolState() {
    return {
        version: PATROL_STATE_VERSION,
        presenceSystemId: null,
        nextSequence: 1,
        activeEncounter: null,
        history: []
    };
}

export function migratePatrolStateV1(value) {
    if (!value || value.version !== 1) {
        throw new Error(`Expected patrol state version 1, received ${value?.version ?? 'missing'}.`);
    }
    const migrateEncounter = (encounter) => {
        if (!encounter) return encounter;
        const matches = (encounter.cargoScan?.matches ?? []).map((match) => ({
            ...match,
            unitValue: 0,
            totalValue: 0
        }));
        return {
            ...encounter,
            cargoScan: {
                ...encounter.cargoScan,
                matches,
                contrabandValue: 0
            }
        };
    };
    return {
        ...structuredClone(value),
        version: PATROL_STATE_VERSION,
        activeEncounter: migrateEncounter(value.activeEncounter),
        history: (value.history ?? []).map(migrateEncounter)
    };
}

export function sanitizePatrolState(value) {
    if (value === undefined || value === null) return createInitialPatrolState();
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('rpg.patrol must be an object.');
    }
    if (value.version === 1) value = migratePatrolStateV1(value);
    if (value.version !== PATROL_STATE_VERSION) {
        throw new Error(`Unsupported patrol state version: ${value.version ?? 'missing'}.`);
    }
    const presenceSystemId = sanitizeSystemId(value.presenceSystemId, 'patrol.presenceSystemId');
    const nextSequence = sanitizePositiveInteger(value.nextSequence, 'patrol.nextSequence');
    const activeEncounter = value.activeEncounter === null
        ? null
        : sanitizeEncounter(value.activeEncounter, 'patrol.activeEncounter');
    const history = Array.isArray(value.history)
        ? value.history.slice(-MAX_PATROL_HISTORY).map((entry, index) => (
            sanitizeEncounter(entry, `patrol.history[${index}]`, true)
        ))
        : (() => { throw new Error('patrol.history must be an array.'); })();
    if (activeEncounter && activeEncounter.systemId !== presenceSystemId) {
        throw new Error('Active patrol encounter must match patrol.presenceSystemId.');
    }
    return { version: PATROL_STATE_VERSION, presenceSystemId, nextSequence, activeEncounter, history };
}

function sanitizeEncounter(value, label, history = false) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} must be an object.`);
    }
    if (typeof value.id !== 'string' || !/^patrol-[a-f0-9]{8}$/.test(value.id)) {
        throw new Error(`${label}.id is invalid: ${value.id ?? 'missing'}.`);
    }
    if (!FACTION_TERRITORY_POLICY_IDS.includes(value.policyId)) {
        throw new Error(`Unknown patrol policy ID in ${label}: ${value.policyId}`);
    }
    const policy = getFactionTerritoryPolicy(value.policyId);
    const systemId = sanitizeSystemId(value.systemId, `${label}.systemId`);
    if (!FACTION_IDS.includes(value.factionId)) throw new Error(`Unknown patrol faction ID: ${value.factionId}`);
    if (systemId !== policy.systemId || value.factionId !== policy.factionId || value.agentId !== policy.agentId) {
        throw new Error(`${label} does not match patrol policy ${policy.id}.`);
    }
    if (!PATROL_PHASES.includes(value.phase)) throw new Error(`Unknown patrol phase: ${value.phase}`);
    const outcomeId = value.outcomeId === null ? null : value.outcomeId;
    if (outcomeId !== null && !PATROL_OUTCOMES.includes(outcomeId)) {
        throw new Error(`Unknown patrol outcome ID: ${outcomeId}`);
    }
    if (history && outcomeId === null) throw new Error(`${label} requires a terminal outcome.`);
    if (!history && ['depart', 'abort'].includes(value.phase) !== (outcomeId !== null)) {
        throw new Error(`${label} terminal phase/outcome mismatch.`);
    }
    const reputationSnapshot = sanitizeReputation(value.reputationSnapshot, `${label}.reputationSnapshot`);
    if (!REPUTATION_BANDS.includes(value.reputationBand)) {
        throw new Error(`Unknown patrol reputation band: ${value.reputationBand}`);
    }
    if (typeof value.cargoFingerprint !== 'string' || !/^[a-f0-9]{8}$/.test(value.cargoFingerprint)) {
        throw new Error(`${label}.cargoFingerprint is invalid.`);
    }
    return {
        id: value.id,
        policyId: value.policyId,
        agentId: value.agentId,
        systemId,
        factionId: value.factionId,
        sequence: sanitizePositiveInteger(value.sequence, `${label}.sequence`),
        phase: value.phase,
        outcomeId,
        reputationSnapshot,
        reputationBand: value.reputationBand,
        cargoFingerprint: value.cargoFingerprint,
        cargoScan: sanitizeCargoScan(value.cargoScan, `${label}.cargoScan`),
        spawnedAtGameTime: sanitizeGameTime(value.spawnedAtGameTime, `${label}.spawnedAtGameTime`),
        phaseStartedAtGameTime: sanitizeGameTime(value.phaseStartedAtGameTime, `${label}.phaseStartedAtGameTime`),
        responseDeadlineGameTime: value.responseDeadlineGameTime === null
            ? null
            : sanitizeGameTime(value.responseDeadlineGameTime, `${label}.responseDeadlineGameTime`),
        scanPending: Boolean(value.scanPending)
    };
}

function sanitizeCargoScan(value, label) {
    if (!value || typeof value !== 'object' || !['clear', 'restricted', 'contraband'].includes(value.status)) {
        throw new Error(`${label} has an invalid status.`);
    }
    if (!Array.isArray(value.matches)) throw new Error(`${label}.matches must be an array.`);
    const matches = value.matches.map((match) => {
        if (!CARGO_IDS.includes(match?.cargoId)) throw new Error(`Unknown cargo ID in patrol scan: ${match?.cargoId}`);
        const quantity = sanitizePositiveInteger(match.quantity, `${label}.${match.cargoId}.quantity`);
        return {
            cargoId: match.cargoId,
            quantity,
            restrictedTags: sanitizeTags(match.restrictedTags, `${label}.restrictedTags`),
            prohibitedTags: sanitizeTags(match.prohibitedTags, `${label}.prohibitedTags`),
            unitValue: sanitizeNonNegativeSafeInteger(match.unitValue, `${label}.${match.cargoId}.unitValue`),
            totalValue: sanitizeNonNegativeSafeInteger(match.totalValue, `${label}.${match.cargoId}.totalValue`)
        };
    }).sort((a, b) => a.cargoId.localeCompare(b.cargoId));
    for (const match of matches) {
        if (match.totalValue !== match.unitValue * match.quantity) {
            throw new Error(`${label}.${match.cargoId} appraisal total is invalid.`);
        }
    }
    const contrabandValue = sanitizeNonNegativeSafeInteger(
        value.contrabandValue,
        `${label}.contrabandValue`
    );
    const expectedContrabandValue = matches.reduce(
        (total, match) => total + (match.prohibitedTags.length ? match.totalValue : 0),
        0
    );
    if (contrabandValue !== expectedContrabandValue) {
        throw new Error(`${label}.contrabandValue does not match prohibited cargo appraisals.`);
    }
    return { status: value.status, matches, contrabandValue };
}

function sanitizeTags(value, label) {
    if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string')) {
        throw new Error(`${label} must be an array of strings.`);
    }
    return [...new Set(value)].sort();
}

function sanitizeSystemId(value, label) {
    if (value === null || value === undefined) return null;
    if (!NAMED_SYSTEM_IDS.includes(value)) throw new Error(`Unknown RPG named system ID in ${label}: ${value}`);
    return value;
}

function sanitizePositiveInteger(value, label) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) throw new Error(`${label} must be a positive integer.`);
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
    if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a non-negative finite number.`);
    return number;
}

function sanitizeReputation(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < -1 || number > 1) {
        throw new Error(`${label} must be from -1 to 1.`);
    }
    return number;
}
