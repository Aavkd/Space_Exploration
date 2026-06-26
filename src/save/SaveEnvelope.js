import { createInitialRpgState, sanitizeRpgState } from '../rpg/state.js';

export const SAVE_ENVELOPE_VERSION = 2;
export const MAX_EVENT_LOG_ENTRIES = 500;
export const PROTECTED_EVENT_TYPES = Object.freeze([
    'mission.resolved',
    'mission.failed',
    'mission.consequence'
]);

export function createSaveEnvelope({
    slotId,
    slotName,
    now = new Date().toISOString(),
    rpg = createInitialRpgState(),
    gameTime = 0
} = {}) {
    assertSlotId(slotId);
    return sanitizeSaveEnvelope({
        version: SAVE_ENVELOPE_VERSION,
        slot: {
            id: slotId,
            name: sanitizeSlotName(slotName),
            createdAt: now,
            updatedAt: now
        },
        autosave: {
            kind: 'manual',
            reason: 'slot-created',
            savedAt: now,
            sequence: 0
        },
        player: {},
        ship: {},
        rpg,
        simulation: {
            gameTime
        },
        settings: {}
    });
}

export function sanitizeSaveEnvelope(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Save envelope must be an object.');
    }
    if (value.version !== SAVE_ENVELOPE_VERSION) {
        throw new Error(
            value.version > SAVE_ENVELOPE_VERSION
                ? `Save version ${value.version} is newer than supported version ${SAVE_ENVELOPE_VERSION}.`
                : `Unsupported save envelope version: ${value.version ?? 'missing'}.`
        );
    }
    assertSlotId(value.slot?.id);

    const createdAt = sanitizeTimestamp(value.slot.createdAt, 'slot.createdAt');
    const updatedAt = sanitizeTimestamp(value.slot.updatedAt, 'slot.updatedAt');
    const rpg = sanitizeRpgState(value.rpg);
    rpg.eventLog = compactEventLog(rpg.eventLog);

    return {
        version: SAVE_ENVELOPE_VERSION,
        slot: {
            id: value.slot.id,
            name: sanitizeSlotName(value.slot.name),
            createdAt,
            updatedAt
        },
        autosave: sanitizeAutosave(value.autosave, updatedAt),
        player: sanitizeEmptyDomain(value.player, 'player'),
        ship: sanitizeEmptyDomain(value.ship, 'ship'),
        rpg,
        simulation: {
            gameTime: sanitizeNonNegativeNumber(value.simulation?.gameTime, 'simulation.gameTime')
        },
        settings: sanitizeEmptyDomain(value.settings, 'settings')
    };
}

export function migrateLegacyRpgSave(value, { slotId, slotName = 'Migrated Flight', now } = {}) {
    const rpg = sanitizeRpgState(value);
    const envelope = createSaveEnvelope({ slotId, slotName, now, rpg });
    envelope.autosave = {
        kind: 'migration',
        reason: 'phase-11-v1',
        savedAt: now,
        sequence: 1
    };
    return sanitizeSaveEnvelope(envelope);
}

export function compactEventLog(entries, maxEntries = MAX_EVENT_LOG_ENTRIES) {
    if (!Array.isArray(entries) || entries.length <= maxEntries) return structuredClone(entries ?? []);
    const protectedEntries = entries.filter((entry) => PROTECTED_EVENT_TYPES.includes(entry.type));
    const protectedIds = new Set(protectedEntries.map((entry) => entry.id));
    const remaining = entries.filter((entry) => !protectedIds.has(entry.id));
    const available = Math.max(0, maxEntries - protectedEntries.length);
    return [...protectedEntries, ...remaining.slice(-available)]
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .map((entry) => structuredClone(entry));
}

export function createEnvelopePreview(envelope) {
    const clean = sanitizeSaveEnvelope(envelope);
    const mission = clean.rpg.missions?.byId?.port_meridian_route_packet;
    return {
        version: clean.version,
        slotName: clean.slot.name,
        updatedAt: clean.slot.updatedAt,
        gameTime: clean.simulation.gameTime,
        missionStatus: mission?.status ?? 'unknown',
        missionOutcomeId: mission?.outcomeId ?? null,
        eventCount: clean.rpg.eventLog.length
    };
}

function sanitizeAutosave(value, fallbackTimestamp) {
    const kind = ['manual', 'auto', 'migration', 'import'].includes(value?.kind) ? value.kind : 'manual';
    return {
        kind,
        reason: typeof value?.reason === 'string' && value.reason ? value.reason : 'unspecified',
        savedAt: value?.savedAt ? sanitizeTimestamp(value.savedAt, 'autosave.savedAt') : fallbackTimestamp,
        sequence: Math.max(0, Math.floor(sanitizeNonNegativeNumber(value?.sequence ?? 0, 'autosave.sequence')))
    };
}

function sanitizeEmptyDomain(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Save domain ${label} must be an object.`);
    }
    return {};
}

function sanitizeNonNegativeNumber(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a non-negative finite number.`);
    return number;
}

function sanitizeTimestamp(value, label) {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
        throw new Error(`${label} must be an ISO timestamp.`);
    }
    return value;
}

function sanitizeSlotName(value) {
    const name = typeof value === 'string' ? value.trim().slice(0, 48) : '';
    return name || 'Flight';
}

function assertSlotId(value) {
    if (typeof value !== 'string' || !/^slot-[a-z0-9-]+$/.test(value)) {
        throw new Error(`Invalid save slot ID: ${value ?? 'missing'}.`);
    }
}
