export const COMBAT_STATE_VERSION = 1;
export const COMBAT_SYSTEM_ID = 'index_hq';
export const COMBAT_ENCOUNTER_ID = 'index_k7_red_knife_encounter';
export const COMBAT_ENEMY_ID = 'scavenger_red_knife';
export const COMBAT_WRECK_ID = 'scavenger_red_knife_wreck';
export const COMBAT_ENEMY_FACTION_ID = 'drifters';
export const COMBAT_DISPOSITIONS = Object.freeze(['available', 'destroyed', 'escaped']);
export const COMBAT_OUTCOMES = Object.freeze(['victory', 'fled', 'defeat']);
export const COMBAT_MAX_HISTORY = 20;

export function createInitialCombatState() {
    return {
        version: COMBAT_STATE_VERSION,
        enemy: {
            id: COMBAT_ENEMY_ID,
            disposition: 'available',
            destroyedAtGameTime: null
        },
        wreck: {
            id: COMBAT_WRECK_ID,
            claimed: false,
            claimedAtGameTime: null
        },
        lastOutcome: null,
        history: []
    };
}

export function sanitizeCombatState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('rpg.combat must be an object.');
    }
    if (value.version !== COMBAT_STATE_VERSION) {
        throw new Error(`Unsupported combat state version: ${value.version ?? 'missing'}.`);
    }
    if (value.enemy?.id !== COMBAT_ENEMY_ID) {
        throw new Error(`Unknown combat enemy ID: ${value.enemy?.id ?? 'missing'}.`);
    }
    if (!COMBAT_DISPOSITIONS.includes(value.enemy.disposition)) {
        throw new Error(`Unknown combat enemy disposition: ${value.enemy.disposition ?? 'missing'}.`);
    }
    const destroyedAtGameTime = sanitizeOptionalTime(
        value.enemy.destroyedAtGameTime,
        'rpg.combat.enemy.destroyedAtGameTime'
    );
    if ((value.enemy.disposition === 'destroyed') !== (destroyedAtGameTime !== null)) {
        throw new Error('Destroyed combat enemy disposition and game-time checkpoint must agree.');
    }
    if (value.wreck?.id !== COMBAT_WRECK_ID) {
        throw new Error(`Unknown combat wreck ID: ${value.wreck?.id ?? 'missing'}.`);
    }
    if (typeof value.wreck.claimed !== 'boolean') {
        throw new Error('rpg.combat.wreck.claimed must be a boolean.');
    }
    const claimedAtGameTime = sanitizeOptionalTime(
        value.wreck.claimedAtGameTime,
        'rpg.combat.wreck.claimedAtGameTime'
    );
    if (value.wreck.claimed !== (claimedAtGameTime !== null)) {
        throw new Error('Combat wreck claimed flag and game-time checkpoint must agree.');
    }
    if (value.wreck.claimed && value.enemy.disposition !== 'destroyed') {
        throw new Error('Combat wreck cannot be claimed before its enemy is destroyed.');
    }
    const history = Array.isArray(value.history)
        ? value.history.map((entry, index) => sanitizeHistoryEntry(entry, `rpg.combat.history[${index}]`))
        : (() => { throw new Error('rpg.combat.history must be an array.'); })();
    if (history.length > COMBAT_MAX_HISTORY) {
        throw new Error(`rpg.combat.history exceeds ${COMBAT_MAX_HISTORY} entries.`);
    }
    const lastOutcome = value.lastOutcome === null
        ? null
        : sanitizeHistoryEntry(value.lastOutcome, 'rpg.combat.lastOutcome');
    return {
        version: COMBAT_STATE_VERSION,
        enemy: {
            id: COMBAT_ENEMY_ID,
            disposition: value.enemy.disposition,
            destroyedAtGameTime
        },
        wreck: {
            id: COMBAT_WRECK_ID,
            claimed: value.wreck.claimed,
            claimedAtGameTime
        },
        lastOutcome,
        history
    };
}

function sanitizeHistoryEntry(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} must be an object.`);
    }
    if (typeof value.id !== 'string' || !/^combat-[0-9]{6}$/.test(value.id)) {
        throw new Error(`${label}.id is invalid.`);
    }
    if (!COMBAT_OUTCOMES.includes(value.outcome)) {
        throw new Error(`Unknown combat outcome: ${value.outcome ?? 'missing'}.`);
    }
    if (value.encounterId !== COMBAT_ENCOUNTER_ID || value.enemyId !== COMBAT_ENEMY_ID) {
        throw new Error(`${label} references an unknown combat encounter or enemy.`);
    }
    return {
        id: value.id,
        encounterId: COMBAT_ENCOUNTER_ID,
        enemyId: COMBAT_ENEMY_ID,
        outcome: value.outcome,
        atGameTime: sanitizeTime(value.atGameTime, `${label}.atGameTime`)
    };
}

function sanitizeOptionalTime(value, label) {
    return value === null ? null : sanitizeTime(value, label);
}

function sanitizeTime(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
        throw new Error(`${label} must be a non-negative finite number.`);
    }
    return number;
}
