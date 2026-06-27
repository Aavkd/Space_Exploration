export const BOARDING_ENCOUNTER_ID = 'wayfarer_derelict_boarding';
export const BOARDING_DERELICT_ID = 'wayfarer_research_derelict';
export const BOARDING_MISSION_ID = 'wayfarer_derelict_recovery';
export const BOARDING_LOG_ID = 'wayfarer_derelict_ops_log';
export const BOARDING_SYSTEM_ID = 'drifter_convergence';

export const BOARDING_CHECKPOINTS = Object.freeze([
    'undiscovered',
    'approach',
    'outside',
    'inside',
    'objective_complete',
    'returning',
    'completed'
]);

export const BOARDING_RECOVERY_REASONS = Object.freeze([
    'explicit',
    'oxygen-depleted',
    'range-exceeded',
    'runtime-recovery'
]);

export const BOARDING_LIMITS = Object.freeze({
    systemLocalPosition: Object.freeze([0, 0, 43050]),
    secureRangeMetres: 75,
    secureSpeedMetresPerSecond: 1.5,
    hatchRangeMetres: 2.5,
    logRangeMetres: 1.8,
    oxygenSeconds: 180,
    oxygenWarnings: Object.freeze([60, 30, 10]),
    rangeWarningMetres: 110,
    recoveryRangeMetres: 150,
    evaAcceleration: 1.4,
    evaMaxSpeed: 3,
    evaDamping: 2,
    interiorBounds: Object.freeze({
        minX: -6,
        maxX: 6,
        minY: 0,
        maxY: 6,
        minZ: -9,
        maxZ: 9
    })
});

export const BOARDING_DEFINITION = Object.freeze({
    id: BOARDING_DERELICT_ID,
    encounterId: BOARDING_ENCOUNTER_ID,
    missionId: BOARDING_MISSION_ID,
    logId: BOARDING_LOG_ID,
    systemId: BOARDING_SYSTEM_ID,
    name: 'Wayfarer Survey Wreck',
    navigationLabel: 'Wayfarer Survey Wreck [EVA]',
    type: 'derelict',
    systemLocalPosition: BOARDING_LIMITS.systemLocalPosition,
    placeholderArt: true
});

export function getBoardingDefinition(id = BOARDING_DERELICT_ID) {
    if (id !== BOARDING_DERELICT_ID) throw new Error(`Unknown boarding derelict ID: ${id}`);
    return structuredClone(BOARDING_DEFINITION);
}

export function findBoardingPoiForSystem(systemId) {
    return systemId === BOARDING_SYSTEM_ID ? getBoardingDefinition() : null;
}

export function createInitialBoardingState() {
    return {
        byId: {
            [BOARDING_DERELICT_ID]: {
                id: BOARDING_DERELICT_ID,
                checkpoint: 'undiscovered',
                discoveredAt: null,
                departedAt: null,
                enteredAt: null,
                logRecoveredAt: null,
                returningAt: null,
                completedAt: null,
                recoveryCount: 0,
                lastRecoveryReason: null
            }
        }
    };
}

export function sanitizeBoardingState(value) {
    const base = createInitialBoardingState();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
    if (!value.byId || typeof value.byId !== 'object' || Array.isArray(value.byId)) {
        throw new Error('Boarding state byId must be an object.');
    }
    for (const id of Object.keys(value.byId)) {
        if (id !== BOARDING_DERELICT_ID) throw new Error(`Unknown saved boarding derelict ID: ${id}`);
    }
    const saved = value.byId[BOARDING_DERELICT_ID];
    if (!saved) return base;
    if (saved.id !== BOARDING_DERELICT_ID) {
        throw new Error(`Boarding state ID must be ${BOARDING_DERELICT_ID}.`);
    }
    const checkpoint = BOARDING_CHECKPOINTS.includes(saved.checkpoint)
        ? saved.checkpoint
        : 'undiscovered';
    const next = {
        id: BOARDING_DERELICT_ID,
        checkpoint,
        discoveredAt: optionalTimestamp(saved.discoveredAt, 'boarding.discoveredAt'),
        departedAt: optionalTimestamp(saved.departedAt, 'boarding.departedAt'),
        enteredAt: optionalTimestamp(saved.enteredAt, 'boarding.enteredAt'),
        logRecoveredAt: optionalTimestamp(saved.logRecoveredAt, 'boarding.logRecoveredAt'),
        returningAt: optionalTimestamp(saved.returningAt, 'boarding.returningAt'),
        completedAt: optionalTimestamp(saved.completedAt, 'boarding.completedAt'),
        recoveryCount: boundedInteger(saved.recoveryCount, 'boarding.recoveryCount', 0, 999),
        lastRecoveryReason: saved.lastRecoveryReason === null || saved.lastRecoveryReason === undefined
            ? null
            : recoveryReason(saved.lastRecoveryReason)
    };
    const requiresDiscovery = checkpoint !== 'undiscovered';
    const requiresLog = ['objective_complete', 'returning', 'completed'].includes(checkpoint);
    if (requiresDiscovery !== (next.discoveredAt !== null)) {
        throw new Error('Boarding discovery checkpoint and timestamp must agree.');
    }
    if (requiresLog !== (next.logRecoveredAt !== null)) {
        throw new Error('Boarding log checkpoint and timestamp must agree.');
    }
    if ((checkpoint === 'completed') !== (next.completedAt !== null)) {
        throw new Error('Boarding completion checkpoint and timestamp must agree.');
    }
    if ((next.recoveryCount > 0) !== (next.lastRecoveryReason !== null)) {
        throw new Error('Boarding recovery count and reason must agree.');
    }
    return { byId: { [BOARDING_DERELICT_ID]: next } };
}

export function evaluateBoardingSecureGate({ systemId, distanceMetres, speedMetresPerSecond } = {}) {
    if (systemId !== BOARDING_SYSTEM_ID) {
        return {
            allowed: false,
            reason: `Boarding requires authored system ${BOARDING_SYSTEM_ID}; received ${systemId ?? 'none'}.`
        };
    }
    const distance = finiteNonNegative(distanceMetres, 'Boarding distance');
    const speed = finiteNonNegative(speedMetresPerSecond, 'Boarding ship speed');
    if (distance > BOARDING_LIMITS.secureRangeMetres) {
        return {
            allowed: false,
            reason: `Derelict is out of secure range: ${distance.toFixed(1)} m; ${BOARDING_LIMITS.secureRangeMetres} m required.`
        };
    }
    if (speed > BOARDING_LIMITS.secureSpeedMetresPerSecond) {
        return {
            allowed: false,
            reason: `Ship speed is too high to secure: ${speed.toFixed(2)} m/s; ${BOARDING_LIMITS.secureSpeedMetresPerSecond} m/s maximum.`
        };
    }
    return { allowed: true, reason: null };
}

export function advanceEvaMotion(state, input, dt) {
    const elapsed = Number(dt);
    if (!Number.isFinite(elapsed) || elapsed < 0) {
        throw new Error('EVA motion dt must be a non-negative finite number.');
    }
    const position = finiteVector(state?.position, 'EVA position');
    const velocity = finiteVector(state?.velocity, 'EVA velocity');
    const thrust = finiteVector(input ?? [0, 0, 0], 'EVA input').map((entry) => clamp(entry, -1, 1));
    const inputLength = Math.hypot(...thrust);
    const direction = inputLength > 1 ? thrust.map((entry) => entry / inputLength) : thrust;
    if (inputLength > 1e-9) {
        for (let i = 0; i < 3; i += 1) {
            velocity[i] += direction[i] * BOARDING_LIMITS.evaAcceleration * elapsed;
        }
    } else {
        const speed = Math.hypot(...velocity);
        const nextSpeed = Math.max(0, speed - BOARDING_LIMITS.evaDamping * elapsed);
        const ratio = speed > 1e-9 ? nextSpeed / speed : 0;
        for (let i = 0; i < 3; i += 1) velocity[i] *= ratio;
    }
    const speed = Math.hypot(...velocity);
    if (speed > BOARDING_LIMITS.evaMaxSpeed) {
        const ratio = BOARDING_LIMITS.evaMaxSpeed / speed;
        for (let i = 0; i < 3; i += 1) velocity[i] *= ratio;
    }
    for (let i = 0; i < 3; i += 1) position[i] += velocity[i] * elapsed;
    return { position, velocity };
}

export function consumeBoardingOxygen({ remaining, updatedAtGameTime }, gameTime) {
    const previous = finiteNonNegative(updatedAtGameTime, 'Oxygen update game time');
    const now = finiteNonNegative(gameTime, 'Boarding game time');
    if (now < previous) throw new Error('Boarding game time cannot move backwards.');
    return {
        remaining: clamp(finiteNonNegative(remaining, 'Oxygen remaining') - (now - previous), 0, BOARDING_LIMITS.oxygenSeconds),
        updatedAtGameTime: now
    };
}

export function boardingCheckpointIndex(checkpoint) {
    const index = BOARDING_CHECKPOINTS.indexOf(checkpoint);
    if (index < 0) throw new Error(`Unknown boarding checkpoint: ${checkpoint}`);
    return index;
}

function optionalTimestamp(value, label) {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
        throw new Error(`${label} must be an ISO timestamp or null.`);
    }
    return value;
}

function boundedInteger(value, label, minimum, maximum) {
    const number = Number(value ?? minimum);
    if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number.`);
    return clamp(Math.floor(number), minimum, maximum);
}

function recoveryReason(value) {
    if (!BOARDING_RECOVERY_REASONS.includes(value)) {
        throw new Error(`Unknown boarding recovery reason: ${value}`);
    }
    return value;
}

function finiteNonNegative(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a non-negative finite number.`);
    return number;
}

function finiteVector(value, label) {
    if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} must contain exactly three numbers.`);
    const next = value.map(Number);
    if (next.some((entry) => !Number.isFinite(entry))) throw new Error(`${label} entries must be finite.`);
    return next;
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
