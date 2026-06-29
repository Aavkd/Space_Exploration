import { createInitialShipState, sanitizeShipState } from '../rpg/cargo.js';
import { createInitialEconomyState, sanitizeEconomyState } from '../rpg/economy.js';
import { createInitialWorldState, sanitizeWorldState } from '../rpg/simWorld.js';
import { migrateRpgState } from '../rpg/migrations.js';
import { createInitialRpgState, sanitizeRpgState } from '../rpg/state.js';
import {
    assertPlayerBoardingConsistency,
    createInitialPlayerState,
    sanitizePlayerState
} from '../player/playerState.js';

export const SAVE_ENVELOPE_VERSION = 13;
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
        player: createInitialPlayerState(gameTime),
        ship: createInitialShipState(),
        rpg,
        simulation: {
            gameTime,
            economy: createInitialEconomyState(gameTime),
            world: createInitialWorldState(gameTime)
        },
        settings: {}
    });
}

export function sanitizeSaveEnvelope(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Save envelope must be an object.');
    }
    if (value.version === 2) value = migrateVersion2Envelope(value);
    if (value.version === 3) value = migrateVersion3Envelope(value);
    if (value.version === 4) value = migrateVersion4Envelope(value);
    if (value.version === 5) value = migrateVersion5Envelope(value);
    if (value.version === 6) value = migrateVersion6Envelope(value);
    if (value.version === 7) value = migrateVersion7Envelope(value);
    if (value.version === 8) value = migrateVersion8Envelope(value);
    if (value.version === 9) value = migrateVersion9Envelope(value);
    if (value.version === 10) value = migrateVersion10Envelope(value);
    if (value.version === 11) value = migrateVersion11Envelope(value);
    if (value.version === 12) value = migrateVersion12Envelope(value);
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
    const rpg = sanitizeRpgState(migrateRpgState(value.rpg));
    rpg.eventLog = compactEventLog(rpg.eventLog);

    const gameTime = sanitizeNonNegativeNumber(value.simulation?.gameTime, 'simulation.gameTime');
    const player = sanitizePlayerState(value.player, { gameTime });
    assertPlayerBoardingConsistency(player, rpg.boarding);
    return {
        version: SAVE_ENVELOPE_VERSION,
        slot: {
            id: value.slot.id,
            name: sanitizeSlotName(value.slot.name),
            createdAt,
            updatedAt
        },
        autosave: sanitizeAutosave(value.autosave, updatedAt),
        player,
        ship: sanitizeShipState(value.ship),
        rpg,
        simulation: {
            gameTime,
            economy: sanitizeEconomyState(value.simulation?.economy, { gameTime }),
            world: sanitizeWorldState(value.simulation?.world, { gameTime })
        },
        settings: sanitizeEmptyDomain(value.settings, 'settings')
    };
}

export function migrateLegacyRpgSave(value, { slotId, slotName = 'Migrated Flight', now } = {}) {
    const rpg = sanitizeRpgState(migrateRpgState(value));
    const envelope = createSaveEnvelope({ slotId, slotName, now, rpg });
    envelope.autosave = {
        kind: 'migration',
        reason: 'phase-11-v1',
        savedAt: now,
        sequence: 1
    };
    return sanitizeSaveEnvelope(envelope);
}

export function migrateVersion2Envelope(value) {
    if (!value || value.version !== 2) {
        throw new Error(`Expected save envelope version 2, received ${value?.version ?? 'missing'}.`);
    }
    const savedAt = typeof value.slot?.updatedAt === 'string'
        ? value.slot.updatedAt
        : new Date().toISOString();
    return {
        ...structuredClone(value),
        version: 3,
        ship: createInitialShipState(),
        rpg: migrateRpgState(value.rpg),
        autosave: {
            kind: 'migration',
            reason: 'phase-13-v2',
            savedAt,
            sequence: Math.max(0, Math.floor(Number(value.autosave?.sequence) || 0)) + 1
        }
    };
}

export function migrateVersion3Envelope(value) {
    if (!value || value.version !== 3) {
        throw new Error(`Expected save envelope version 3, received ${value?.version ?? 'missing'}.`);
    }
    const savedAt = typeof value.slot?.updatedAt === 'string'
        ? value.slot.updatedAt
        : new Date().toISOString();
    return {
        ...structuredClone(value),
        version: 4,
        rpg: migrateRpgState(value.rpg),
        autosave: {
            kind: 'migration',
            reason: 'phase-14-v3',
            savedAt,
            sequence: Math.max(0, Math.floor(Number(value.autosave?.sequence) || 0)) + 1
        }
    };
}

export function migrateVersion4Envelope(value) {
    if (!value || value.version !== 4) {
        throw new Error(`Expected save envelope version 4, received ${value?.version ?? 'missing'}.`);
    }
    const savedAt = typeof value.slot?.updatedAt === 'string'
        ? value.slot.updatedAt
        : new Date().toISOString();
    return {
        ...structuredClone(value),
        version: 5,
        rpg: migrateRpgState(value.rpg),
        autosave: {
            kind: 'migration',
            reason: 'phase-15-v4',
            savedAt,
            sequence: Math.max(0, Math.floor(Number(value.autosave?.sequence) || 0)) + 1
        }
    };
}

export function migrateVersion5Envelope(value) {
    if (!value || value.version !== 5) {
        throw new Error(`Expected save envelope version 5, received ${value?.version ?? 'missing'}.`);
    }
    const savedAt = typeof value.slot?.updatedAt === 'string'
        ? value.slot.updatedAt
        : new Date().toISOString();
    return {
        ...structuredClone(value),
        version: 6,
        rpg: migrateRpgState(value.rpg),
        autosave: {
            kind: 'migration',
            reason: 'phase-17-v5',
            savedAt,
            sequence: Math.max(0, Math.floor(Number(value.autosave?.sequence) || 0)) + 1
        }
    };
}

export function migrateVersion6Envelope(value) {
    if (!value || value.version !== 6) {
        throw new Error(`Expected save envelope version 6, received ${value?.version ?? 'missing'}.`);
    }
    const savedAt = typeof value.slot?.updatedAt === 'string'
        ? value.slot.updatedAt
        : new Date().toISOString();
    return {
        ...structuredClone(value),
        version: 7,
        ship: sanitizeShipState(value.ship),
        autosave: {
            kind: 'migration',
            reason: 'phase-18-v6',
            savedAt,
            sequence: Math.max(0, Math.floor(Number(value.autosave?.sequence) || 0)) + 1
        }
    };
}

export function migrateVersion7Envelope(value) {
    if (!value || value.version !== 7) {
        throw new Error(`Expected save envelope version 7, received ${value?.version ?? 'missing'}.`);
    }
    const savedAt = typeof value.slot?.updatedAt === 'string'
        ? value.slot.updatedAt
        : new Date().toISOString();
    return {
        ...structuredClone(value),
        version: 8,
        rpg: migrateRpgState(value.rpg),
        autosave: {
            kind: 'migration',
            reason: 'phase-19-v7',
            savedAt,
            sequence: Math.max(0, Math.floor(Number(value.autosave?.sequence) || 0)) + 1
        }
    };
}

export function migrateVersion8Envelope(value) {
    if (!value || value.version !== 8) {
        throw new Error(`Expected save envelope version 8, received ${value?.version ?? 'missing'}.`);
    }
    const savedAt = typeof value.slot?.updatedAt === 'string'
        ? value.slot.updatedAt
        : new Date().toISOString();
    const gameTime = sanitizeNonNegativeNumber(value.simulation?.gameTime, 'simulation.gameTime');
    return {
        ...structuredClone(value),
        version: 9,
        rpg: migrateRpgState(value.rpg),
        simulation: {
            ...structuredClone(value.simulation),
            gameTime,
            economy: createInitialEconomyState(gameTime)
        },
        autosave: {
            kind: 'migration',
            reason: 'phase-20-v8',
            savedAt,
            sequence: Math.max(0, Math.floor(Number(value.autosave?.sequence) || 0)) + 1
        }
    };
}

export function migrateVersion9Envelope(value) {
    if (!value || value.version !== 9) {
        throw new Error(`Expected save envelope version 9, received ${value?.version ?? 'missing'}.`);
    }
    const savedAt = typeof value.slot?.updatedAt === 'string'
        ? value.slot.updatedAt
        : new Date().toISOString();
    const gameTime = sanitizeNonNegativeNumber(value.simulation?.gameTime, 'simulation.gameTime');
    return {
        ...structuredClone(value),
        version: 10,
        player: createInitialPlayerState(gameTime),
        rpg: migrateRpgState(value.rpg),
        autosave: {
            kind: 'migration',
            reason: 'phase-21-v9',
            savedAt,
            sequence: Math.max(0, Math.floor(Number(value.autosave?.sequence) || 0)) + 1
        }
    };
}

export function migrateVersion10Envelope(value) {
    if (!value || value.version !== 10) {
        throw new Error(`Expected save envelope version 10, received ${value?.version ?? 'missing'}.`);
    }
    const savedAt = typeof value.slot?.updatedAt === 'string'
        ? value.slot.updatedAt
        : new Date().toISOString();
    return {
        ...structuredClone(value),
        version: 11,
        rpg: migrateRpgState(value.rpg),
        autosave: {
            kind: 'migration',
            reason: 'phase-22-v10',
            savedAt,
            sequence: Math.max(0, Math.floor(Number(value.autosave?.sequence) || 0)) + 1
        }
    };
}

export function migrateVersion11Envelope(value) {
    if (!value || value.version !== 11) {
        throw new Error(`Expected save envelope version 11, received ${value?.version ?? 'missing'}.`);
    }
    const savedAt = typeof value.slot?.updatedAt === 'string'
        ? value.slot.updatedAt
        : new Date().toISOString();
    const gameTime = sanitizeNonNegativeNumber(value.simulation?.gameTime, 'simulation.gameTime');
    // The world facet is initialized at the saved gameTime and does not
    // simulate elapsed pre-migration time (same rule as the Phase 20 economy).
    // Phase 17 territory and Phase 20 economy migrate non-destructively and are
    // reconciled as projections of the substrate.
    return {
        ...structuredClone(value),
        version: 12,
        simulation: {
            ...structuredClone(value.simulation),
            gameTime,
            world: createInitialWorldState(gameTime)
        },
        autosave: {
            kind: 'migration',
            reason: 'phase-23-v11',
            savedAt,
            sequence: Math.max(0, Math.floor(Number(value.autosave?.sequence) || 0)) + 1
        }
    };
}

export function migrateVersion12Envelope(value) {
    if (!value || value.version !== 12) {
        throw new Error(`Expected save envelope version 12, received ${value?.version ?? 'missing'}.`);
    }
    const savedAt = typeof value.slot?.updatedAt === 'string'
        ? value.slot.updatedAt
        : new Date().toISOString();
    // Phase 24 bumps the RPG facet v9→v10, initializing empty per-NPC dialogue
    // memory. No prior mission, reputation, contact, crew, world-flag, economy,
    // or simulation outcome changes.
    return {
        ...structuredClone(value),
        version: 13,
        rpg: migrateRpgState(value.rpg),
        autosave: {
            kind: 'migration',
            reason: 'phase-24-v12',
            savedAt,
            sequence: Math.max(0, Math.floor(Number(value.autosave?.sequence) || 0)) + 1
        }
    };
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
