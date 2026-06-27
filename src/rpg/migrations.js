import { createInitialNpcState } from './npcs.js';
import { createInitialSurfaceState } from './surfaceOutposts.js';
import { createInitialPatrolState, migratePatrolStateV1 } from './patrols.js';
import { createInitialCombatState } from './combat.js';
import { createInitialBoardingState } from './boarding.js';
import { RPG_STATE_VERSION } from './state.js';

// Add one entry per historical version when RPG_STATE_VERSION is increased.
// Each migration must return a new plain object whose version is exactly the
// next integer. Keeping the registry explicit prevents silent save corruption.
export const RPG_STATE_MIGRATIONS = Object.freeze({
    1: (state) => ({ ...state, version: 2 }),
    2: (state) => ({ ...state, version: 3, npcs: createInitialNpcState() }),
    3: (state) => ({ ...state, version: 4, surface: createInitialSurfaceState() }),
    4: (state) => ({
        ...state,
        version: 5,
        patrol: { ...createInitialPatrolState(), version: 1 }
    }),
    5: (state) => ({ ...state, version: 6, combat: createInitialCombatState() }),
    6: (state) => ({
        ...state,
        version: 7,
        patrol: state.patrol?.version === 2
            ? structuredClone(state.patrol)
            : migratePatrolStateV1(state.patrol)
    }),
    7: (state) => ({ ...state, version: 8, boarding: createInitialBoardingState() })
});

export function migrateRpgState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('RPG save data is not an object.');
    }

    const sourceVersion = Number(value.version);
    if (!Number.isInteger(sourceVersion) || sourceVersion < 1) {
        throw new Error(`Invalid RPG save version: ${value.version ?? 'missing'}.`);
    }
    if (sourceVersion > RPG_STATE_VERSION) {
        throw new Error(
            `RPG save version ${sourceVersion} is newer than supported version ${RPG_STATE_VERSION}.`
        );
    }

    let next = structuredClone(value);
    while (next.version < RPG_STATE_VERSION) {
        const migrate = RPG_STATE_MIGRATIONS[next.version];
        if (typeof migrate !== 'function') {
            throw new Error(
                `No RPG save migration from version ${next.version} to ${next.version + 1}.`
            );
        }

        const previousVersion = next.version;
        next = migrate(structuredClone(next));
        if (!next || typeof next !== 'object' || next.version !== previousVersion + 1) {
            throw new Error(
                `RPG save migration ${previousVersion} must produce version ${previousVersion + 1}.`
            );
        }
    }

    return next;
}
