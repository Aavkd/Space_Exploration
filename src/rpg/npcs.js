import { CONTACT_DEFINITIONS } from './contacts.js';

export const CREW_CAPACITY = 4;
export const CREW_NPC_ID = 'crew_quartermaster_lyra';
export const NPC_KINDS = Object.freeze(['contact', 'crew', 'encounter']);
export const NPC_PRESENCE = Object.freeze(['aboard', 'away']);
export const NPC_MOODS = Object.freeze(['guarded', 'steady', 'warm', 'concerned']);
export const CREW_LOCATION_ID = 'crewMessAnchor';

export const NPC_DEFINITIONS = Object.freeze({
    ...Object.fromEntries(Object.values(CONTACT_DEFINITIONS).map((contact) => [
        contact.id,
        Object.freeze({
            id: contact.id,
            kind: 'contact',
            name: contact.name,
            title: contact.title,
            factionId: contact.factionId,
            namedSystemId: contact.namedSystemId,
            persistent: true
        })
    ])),
    [CREW_NPC_ID]: Object.freeze({
        id: CREW_NPC_ID,
        kind: 'crew',
        name: 'Lyra Venn',
        title: 'Ship Quartermaster',
        factionId: null,
        namedSystemId: null,
        persistent: true,
        placeholderAvatar: true,
        shipAnchorId: CREW_LOCATION_ID
    })
});

export function createInitialNpcState() {
    return {
        crewCapacity: CREW_CAPACITY,
        crewRoster: [CREW_NPC_ID],
        byId: {
            [CREW_NPC_ID]: {
                id: CREW_NPC_ID,
                presence: 'aboard',
                locationId: CREW_LOCATION_ID,
                relationship: 0,
                mood: 'steady',
                memoryReferences: [],
                alive: true,
                recruited: true
            }
        }
    };
}

export function sanitizeNpcState(value) {
    const base = createInitialNpcState();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
    if (Number(value.crewCapacity) !== CREW_CAPACITY) {
        throw new Error(`NPC crew capacity must be ${CREW_CAPACITY}.`);
    }
    if (!Array.isArray(value.crewRoster)) throw new Error('NPC crew roster must be an array.');
    const roster = [...new Set(value.crewRoster)];
    if (roster.length > CREW_CAPACITY) throw new Error(`NPC crew roster exceeds capacity ${CREW_CAPACITY}.`);
    for (const id of roster) {
        if (NPC_DEFINITIONS[id]?.kind !== 'crew') throw new Error(`Unknown crew NPC ID: ${id}`);
    }

    const saved = value.byId?.[CREW_NPC_ID];
    const initial = base.byId[CREW_NPC_ID];
    const memoryReferences = Array.isArray(saved?.memoryReferences)
        ? [...new Set(saved.memoryReferences.map((entry) => String(entry)).filter(isStableReference))].sort()
        : [];
    return {
        crewCapacity: CREW_CAPACITY,
        crewRoster: roster,
        byId: {
            [CREW_NPC_ID]: {
                id: CREW_NPC_ID,
                presence: NPC_PRESENCE.includes(saved?.presence) ? saved.presence : initial.presence,
                locationId: saved?.locationId === CREW_LOCATION_ID ? saved.locationId : initial.locationId,
                relationship: clampRelationship(saved?.relationship),
                mood: NPC_MOODS.includes(saved?.mood) ? saved.mood : initial.mood,
                memoryReferences,
                alive: typeof saved?.alive === 'boolean' ? saved.alive : initial.alive,
                recruited: typeof saved?.recruited === 'boolean' ? saved.recruited : initial.recruited
            }
        }
    };
}

export function isNpcPhysicallyPresent(state, id = CREW_NPC_ID) {
    const npc = state?.npcs?.byId?.[id];
    return Boolean(npc && npc.alive && npc.recruited && npc.presence === 'aboard');
}

export function clampRelationship(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(-1, Math.min(1, number));
}

function isStableReference(value) {
    return /^[a-z0-9][a-z0-9._:-]{0,95}$/.test(value);
}
