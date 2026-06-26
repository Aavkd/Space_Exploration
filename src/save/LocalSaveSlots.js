import { RPG_LOCAL_STORAGE_KEY } from '../rpg/persistence.js';
import { createInitialRpgState } from '../rpg/state.js';
import {
    createEnvelopePreview,
    createSaveEnvelope,
    migrateLegacyRpgSave,
    sanitizeSaveEnvelope
} from './SaveEnvelope.js';

export const SAVE_INDEX_KEY = 'deep-space-vr:save-index:v3';
export const SAVE_SLOT_KEY_PREFIX = 'deep-space-vr:save-slot:v3:';
export const LEGACY_SAVE_INDEX_KEY = 'deep-space-vr:save-index:v2';
export const LEGACY_SAVE_SLOT_KEY_PREFIX = 'deep-space-vr:save-slot:v2:';
export const SAVE_SLOT_LIMIT = 3;

export class LocalSaveSlots {
    constructor({
        storage = globalThis.localStorage,
        now = () => new Date().toISOString(),
        makeId = defaultIdFactory
    } = {}) {
        this.storage = storage;
        this.now = now;
        this.makeId = makeId;
        this.index = { version: 1, activeSlotId: null, slotIds: [] };
        this.activeEnvelope = null;
        this.lastError = null;
        this.pendingPreview = null;
        this.initialize();
    }

    initialize() {
        try {
            const rawIndex = this.storage?.getItem(SAVE_INDEX_KEY);
            if (rawIndex) {
                this.index = sanitizeIndex(JSON.parse(rawIndex));
                this.activeEnvelope = this.index.activeSlotId
                    ? this._readSlot(this.index.activeSlotId)
                    : null;
            } else {
                const legacyIndex = this.storage?.getItem(LEGACY_SAVE_INDEX_KEY);
                if (legacyIndex) this._migrateVersion2Slots(legacyIndex);
            }
            if (!this.activeEnvelope) this._initializeFirstSlot();
        } catch (error) {
            this._recordError('initialize', error);
            this.index = { version: 1, activeSlotId: 'slot-memory', slotIds: ['slot-memory'] };
            this.activeEnvelope = createSaveEnvelope({
                slotId: 'slot-memory',
                slotName: 'In-memory Flight',
                now: this.now()
            });
        }
        return this.getStatus();
    }

    listSlots() {
        return this.index.slotIds.map((slotId) => {
            const envelope = slotId === this.index.activeSlotId ? this.activeEnvelope : this._readSlot(slotId);
            return {
                id: slotId,
                name: envelope.slot.name,
                updatedAt: envelope.slot.updatedAt,
                active: slotId === this.index.activeSlotId,
                autosave: structuredClone(envelope.autosave),
                preview: createEnvelopePreview(envelope)
            };
        });
    }

    getActiveEnvelope() {
        return structuredClone(this.activeEnvelope);
    }

    createSlot(name = 'New Flight') {
        this._assertCapacity();
        const id = this._nextUniqueId();
        const envelope = createSaveEnvelope({ slotId: id, slotName: name, now: this.now() });
        const nextIndex = {
            ...this.index,
            activeSlotId: id,
            slotIds: [...this.index.slotIds, id]
        };
        this._commitNewSlot(envelope, nextIndex);
        return this.getActiveEnvelope();
    }

    loadSlot(slotId) {
        this._assertKnownSlot(slotId);
        const envelope = this._readSlot(slotId);
        this.index = { ...this.index, activeSlotId: slotId };
        this._writeIndex();
        this.activeEnvelope = envelope;
        return this.getActiveEnvelope();
    }

    deleteSlot(slotId) {
        this._assertKnownSlot(slotId);
        if (this.index.slotIds.length === 1) {
            throw new Error('Cannot delete the only save slot; create another slot first.');
        }
        const slotIds = this.index.slotIds.filter((id) => id !== slotId);
        const activeSlotId = this.index.activeSlotId === slotId ? slotIds[0] : this.index.activeSlotId;
        const nextActive = activeSlotId === this.index.activeSlotId ? this.activeEnvelope : this._readSlot(activeSlotId);
        try {
            this.storage?.removeItem(this._slotKey(slotId));
            this.index = { ...this.index, activeSlotId, slotIds };
            this._writeIndex();
            this.activeEnvelope = nextActive;
            return this.getActiveEnvelope();
        } catch (error) {
            this._recordError('delete', error);
            throw new Error(`Could not delete save slot ${slotId}: ${error.message}`);
        }
    }

    saveDomains({ rpg, ship, gameTime }, { kind = 'auto', reason = 'state-change' } = {}) {
        const now = this.now();
        const next = sanitizeSaveEnvelope({
            ...this.activeEnvelope,
            slot: { ...this.activeEnvelope.slot, updatedAt: now },
            autosave: {
                kind,
                reason,
                savedAt: now,
                sequence: this.activeEnvelope.autosave.sequence + 1
            },
            ship: ship ?? this.activeEnvelope.ship,
            rpg: rpg ?? this.activeEnvelope.rpg,
            simulation: {
                gameTime: gameTime ?? this.activeEnvelope.simulation.gameTime
            }
        });
        try {
            this._writeSlot(next);
            this.activeEnvelope = next;
            this.lastError = null;
        } catch (error) {
            // The authoritative runtime continues from the validated in-memory
            // state even when durable storage is unavailable. The visible
            // error remains sticky until a later write succeeds.
            this.activeEnvelope = next;
            this._recordError('save', error);
        }
        return this.getActiveEnvelope();
    }

    exportSlot(slotId = this.index.activeSlotId) {
        this._assertKnownSlot(slotId);
        const envelope = slotId === this.index.activeSlotId ? this.activeEnvelope : this._readSlot(slotId);
        return JSON.stringify(sanitizeSaveEnvelope(envelope), null, 2);
    }

    previewImport(text) {
        let envelope;
        try {
            envelope = sanitizeSaveEnvelope(JSON.parse(text));
        } catch (error) {
            throw new Error(`Save import rejected: ${error.message}`);
        }
        const token = hashText(text);
        this.pendingPreview = { token, envelope };
        return {
            token,
            ...createEnvelopePreview(envelope)
        };
    }

    importPreviewed(text, token) {
        this._assertCapacity();
        if (!this.pendingPreview || token !== this.pendingPreview.token || token !== hashText(text)) {
            throw new Error('Save import requires an unchanged validated preview.');
        }
        const id = this._nextUniqueId();
        const now = this.now();
        const envelope = sanitizeSaveEnvelope({
            ...this.pendingPreview.envelope,
            slot: {
                id,
                name: `${this.pendingPreview.envelope.slot.name} (Imported)`,
                createdAt: now,
                updatedAt: now
            },
            autosave: {
                kind: 'import',
                reason: 'validated-import',
                savedAt: now,
                sequence: this.pendingPreview.envelope.autosave.sequence + 1
            }
        });
        this._commitNewSlot(envelope, {
            ...this.index,
            activeSlotId: id,
            slotIds: [...this.index.slotIds, id]
        });
        this.pendingPreview = null;
        return this.getActiveEnvelope();
    }

    resetActiveSlot() {
        const current = this.activeEnvelope;
        const envelope = createSaveEnvelope({
            slotId: current.slot.id,
            slotName: current.slot.name,
            now: this.now()
        });
        this._writeSlot(envelope);
        this.activeEnvelope = envelope;
        return this.getActiveEnvelope();
    }

    getStatus() {
        return {
            available: Boolean(this.storage),
            activeSlotId: this.index.activeSlotId,
            slotCount: this.index.slotIds.length,
            limit: SAVE_SLOT_LIMIT,
            lastError: this.lastError ? { ...this.lastError } : null
        };
    }

    _initializeFirstSlot() {
        const legacyRaw = this.storage?.getItem(RPG_LOCAL_STORAGE_KEY);
        const id = this._nextUniqueId();
        const now = this.now();
        const envelope = legacyRaw
            ? migrateLegacyRpgSave(JSON.parse(legacyRaw), { slotId: id, now })
            : createSaveEnvelope({ slotId: id, slotName: 'Flight 1', now, rpg: createInitialRpgState() });
        this._commitNewSlot(envelope, { version: 1, activeSlotId: id, slotIds: [id] });
    }

    _migrateVersion2Slots(rawIndex) {
        const legacyIndex = sanitizeIndex(JSON.parse(rawIndex));
        const envelopes = legacyIndex.slotIds.map((slotId) => {
            const raw = this.storage?.getItem(`${LEGACY_SAVE_SLOT_KEY_PREFIX}${slotId}`);
            if (!raw) throw new Error(`Phase 13 save slot data is missing: ${slotId}`);
            return sanitizeSaveEnvelope(JSON.parse(raw));
        });
        for (const envelope of envelopes) this._writeSlot(envelope);
        this.index = legacyIndex;
        this._writeIndex();
        this.activeEnvelope = envelopes.find(
            (envelope) => envelope.slot.id === legacyIndex.activeSlotId
        ) ?? null;
    }

    _commitNewSlot(envelope, index) {
        try {
            this._writeSlot(envelope);
            const previous = this.index;
            this.index = sanitizeIndex(index);
            try {
                this._writeIndex();
            } catch (error) {
                this.index = previous;
                this.storage?.removeItem(this._slotKey(envelope.slot.id));
                throw error;
            }
            this.activeEnvelope = envelope;
            this.lastError = null;
        } catch (error) {
            this._recordError('create', error);
            throw new Error(`Could not create save slot: ${error.message}`);
        }
    }

    _readSlot(slotId) {
        const raw = this.storage?.getItem(this._slotKey(slotId));
        if (!raw) throw new Error(`Save slot data is missing: ${slotId}`);
        return sanitizeSaveEnvelope(JSON.parse(raw));
    }

    _writeSlot(envelope) {
        if (!this.storage) throw new Error('Browser storage is unavailable.');
        this.storage.setItem(this._slotKey(envelope.slot.id), JSON.stringify(envelope));
    }

    _writeIndex() {
        if (!this.storage) throw new Error('Browser storage is unavailable.');
        this.storage.setItem(SAVE_INDEX_KEY, JSON.stringify(this.index));
    }

    _assertKnownSlot(slotId) {
        if (!this.index.slotIds.includes(slotId)) throw new Error(`Unknown save slot ID: ${slotId}`);
    }

    _assertCapacity() {
        if (this.index.slotIds.length >= SAVE_SLOT_LIMIT) {
            throw new Error(`Save slot limit reached (${SAVE_SLOT_LIMIT}); delete a slot before creating or importing.`);
        }
    }

    _nextUniqueId() {
        for (let attempt = 0; attempt < 20; attempt += 1) {
            const id = this.makeId();
            if (!this.index.slotIds.includes(id)) return id;
        }
        throw new Error('Could not allocate a unique save slot ID.');
    }

    _slotKey(slotId) {
        return `${SAVE_SLOT_KEY_PREFIX}${slotId}`;
    }

    _recordError(operation, error) {
        this.lastError = {
            operation,
            message: error instanceof Error ? error.message : String(error),
            occurredAt: this.now()
        };
        console.warn(`Save slot ${operation} failed; continuing in memory.`, error);
    }
}

export class SlotRpgPersistence {
    constructor({ slots, getGameTime = () => 0 } = {}) {
        if (!slots) throw new Error('SlotRpgPersistence requires a save-slot manager.');
        this.slots = slots;
        this.getGameTime = getGameTime;
    }

    load() {
        return this.slots.getActiveEnvelope().rpg;
    }

    save(state) {
        return this.slots.saveDomains(
            { rpg: state, gameTime: this.getGameTime() },
            { kind: 'auto', reason: 'authoritative-rpg-change' }
        ).rpg;
    }

    reset() {
        return this.slots.resetActiveSlot().rpg;
    }
}

function sanitizeIndex(value) {
    if (value?.version !== 1 || !Array.isArray(value.slotIds)) throw new Error('Invalid save slot index.');
    const slotIds = [...new Set(value.slotIds)];
    if (slotIds.length > SAVE_SLOT_LIMIT) throw new Error(`Save slot index exceeds limit ${SAVE_SLOT_LIMIT}.`);
    if (slotIds.some((id) => typeof id !== 'string' || !/^slot-[a-z0-9-]+$/.test(id))) {
        throw new Error('Save slot index contains an invalid slot ID.');
    }
    if (value.activeSlotId !== null && !slotIds.includes(value.activeSlotId)) {
        throw new Error(`Active save slot is not present in the index: ${value.activeSlotId}`);
    }
    return { version: 1, activeSlotId: value.activeSlotId, slotIds };
}

function defaultIdFactory() {
    return `slot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function hashText(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `preview-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
