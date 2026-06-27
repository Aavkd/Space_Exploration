import {
    BOARDING_ENCOUNTER_ID,
    BOARDING_LIMITS
} from '../rpg/boarding.js';

export const PLAYER_STATE_VERSION = 1;
export const PLAYER_LOCATIONS = Object.freeze(['ship', 'eva', 'derelict']);
export const PLAYER_REFERENCE_FRAMES = Object.freeze([
    'ship-local',
    'boarding-local',
    'derelict-local'
]);

export function createInitialPlayerState(gameTime = 0) {
    return {
        version: PLAYER_STATE_VERSION,
        location: 'ship',
        referenceFrame: 'ship-local',
        encounterId: null,
        position: [0, 0, 0],
        velocity: [0, 0, 0],
        yaw: 0,
        pitch: 0,
        oxygenRemaining: BOARDING_LIMITS.oxygenSeconds,
        oxygenUpdatedAtGameTime: finiteNonNegative(gameTime, 'player.oxygenUpdatedAtGameTime')
    };
}

export function sanitizePlayerState(value, { gameTime = 0 } = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Save domain player must be an object.');
    }
    if (value.version !== PLAYER_STATE_VERSION) {
        throw new Error(`Unsupported player state version: ${value.version ?? 'missing'}.`);
    }
    if (!PLAYER_LOCATIONS.includes(value.location)) {
        throw new Error(`Unknown player location: ${value.location ?? 'missing'}.`);
    }
    if (!PLAYER_REFERENCE_FRAMES.includes(value.referenceFrame)) {
        throw new Error(`Unknown player reference frame: ${value.referenceFrame ?? 'missing'}.`);
    }
    const aboard = value.location === 'ship';
    const expectedFrame = aboard
        ? 'ship-local'
        : value.location === 'eva' ? 'boarding-local' : 'derelict-local';
    if (value.referenceFrame !== expectedFrame) {
        throw new Error(`Player location ${value.location} requires reference frame ${expectedFrame}.`);
    }
    if (aboard ? value.encounterId !== null : value.encounterId !== BOARDING_ENCOUNTER_ID) {
        throw new Error(
            aboard
                ? 'Aboard player state cannot retain a boarding encounter ID.'
                : `Off-ship player state requires encounter ${BOARDING_ENCOUNTER_ID}.`
        );
    }
    const position = boundedVector(value.position, 'player.position', aboard ? 100 : BOARDING_LIMITS.recoveryRangeMetres);
    const velocity = boundedVector(value.velocity, 'player.velocity', aboard ? 1000 : BOARDING_LIMITS.evaMaxSpeed);
    const yaw = finiteNumber(value.yaw, 'player.yaw');
    const pitch = clamp(finiteNumber(value.pitch, 'player.pitch'), -Math.PI / 2, Math.PI / 2);
    const oxygenRemaining = clamp(
        finiteNumber(value.oxygenRemaining, 'player.oxygenRemaining'),
        0,
        BOARDING_LIMITS.oxygenSeconds
    );
    const oxygenUpdatedAtGameTime = finiteNonNegative(
        value.oxygenUpdatedAtGameTime,
        'player.oxygenUpdatedAtGameTime'
    );
    if (oxygenUpdatedAtGameTime > finiteNonNegative(gameTime, 'simulation.gameTime')) {
        throw new Error('Player oxygen update time cannot be later than simulation game time.');
    }
    return {
        version: PLAYER_STATE_VERSION,
        location: value.location,
        referenceFrame: value.referenceFrame,
        encounterId: value.encounterId,
        position,
        velocity,
        yaw,
        pitch,
        oxygenRemaining,
        oxygenUpdatedAtGameTime
    };
}

export function assertPlayerBoardingConsistency(player, boarding) {
    const checkpoint = boarding?.byId?.wayfarer_research_derelict?.checkpoint;
    if (player.location === 'ship') {
        if (['outside', 'inside', 'returning'].includes(checkpoint)) {
            throw new Error(`Aboard player state conflicts with boarding checkpoint ${checkpoint}.`);
        }
        return true;
    }
    if (player.location === 'derelict' && !['inside', 'objective_complete'].includes(checkpoint)) {
        throw new Error(`Derelict-local player state conflicts with boarding checkpoint ${checkpoint ?? 'missing'}.`);
    }
    if (player.location === 'eva' && !['outside', 'returning'].includes(checkpoint)) {
        throw new Error(`Boarding EVA player state conflicts with checkpoint ${checkpoint ?? 'missing'}.`);
    }
    return true;
}

function boundedVector(value, label, maximumLength) {
    if (!Array.isArray(value) || value.length !== 3) {
        throw new Error(`${label} must contain exactly three numbers.`);
    }
    const next = value.map((entry) => finiteNumber(entry, label));
    const length = Math.hypot(...next);
    if (length <= maximumLength || length <= 1e-9) return next;
    const ratio = maximumLength / length;
    return next.map((entry) => entry * ratio);
}

function finiteNumber(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number.`);
    return number;
}

function finiteNonNegative(value, label) {
    const number = finiteNumber(value, label);
    if (number < 0) throw new Error(`${label} must be non-negative.`);
    return number;
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
