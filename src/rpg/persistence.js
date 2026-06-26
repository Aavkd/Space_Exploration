import { createInitialRpgState, sanitizeRpgState } from './state.js';

export const RPG_LOCAL_STORAGE_KEY = 'deep-space-vr:rpg-state:v1';

export class LocalRpgPersistence {
    constructor({ storage = globalThis.localStorage, key = RPG_LOCAL_STORAGE_KEY } = {}) {
        this.storage = storage;
        this.key = key;
    }

    load() {
        if (!this.storage) return createInitialRpgState();

        try {
            const raw = this.storage.getItem(this.key);
            if (!raw) return createInitialRpgState();
            return sanitizeRpgState(JSON.parse(raw));
        } catch (error) {
            console.warn('Could not load RPG state; starting from a fresh state.', error);
            return createInitialRpgState();
        }
    }

    save(state) {
        const sanitized = sanitizeRpgState(state);
        if (!this.storage) return sanitized;

        try {
            this.storage.setItem(this.key, JSON.stringify(sanitized));
        } catch (error) {
            console.warn('Could not save RPG state.', error);
        }

        return sanitized;
    }

    reset() {
        if (this.storage) {
            try {
                this.storage.removeItem(this.key);
            } catch (error) {
                console.warn('Could not clear RPG state.', error);
            }
        }

        const state = createInitialRpgState();
        this.save(state);
        return state;
    }
}
