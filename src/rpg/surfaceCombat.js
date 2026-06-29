export const SURFACE_COMBAT_STATE_VERSION = 1;
export const SURFACE_COMBAT_SYSTEM_ID = 'index_hq';
export const SURFACE_COMBAT_PLANET_ID = 'index_hq_planet_1';
export const SURFACE_COMBAT_SITE_ID = 'index_k7_black_cache';
export const SURFACE_COMBAT_ENCOUNTER_ID = 'index_k7_black_cache_encounter';
export const SURFACE_COMBAT_MISSION_ID = 'index_k7_black_cache_recovery';
export const SURFACE_COMBAT_OBJECTIVE_ID = 'index_k7_stolen_survey_core';
export const SURFACE_COMBAT_ENEMY_ID = 'k7_scavenger_sentry_drone';
export const SURFACE_COMBAT_WEAPON_ID = 'surface_pulse_carbine';
export const SURFACE_COMBAT_REWARD_CREDITS = 600;
export const SURFACE_COMBAT_MAX_ATTEMPTS = 20;

export const SURFACE_COMBAT_CHECKPOINTS = Object.freeze([
    'undiscovered',
    'approach',
    'active',
    'objective_recovered',
    'completed'
]);
export const SURFACE_COMBAT_ENEMY_DISPOSITIONS = Object.freeze([
    'available',
    'destroyed',
    'bypassed'
]);
export const SURFACE_COMBAT_ROUTES = Object.freeze(['evaded', 'combat_resolved']);
export const SURFACE_COMBAT_OUTCOMES = Object.freeze([
    'evaded',
    'combat_resolved',
    'defeat'
]);

export const SURFACE_COMBAT_LIMITS = Object.freeze({
    playerRange: 70,
    playerCooldown: 0.25,
    playerHeatPerShot: 0.2,
    playerCoolingPerSecond: 0.35,
    playerDamage: 25,
    enemyDetectionRange: 55,
    enemyAttackRange: 45,
    enemyCooldown: 1,
    enemyDamage: 10,
    enemyPatrolSpeed: 2.2,
    enemySearchSeconds: 5,
    objectiveRange: 2.8,
    playerSpawnExclusion: 12,
    shipSpawnExclusion: 30,
    enemyRadius: 1.2,
    maxFeedback: 24,
    maxShotEffects: 16
});

export function createInitialSurfaceCombatState() {
    return {
        version: SURFACE_COMBAT_STATE_VERSION,
        byId: {
            [SURFACE_COMBAT_ENCOUNTER_ID]: {
                id: SURFACE_COMBAT_ENCOUNTER_ID,
                siteId: SURFACE_COMBAT_SITE_ID,
                missionId: SURFACE_COMBAT_MISSION_ID,
                checkpoint: 'undiscovered',
                enemy: {
                    id: SURFACE_COMBAT_ENEMY_ID,
                    disposition: 'available',
                    integrity: 100
                },
                suitIntegrity: 100,
                objective: {
                    id: SURFACE_COMBAT_OBJECTIVE_ID,
                    recovered: false,
                    recoveredAtGameTime: null
                },
                reward: {
                    credits: SURFACE_COMBAT_REWARD_CREDITS,
                    claimed: false,
                    claimedAtGameTime: null
                },
                route: null,
                lastOutcome: null,
                attempts: []
            }
        }
    };
}

export function sanitizeSurfaceCombatState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('rpg.surfaceCombat must be an object.');
    }
    if (value.version !== SURFACE_COMBAT_STATE_VERSION) {
        throw new Error(`Unsupported surface-combat state version: ${value.version ?? 'missing'}.`);
    }
    const ids = Object.keys(value.byId ?? {});
    if (ids.some((id) => id !== SURFACE_COMBAT_ENCOUNTER_ID)) {
        throw new Error(`Unknown saved surface-combat encounter ID: ${ids.find((id) => id !== SURFACE_COMBAT_ENCOUNTER_ID)}.`);
    }
    const saved = value.byId?.[SURFACE_COMBAT_ENCOUNTER_ID];
    if (!saved || saved.id !== SURFACE_COMBAT_ENCOUNTER_ID) {
        throw new Error(`Surface-combat state requires encounter ${SURFACE_COMBAT_ENCOUNTER_ID}.`);
    }
    if (saved.siteId !== SURFACE_COMBAT_SITE_ID || saved.missionId !== SURFACE_COMBAT_MISSION_ID) {
        throw new Error('Surface-combat encounter references an unknown site or mission.');
    }
    if (!SURFACE_COMBAT_CHECKPOINTS.includes(saved.checkpoint)) {
        throw new Error(`Unknown surface-combat checkpoint: ${saved.checkpoint ?? 'missing'}.`);
    }
    if (saved.enemy?.id !== SURFACE_COMBAT_ENEMY_ID) {
        throw new Error(`Unknown surface-combat enemy ID: ${saved.enemy?.id ?? 'missing'}.`);
    }
    if (!SURFACE_COMBAT_ENEMY_DISPOSITIONS.includes(saved.enemy.disposition)) {
        throw new Error(`Unknown surface-combat enemy disposition: ${saved.enemy.disposition ?? 'missing'}.`);
    }
    const integrity = boundedNumber(saved.enemy.integrity, 0, 100, 'surfaceCombat.enemy.integrity');
    const suitIntegrity = boundedNumber(saved.suitIntegrity, 0, 100, 'surfaceCombat.suitIntegrity');
    if ((saved.enemy.disposition === 'destroyed') !== (integrity === 0)) {
        throw new Error('Destroyed surface-combat enemy must have zero integrity and available enemies must be alive.');
    }
    if (saved.objective?.id !== SURFACE_COMBAT_OBJECTIVE_ID) {
        throw new Error(`Unknown surface-combat objective ID: ${saved.objective?.id ?? 'missing'}.`);
    }
    if (typeof saved.objective.recovered !== 'boolean') {
        throw new Error('surfaceCombat.objective.recovered must be a boolean.');
    }
    const recoveredAtGameTime = optionalTime(
        saved.objective.recoveredAtGameTime,
        'surfaceCombat.objective.recoveredAtGameTime'
    );
    if (saved.objective.recovered !== (recoveredAtGameTime !== null)) {
        throw new Error('Surface-combat objective flag and recovery time must agree.');
    }
    if (
        saved.reward?.credits !== SURFACE_COMBAT_REWARD_CREDITS
        || typeof saved.reward.claimed !== 'boolean'
    ) {
        throw new Error('Surface-combat reward contract is invalid.');
    }
    const claimedAtGameTime = optionalTime(
        saved.reward.claimedAtGameTime,
        'surfaceCombat.reward.claimedAtGameTime'
    );
    if (saved.reward.claimed !== (claimedAtGameTime !== null)) {
        throw new Error('Surface-combat reward flag and claim time must agree.');
    }
    const route = saved.route === null || SURFACE_COMBAT_ROUTES.includes(saved.route)
        ? saved.route
        : (() => { throw new Error(`Unknown surface-combat route: ${saved.route}.`); })();
    const lastOutcome = saved.lastOutcome === null || SURFACE_COMBAT_OUTCOMES.includes(saved.lastOutcome)
        ? saved.lastOutcome
        : (() => { throw new Error(`Unknown surface-combat outcome: ${saved.lastOutcome}.`); })();
    const attempts = Array.isArray(saved.attempts)
        ? saved.attempts.map((entry, index) => sanitizeAttempt(entry, index))
        : (() => { throw new Error('surfaceCombat.attempts must be an array.'); })();
    if (attempts.length > SURFACE_COMBAT_MAX_ATTEMPTS) {
        throw new Error(`surfaceCombat.attempts exceeds ${SURFACE_COMBAT_MAX_ATTEMPTS} entries.`);
    }
    if (saved.objective.recovered && !route) {
        throw new Error('Recovered surface-combat objective requires an authored route.');
    }
    if (
        saved.objective.recovered
        && !['objective_recovered', 'completed'].includes(saved.checkpoint)
    ) {
        throw new Error('Recovered surface-combat objective requires an objective-recovered or completed checkpoint.');
    }
    if (
        ['objective_recovered', 'completed'].includes(saved.checkpoint)
        && !saved.objective.recovered
    ) {
        throw new Error('Surface-combat checkpoint requires a recovered objective.');
    }
    if (route === 'evaded' && saved.enemy.disposition !== 'bypassed') {
        throw new Error('Evaded surface-combat route requires a bypassed enemy.');
    }
    if (route === 'combat_resolved' && saved.enemy.disposition !== 'destroyed') {
        throw new Error('Combat-resolved route requires a destroyed enemy.');
    }
    if (saved.reward.claimed && (!saved.objective.recovered || saved.checkpoint !== 'completed')) {
        throw new Error('Surface-combat reward requires a completed recovered objective.');
    }
    if (saved.checkpoint === 'completed' && !saved.reward.claimed) {
        throw new Error('Completed surface-combat checkpoint requires the exact-once reward claim.');
    }
    return {
        version: SURFACE_COMBAT_STATE_VERSION,
        byId: {
            [SURFACE_COMBAT_ENCOUNTER_ID]: {
                id: SURFACE_COMBAT_ENCOUNTER_ID,
                siteId: SURFACE_COMBAT_SITE_ID,
                missionId: SURFACE_COMBAT_MISSION_ID,
                checkpoint: saved.checkpoint,
                enemy: {
                    id: SURFACE_COMBAT_ENEMY_ID,
                    disposition: saved.enemy.disposition,
                    integrity
                },
                suitIntegrity,
                objective: {
                    id: SURFACE_COMBAT_OBJECTIVE_ID,
                    recovered: saved.objective.recovered,
                    recoveredAtGameTime
                },
                reward: {
                    credits: SURFACE_COMBAT_REWARD_CREDITS,
                    claimed: saved.reward.claimed,
                    claimedAtGameTime
                },
                route,
                lastOutcome,
                attempts
            }
        }
    };
}

export function selectSurfaceCombatSpawn({
    candidates,
    structures = [],
    playerPosition = null,
    shipPosition = null,
    terrainClear = () => true
} = {}) {
    if (!Array.isArray(candidates) || !candidates.length) {
        throw new Error('Surface-combat spawn selection requires ordered candidates.');
    }
    for (const candidate of candidates) {
        const position = finiteVector(candidate?.position, 'surface-combat spawn candidate');
        const radius = boundedNumber(
            candidate?.radius ?? SURFACE_COMBAT_LIMITS.enemyRadius,
            0.1,
            10,
            'surface-combat spawn radius'
        );
        if (!terrainClear(position, radius)) continue;
        if (structures.some((structure) => sphereIntersectsAabb(position, radius, structure))) continue;
        if (playerPosition && distance(position, finiteVector(playerPosition, 'player spawn exclusion')) < SURFACE_COMBAT_LIMITS.playerSpawnExclusion) continue;
        if (shipPosition && distance(position, finiteVector(shipPosition, 'ship spawn exclusion')) < SURFACE_COMBAT_LIMITS.shipSpawnExclusion) continue;
        return { id: candidate.id, position, radius };
    }
    throw new Error('No terrain/structure/player/ship-safe surface-combat spawn candidate exists.');
}

export function segmentIntersectsAabb(startValue, endValue, box) {
    const start = finiteVector(startValue, 'line start');
    const end = finiteVector(endValue, 'line end');
    const min = finiteVector(box?.min, 'cover minimum');
    const max = finiteVector(box?.max, 'cover maximum');
    let tMin = 0;
    let tMax = 1;
    for (let axis = 0; axis < 3; axis += 1) {
        const delta = end[axis] - start[axis];
        if (Math.abs(delta) < 1e-9) {
            if (start[axis] < min[axis] || start[axis] > max[axis]) return false;
            continue;
        }
        const inverse = 1 / delta;
        let near = (min[axis] - start[axis]) * inverse;
        let far = (max[axis] - start[axis]) * inverse;
        if (near > far) [near, far] = [far, near];
        tMin = Math.max(tMin, near);
        tMax = Math.min(tMax, far);
        if (tMin > tMax) return false;
    }
    return true;
}

export function isSurfaceCombatLineClear({
    start,
    end,
    structures = [],
    terrainBlocked = () => false
} = {}) {
    const left = finiteVector(start, 'line start');
    const right = finiteVector(end, 'line end');
    if (structures.some((structure) => segmentIntersectsAabb(left, right, structure))) return false;
    return !terrainBlocked(left, right);
}

function sanitizeAttempt(value, index) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`surfaceCombat.attempts[${index}] must be an object.`);
    }
    if (value.id !== `surface-combat-${String(index + 1).padStart(6, '0')}`) {
        throw new Error(`surfaceCombat.attempts[${index}].id is invalid.`);
    }
    if (!SURFACE_COMBAT_OUTCOMES.includes(value.outcome)) {
        throw new Error(`Unknown surface-combat attempt outcome: ${value.outcome ?? 'missing'}.`);
    }
    return {
        id: value.id,
        encounterId: value.encounterId === SURFACE_COMBAT_ENCOUNTER_ID
            ? value.encounterId
            : (() => { throw new Error('Surface-combat attempt references an unknown encounter.'); })(),
        missionId: value.missionId === SURFACE_COMBAT_MISSION_ID
            ? value.missionId
            : (() => { throw new Error('Surface-combat attempt references an unknown mission.'); })(),
        outcome: value.outcome,
        atGameTime: nonNegativeTime(value.atGameTime, `surfaceCombat.attempts[${index}].atGameTime`)
    };
}

function sphereIntersectsAabb(position, radius, box) {
    const min = finiteVector(box?.min, 'structure minimum');
    const max = finiteVector(box?.max, 'structure maximum');
    let distanceSquared = 0;
    for (let axis = 0; axis < 3; axis += 1) {
        const value = position[axis];
        const nearest = Math.max(min[axis], Math.min(max[axis], value));
        distanceSquared += (value - nearest) ** 2;
    }
    return distanceSquared < radius * radius;
}

function optionalTime(value, label) {
    return value === null ? null : nonNegativeTime(value, label);
}

function nonNegativeTime(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
        throw new Error(`${label} must be a non-negative finite number.`);
    }
    return number;
}

function boundedNumber(value, min, max, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${label} must be finite.`);
    return Math.min(max, Math.max(min, number));
}

function finiteVector(value, label) {
    if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} must be a 3-vector.`);
    const result = value.map(Number);
    if (result.some((entry) => !Number.isFinite(entry))) throw new Error(`${label} must contain finite values.`);
    return result;
}

function distance(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
