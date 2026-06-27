import { MISSION_STATUSES } from './missions.js';
import {
    clampRelationship,
    CREW_NPC_ID,
    isNpcPhysicallyPresent,
    NPC_DEFINITIONS
} from './npcs.js';
import { cloneRpgValue, sanitizeRpgState } from './state.js';

export const CREW_INTERACTION_STATES = Object.freeze([
    'offline',
    'connecting',
    'listening',
    'responding',
    'interrupted',
    'failed'
]);

const CLEAN_COPY_ID = 'port_meridian_route_packet';
const DELIVERY_ID = 'index_archive_delivery';
const RELATIONSHIP_CHOICES = Object.freeze({
    trust_lyras_judgment: Object.freeze({
        id: 'trust_lyras_judgment',
        label: 'Tell Lyra you trust her judgment.',
        memoryId: 'crew.choice.trusted-judgment',
        delta: 0.15,
        mood: 'warm',
        response: 'Then I will speak plainly when the ship needs it. Even when plainly is inconvenient.'
    }),
    keep_it_professional: Object.freeze({
        id: 'keep_it_professional',
        label: 'Keep the relationship strictly professional.',
        memoryId: 'crew.choice.professional-distance',
        delta: -0.05,
        mood: 'guarded',
        response: 'Understood. Clear duties, clean boundaries. I can work with that.'
    })
});

export class CrewRuntime {
    constructor({ rpg, voiceProvider = null, now = () => new Date().toISOString() } = {}) {
        if (!rpg) throw new Error('CrewRuntime requires an RPG runtime.');
        this.rpg = rpg;
        this.voiceProvider = voiceProvider;
        this.now = now;
        this.open = false;
        this.status = 'offline';
        this.presentationText = null;
        this.error = null;
        this.requestSequence = 0;
        this.activeRequestId = null;
    }

    isPresent(id = CREW_NPC_ID) {
        return isNpcPhysicallyPresent(this.rpg.getState(), id);
    }

    openInteraction() {
        if (!this.isPresent()) throw new Error(`Crew NPC is not physically present: ${CREW_NPC_ID}`);
        this.open = true;
        this.status = 'offline';
        this.presentationText = null;
        this.error = null;
        this._recordAuthoritativeMemories();
        return this.getState();
    }

    closeInteraction() {
        this._invalidateRequest();
        this.open = false;
        this.status = 'interrupted';
        return this.getState();
    }

    interrupt() {
        if (!this.open) return this.getState();
        this._invalidateRequest();
        this.status = 'interrupted';
        return this.getState();
    }

    beginListening() {
        if (!this.open) throw new Error('Crew interaction is not open.');
        this._invalidateRequest();
        this.status = 'listening';
        this.error = null;
        return this.getState();
    }

    async requestPresentation() {
        if (!this.open) throw new Error('Crew interaction is not open.');
        if (!this.voiceProvider?.request) {
            this.status = 'failed';
            this.error = 'Voice service unavailable; authored text remains active.';
            return this.getState();
        }
        const requestId = `crew-request-${++this.requestSequence}`;
        this.activeRequestId = requestId;
        this.status = 'connecting';
        this.error = null;
        const context = createReadOnlyCrewContext(this.rpg.getState(), requestId);
        try {
            this.status = 'responding';
            const response = await this.voiceProvider.request(context);
            if (!this.open || this.activeRequestId !== requestId) return this.getState();
            if (!response || response.requestId !== requestId || typeof response.text !== 'string') {
                throw new Error('Malformed crew presentation response.');
            }
            if (response.mutations !== undefined || response.rewards !== undefined || response.state !== undefined) {
                throw new Error('Crew presentation response attempted an unauthorized mutation.');
            }
            const text = response.text.trim().slice(0, 800);
            if (!text) throw new Error('Crew presentation response contained no text.');
            this.presentationText = text;
            this.status = 'offline';
        } catch (error) {
            if (this.activeRequestId !== requestId) return this.getState();
            this.status = 'failed';
            this.error = error instanceof Error ? error.message : String(error);
        } finally {
            if (this.activeRequestId === requestId) this.activeRequestId = null;
        }
        return this.getState();
    }

    chooseRelationship(choiceId) {
        const choice = RELATIONSHIP_CHOICES[choiceId];
        if (!choice) throw new Error(`Unknown crew relationship choice ID: ${choiceId}`);
        if (!this.open) throw new Error('Crew interaction is not open.');
        const state = this.rpg.getState();
        const npc = state.npcs.byId[CREW_NPC_ID];
        if (hasRelationshipChoice(npc)) {
            throw new Error('Crew relationship choice has already been made.');
        }
        npc.relationship = clampRelationship(npc.relationship + choice.delta);
        npc.mood = choice.mood;
        addMemory(npc, choice.memoryId);
        appendEvent(state, 'npc.relationship-changed', {
            npcId: CREW_NPC_ID,
            choiceId,
            delta: choice.delta,
            relationship: npc.relationship,
            memoryId: choice.memoryId
        }, this.now());
        this.rpg.replaceState(sanitizeRpgState(state), 'crew-relationship-choice');
        this.presentationText = choice.response;
        return this.getState();
    }

    getState() {
        const rpg = this.rpg.getState();
        const npcState = rpg.npcs.byId[CREW_NPC_ID];
        const definition = NPC_DEFINITIONS[CREW_NPC_ID];
        return cloneRpgValue({
            open: this.open,
            status: this.status,
            error: this.error,
            activeRequestId: this.activeRequestId,
            present: this.isPresent(),
            npc: { ...definition, state: npcState },
            authoredBeat: selectAuthoredBeat(rpg),
            presentationText: this.presentationText,
            choices: hasRelationshipChoice(npcState) ? [] : Object.values(RELATIONSHIP_CHOICES)
        });
    }

    _recordAuthoritativeMemories() {
        const state = this.rpg.getState();
        const npc = state.npcs.byId[CREW_NPC_ID];
        const memories = deriveMissionMemories(state);
        const added = memories.filter((memoryId) => addMemory(npc, memoryId));
        if (!added.length) return;
        for (const memoryId of added) {
            appendEvent(state, 'npc.memory-added', { npcId: CREW_NPC_ID, memoryId }, this.now());
        }
        this.rpg.replaceState(sanitizeRpgState(state), 'crew-context-memory');
    }

    _invalidateRequest() {
        this.requestSequence += 1;
        this.activeRequestId = null;
    }
}

export function createReadOnlyCrewContext(rpgState, requestId = null) {
    const clean = sanitizeRpgState(rpgState);
    const npc = clean.npcs.byId[CREW_NPC_ID];
    return deepFreeze({
        requestId,
        npc: {
            id: npc.id,
            relationship: npc.relationship,
            mood: npc.mood,
            memoryReferences: [...npc.memoryReferences]
        },
        missions: {
            [CLEAN_COPY_ID]: missionContext(clean, CLEAN_COPY_ID),
            [DELIVERY_ID]: missionContext(clean, DELIVERY_ID)
        },
        factions: Object.fromEntries(
            Object.entries(clean.factions.byId).map(([id, faction]) => [id, faction.reputation])
        ),
        ship: { condition: 'not-yet-modeled' },
        authority: 'presentation-only'
    });
}

export function selectAuthoredBeat(state) {
    const cleanCopy = state.missions.byId[CLEAN_COPY_ID];
    const delivery = state.missions.byId[DELIVERY_ID];
    let text;
    let id;
    if (cleanCopy?.outcomeId === 'commonwealth') {
        id = 'clean-copy-commonwealth';
        text = 'You gave the route copy to the Commonwealth. Safer lanes, perhaps—but every safe lane belongs to someone.';
    } else if (cleanCopy?.outcomeId === 'index') {
        id = 'clean-copy-index';
        text = 'You trusted the Index with the raw copy. Knowledge keeps its own kind of receipts. We should remember that.';
    } else {
        id = 'clean-copy-unresolved';
        text = 'Port Meridian is still waiting on your choice about that route packet. No pressure from me—only consequences.';
    }
    if (delivery?.status === MISSION_STATUSES.RESOLVED && delivery.outcomeId === 'delivered') {
        id += '-delivery-delivered';
        text += ' And the archive canisters reached K-7 intact. The hold feels lighter; our name carries more weight.';
    } else if (delivery?.status === MISSION_STATUSES.FAILED) {
        id += '-delivery-failed';
        text += ' The K-7 delivery did not make it. We can recover from a lost job if we learn the right lesson.';
    } else if (delivery?.status === MISSION_STATUSES.ACCEPTED) {
        id += '-delivery-active';
        text += ' The Index freight is still our responsibility. I have the manifest if you need it.';
    }
    return { id, text };
}

function deriveMissionMemories(state) {
    const memories = [];
    const clean = state.missions.byId[CLEAN_COPY_ID];
    if (clean?.status === MISSION_STATUSES.RESOLVED && clean.outcomeId) {
        memories.push(`mission.${CLEAN_COPY_ID}.${clean.outcomeId}`);
    }
    const delivery = state.missions.byId[DELIVERY_ID];
    if ((delivery?.status === MISSION_STATUSES.RESOLVED || delivery?.status === MISSION_STATUSES.FAILED) && delivery.outcomeId) {
        memories.push(`mission.${DELIVERY_ID}.${delivery.outcomeId}`);
    }
    return memories;
}

function missionContext(state, id) {
    const mission = state.missions.byId[id];
    return {
        status: mission?.status ?? 'missing',
        outcomeId: mission?.outcomeId ?? null
    };
}

function hasRelationshipChoice(npc) {
    return npc.memoryReferences.some((id) => id.startsWith('crew.choice.'));
}

function addMemory(npc, memoryId) {
    if (npc.memoryReferences.includes(memoryId)) return false;
    npc.memoryReferences.push(memoryId);
    npc.memoryReferences.sort();
    return true;
}

function appendEvent(state, type, payload, now) {
    const next = state.eventLog.reduce((maximum, event) => {
        const value = Number(String(event.id).split('-').at(-1));
        return Number.isFinite(value) ? Math.max(maximum, value) : maximum;
    }, 0) + 1;
    state.eventLog.push({
        id: `event-${String(next).padStart(6, '0')}`,
        type,
        payload: cloneRpgValue(payload),
        createdAt: now
    });
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}
