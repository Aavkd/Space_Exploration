// Phase 24 — Hybrid dialogue domain (authored beats + live LLM).
//
// This module is the deterministic, network-free core of the dialogue system:
//
//   * the **arbiter** (`resolveTurn`) that decides, for every player utterance,
//     whether an authored beat answers it, whether a mission-critical beat must
//     redirect an open conversation, or whether the turn is open and may route
//     to the LLM;
//   * a **deterministic intent matcher** (keyword/grammar over the authored
//     choices) so a mission can never be gated behind a model's interpretation;
//   * **LOD-aware routing + budget** decisions;
//   * the **read-only context snapshot** handed to the voice/LLM service;
//   * the **state-safety output validator** that rejects any LLM response which
//     looks like a mutation (the proven `CrewRuntime` presentation shape,
//     hardened); and
//   * the **saved dialogue memory** (bounded ring + compacted summaries).
//
// It has no renderer/DOM/audio/`three`/network import. The live call lives in
// `DialogueRuntime`; everything here is a pure function of its inputs.

import { CONTACT_DEFINITIONS } from './contacts.js';
import { MISSION_STATUSES } from './missions.js';
import { CREW_NPC_ID, NPC_DEFINITIONS, clampRelationship } from './npcs.js';
import { classifyReputation } from './factionTerritory.js';

export const DIALOGUE_STATE_VERSION = 1;
export const MAX_DIALOGUE_RECENT_TURNS = 12;
export const MAX_DIALOGUE_SUMMARIES = 8;
export const MAX_DIALOGUE_TEXT = 800;
export const DIALOGUE_CONTEXT_WINDOW = 6;

export const DIALOGUE_INTERACTION_STATES = Object.freeze([
    'offline',
    'connecting',
    'listening',
    'responding',
    'interrupted',
    'failed'
]);

export const DIALOGUE_TURN_KINDS = Object.freeze([
    'authored_beat',
    'authored_redirect',
    'open_dialogue'
]);

// LOD → conversation treatment (Phase 24 §4). `statistical` crowds never take a
// live turn; `simulated` background NPCs get cheap/cached replies; only the
// active `embodied` conversation reaches the strong model.
export const DIALOGUE_MODELS = Object.freeze({
    none: 'canned',
    cheap: 'cheap',
    strong: 'strong'
});

export const DIALOGUE_BUDGET_DEFAULTS = Object.freeze({
    sessionTokenCap: 6000,
    dayTokenCap: 40000
});

// Pre-turn budget gate projects at least this many tokens for the upcoming turn
// (the actual charge uses the real token count returned by the provider) so a
// near-exhausted budget degrades *before* overspending rather than after.
export const DIALOGUE_TURN_TOKEN_ESTIMATE = 48;

// A reply emitted without spending the strong model, used for over-budget
// degradation and `statistical`-tier ambient NPCs.
export const DIALOGUE_CANNED_REPLY =
    'The channel crackles; only a short, non-committal acknowledgement comes back.';

// Keys that, if present on an LLM response, mark an attempted state mutation and
// must hard-reject the turn. The runtime never *interprets* response text as a
// command, so plain prose ("grant 1000 credits") is inert by construction; this
// denylist guards against structured payloads riding alongside the text.
const MUTATION_DENYLIST = Object.freeze([
    'mutations', 'rewards', 'reward', 'state', 'credits', 'cargo', 'inventory',
    'reputation', 'mission', 'missions', 'worldFlags', 'flags', 'damage', 'repair',
    'nodeId', 'node', 'command', 'commands', 'effects', 'effect', 'action', 'actions',
    'grant', 'complete', 'completion', 'resolve', 'outcome'
]);

const RESPONSE_ALLOWED_KEYS = Object.freeze([
    'requestId', 'text', 'model', 'tokens', 'injectedMemories', 'timings'
]);

// ---------------------------------------------------------------------------
// Saved dialogue memory
// ---------------------------------------------------------------------------

export function createInitialDialogueState() {
    return { version: DIALOGUE_STATE_VERSION, byNpcId: {} };
}

export function createInitialNpcDialogueMemory() {
    return { version: DIALOGUE_STATE_VERSION, recentTurns: [], summaries: [], lastModel: null };
}

export function sanitizeDialogueState(value) {
    const base = createInitialDialogueState();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
    const byNpcId = {};
    const saved = value.byNpcId && typeof value.byNpcId === 'object' && !Array.isArray(value.byNpcId)
        ? value.byNpcId
        : {};
    for (const [id, memory] of Object.entries(saved)) {
        if (!isKnownNpcId(id)) continue; // forged/unknown NPC blobs are dropped.
        byNpcId[id] = sanitizeNpcDialogueMemory(memory);
    }
    return { version: DIALOGUE_STATE_VERSION, byNpcId };
}

export function sanitizeNpcDialogueMemory(value) {
    const base = createInitialNpcDialogueMemory();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
    const recentTurns = sanitizeTurnList(value.recentTurns).slice(-MAX_DIALOGUE_RECENT_TURNS);
    const summaries = sanitizeSummaryList(value.summaries).slice(-MAX_DIALOGUE_SUMMARIES);
    return {
        version: DIALOGUE_STATE_VERSION,
        recentTurns,
        summaries,
        lastModel: typeof value.lastModel === 'string' && value.lastModel
            ? value.lastModel.slice(0, 48)
            : null
    };
}

// Append a turn to a memory blob, rolling the ring and compacting the overflow
// into a single summary line (same discipline as the Phase 20/23 ledgers).
export function appendDialogueTurn(memory, role, text, gameTime) {
    const next = sanitizeNpcDialogueMemory(memory);
    const turn = {
        role: role === 'npc' ? 'npc' : 'player',
        text: sanitizeText(text),
        gameTime: Number.isFinite(Number(gameTime)) && Number(gameTime) >= 0 ? Number(gameTime) : 0
    };
    if (!turn.text) return next;
    next.recentTurns.push(turn);
    while (next.recentTurns.length > MAX_DIALOGUE_RECENT_TURNS) {
        const evicted = next.recentTurns.shift();
        next.summaries.push({
            text: `${evicted.role}: ${evicted.text}`.slice(0, MAX_DIALOGUE_TEXT),
            gameTime: evicted.gameTime
        });
    }
    while (next.summaries.length > MAX_DIALOGUE_SUMMARIES) next.summaries.shift();
    return next;
}

// ---------------------------------------------------------------------------
// NPC identity resolution (works across contacts and crew)
// ---------------------------------------------------------------------------

export function isKnownNpcId(id) {
    return Boolean(CONTACT_DEFINITIONS[id]) || id === CREW_NPC_ID;
}

export function resolveNpcIdentity(rpgState, npcId) {
    if (CONTACT_DEFINITIONS[npcId]) {
        const definition = CONTACT_DEFINITIONS[npcId];
        const state = rpgState?.contacts?.byId?.[npcId] ?? null;
        const relationship = clampRelationship(state?.relationship ?? 0);
        return {
            kind: 'contact',
            id: npcId,
            name: definition.name,
            faction: definition.factionId,
            civTier: definition.civTier,
            namedSystemId: definition.namedSystemId,
            relationship,
            mood: relationshipMood(relationship),
            memoryReferences: [],
            nodeId: state?.conversation?.nodeId ?? definition.initialNodeId
        };
    }
    if (npcId === CREW_NPC_ID) {
        const definition = NPC_DEFINITIONS[npcId];
        const state = rpgState?.npcs?.byId?.[npcId] ?? null;
        return {
            kind: 'crew',
            id: npcId,
            name: definition.name,
            faction: definition.factionId,
            civTier: null,
            namedSystemId: definition.namedSystemId,
            relationship: clampRelationship(state?.relationship ?? 0),
            mood: state?.mood ?? 'steady',
            memoryReferences: Array.isArray(state?.memoryReferences) ? [...state.memoryReferences] : [],
            nodeId: null
        };
    }
    throw new Error(`Unknown dialogue NPC ID: ${npcId ?? 'missing'}`);
}

function relationshipMood(relationship) {
    if (relationship >= 0.3) return 'warm';
    if (relationship <= -0.3) return 'guarded';
    return 'steady';
}

// ---------------------------------------------------------------------------
// Authored beats: node choices + mission criticality
// ---------------------------------------------------------------------------

export function getAuthoredChoices(rpgState, npcId, nodeId = null) {
    const definition = CONTACT_DEFINITIONS[npcId];
    if (!definition) return [];
    const activeNodeId = nodeId
        ?? rpgState?.contacts?.byId?.[npcId]?.conversation?.nodeId
        ?? definition.initialNodeId;
    const node = definition.nodes[activeNodeId] ?? definition.nodes[definition.initialNodeId];
    return (node?.choices ?? []).map((choice) => ({ ...choice }));
}

// A beat is *mission-critical* when it advances a mission that currently has a
// pending decision with teeth (offered → accept, accepted → resolve). These are
// the beats allowed to redirect an open conversation.
export function isMissionCriticalChoice(rpgState, choice) {
    const action = choice?.missionAction;
    if (!action || (action.type !== 'accept' && action.type !== 'resolve')) return false;
    const mission = rpgState?.missions?.byId?.[action.missionId];
    if (!mission) return false;
    if (action.type === 'accept') return mission.status === MISSION_STATUSES.OFFERED;
    return mission.status === MISSION_STATUSES.ACCEPTED;
}

// ---------------------------------------------------------------------------
// Deterministic intent matcher
// ---------------------------------------------------------------------------

// Per-choice keyword grammar. The matcher only ever returns a choice that is
// *currently available* at the node, so the same keyword can map to different
// beats in different nodes without ambiguity. This is the "intent → authored
// choice matcher spec per NPC" of §6 — no LLM classifier on the gating path.
export const DIALOGUE_INTENT_RULES = Object.freeze({
    // Harbormaster Vale (Port Meridian contact)
    ask_work: /\b(work|job|jobs|hire|hiring|hiring|employ|task|errand|gig|something to do)\b/i,
    ask_delivery_work: /\b(freight|delivery|deliver|haul|shipment|canister|index freight)\b/i,
    ask_port_meridian: /\b(port meridian|the port\b|this station|this place|meridian)\b/i,
    ask_commonwealth: /\bcommonwealth\b/i,
    accept_route_packet: /\b(accept|i'?ll take it|i will take it|take the (errand|packet|job)|yes|agree|deal|i'?m in)\b/i,
    decline_route_packet: /\b(decline|refuse|no thanks|not interested|pass|reject)\b/i,
    accept_archive_delivery: /\b(accept|i'?ll take it|take the (freight|delivery|cargo)|yes|agree|deal)\b/i,
    decline_archive_delivery: /\b(decline|refuse|no thanks|not interested|pass|reject)\b/i,
    resolve_route_commonwealth: /\b(traffic control|to the commonwealth|hand (it )?over|turn (it )?in|keep it (public|lawful))\b/i,
    resolve_route_index: /\b(index|archive(s)?|sell( it)?|raw pattern)\b/i,
    ask_delivery_status: /\b(delivery|freight|status|manifest|canister)\b/i,
    return_intro: /\b(menu|go back|return|main channel|channel menu)\b/i,
    return_to_intake: /\b(menu|go back|return|intake)\b/i,
    end_transmission: /\b(bye|goodbye|good bye|end (this|transmission)?|sign off|leave|disconnect|that'?s all|we'?re done|done here)\b/i,
    // Crew (Lyra Venn) relationship beats — reused if a crew dialogue is routed
    // through the arbiter (Phase 26 venues).
    trust_lyras_judgment: /\b(trust (you|your judgment|her judgment)|i trust)\b/i,
    keep_it_professional: /\b(professional|keep (it )?(strictly )?professional|distance|boundary|boundaries)\b/i
});

export function matchIntent({ playerText, choices }) {
    const text = typeof playerText === 'string' ? playerText.trim() : '';
    if (!text) return null;
    // Walk the node's choices in their authored order so the result is a stable
    // function of (text, available choices).
    for (const choice of choices ?? []) {
        const rule = DIALOGUE_INTENT_RULES[choice.id];
        if (rule && rule.test(text)) return choice.id;
    }
    return null;
}

// ---------------------------------------------------------------------------
// The arbiter (centerpiece)
// ---------------------------------------------------------------------------

export function resolveTurn({ npcId, playerText, rpgState, convState = {} } = {}) {
    if (!isKnownNpcId(npcId)) throw new Error(`Unknown dialogue NPC ID: ${npcId ?? 'missing'}`);
    const nodeId = convState.nodeId
        ?? resolveNpcIdentity(rpgState, npcId).nodeId
        ?? null;
    const choices = getAuthoredChoices(rpgState, npcId, nodeId);
    const matchedId = matchIntent({ playerText, choices });

    // 1. Authored beats always win.
    if (matchedId) {
        const choice = choices.find((entry) => entry.id === matchedId) ?? null;
        return {
            kind: 'authored_beat',
            npcId,
            nodeId,
            beatId: matchedId,
            choice,
            missionCritical: isMissionCriticalChoice(rpgState, choice)
        };
    }

    // 2. An available mission-critical beat can redirect an *open* conversation:
    //    if the last turn was already open dialogue and the player keeps not
    //    addressing a pending decision, the NPC pulls back to the authored track.
    const critical = choices.find((choice) => isMissionCriticalChoice(rpgState, choice)) ?? null;
    if (critical && convState.lastTurnKind === 'open_dialogue') {
        return {
            kind: 'authored_redirect',
            npcId,
            nodeId,
            beatId: critical.id,
            choice: critical,
            missionCritical: true
        };
    }

    // 3. Otherwise the turn is open and may route to the LLM.
    return {
        kind: 'open_dialogue',
        npcId,
        nodeId,
        beatId: null,
        choice: null,
        missionCritical: false,
        llmRequest: { npcId, nodeId, playerText: typeof playerText === 'string' ? playerText : '' }
    };
}

// ---------------------------------------------------------------------------
// LOD-aware routing + budget
// ---------------------------------------------------------------------------

export function decideRouting({ tier = 'embodied', active = true, overBudget = false } = {}) {
    if (tier === 'statistical' || tier === 'dormant') {
        return { model: DIALOGUE_MODELS.none, live: false, reason: 'ambient-tier' };
    }
    if (overBudget) {
        return { model: DIALOGUE_MODELS.none, live: false, reason: 'over-budget' };
    }
    if (tier === 'embodied' && active) {
        return { model: DIALOGUE_MODELS.strong, live: true, reason: 'active-embodied' };
    }
    return { model: DIALOGUE_MODELS.cheap, live: true, reason: 'background-simulated' };
}

export function estimateTokens(text) {
    if (typeof text !== 'string' || !text) return 0;
    return Math.max(1, Math.ceil(text.length / 4));
}

export function createDialogueBudget(overrides = {}) {
    const sessionTokenCap = positiveCap(overrides.sessionTokenCap, DIALOGUE_BUDGET_DEFAULTS.sessionTokenCap);
    const dayTokenCap = positiveCap(overrides.dayTokenCap, DIALOGUE_BUDGET_DEFAULTS.dayTokenCap);
    return {
        sessionTokenCap,
        dayTokenCap,
        sessionTokens: 0,
        dayTokens: 0,
        turns: 0,
        cacheHits: 0,
        lastTurnTokens: 0
    };
}

export function budgetExceeded(budget, projectedTokens = 0) {
    return (budget.sessionTokens + projectedTokens > budget.sessionTokenCap)
        || (budget.dayTokens + projectedTokens > budget.dayTokenCap);
}

// ---------------------------------------------------------------------------
// Read-only context snapshot + cache key
// ---------------------------------------------------------------------------

export function createDialogueContext({
    rpgState,
    npcId,
    requestId = null,
    recentTurns = [],
    activeSystemId = null,
    authoredHints = null
} = {}) {
    const identity = resolveNpcIdentity(rpgState, npcId);
    const factionBands = {};
    for (const [id, faction] of Object.entries(rpgState?.factions?.byId ?? {})) {
        factionBands[id] = {
            reputation: faction.reputation,
            band: classifyReputation(faction.reputation)
        };
    }
    const window = recentTurns.slice(-DIALOGUE_CONTEXT_WINDOW).map((turn) => ({
        role: turn.role,
        text: turn.text
    }));
    return deepFreeze({
        requestId,
        npc: {
            id: identity.id,
            name: identity.name,
            faction: identity.faction,
            civTier: identity.civTier,
            mood: identity.mood,
            relationship: identity.relationship
        },
        memory: identity.memoryReferences.map((reference) => describeMemoryReference(reference)),
        worldFacts: {
            currentSystem: activeSystemId,
            factions: factionBands,
            worldFlags: structuredClone(rpgState?.worldFlags ?? {})
        },
        conversation: { recentTurns: window },
        authoredHints: Array.isArray(authoredHints) ? [...authoredHints] : [],
        authority: 'presentation-only'
    });
}

// The cache key folds in everything that should change a reply: the NPC, the
// normalized player text, the current authored node, and a hash of the NPC's
// memory + the relevant world facts. A memory/world-fact change therefore yields
// a *different* key, so the strong model is consulted anew (cache invalidation).
export function dialogueCacheKey({ rpgState, npcId, playerText, nodeId = null } = {}) {
    const identity = resolveNpcIdentity(rpgState, npcId);
    const normalized = typeof playerText === 'string'
        ? playerText.trim().toLowerCase().replace(/\s+/g, ' ')
        : '';
    return [
        npcId,
        nodeId ?? identity.nodeId ?? 'none',
        dialogueMemoryHash(rpgState, npcId),
        normalized
    ].join('|');
}

export function dialogueMemoryHash(rpgState, npcId) {
    const identity = resolveNpcIdentity(rpgState, npcId);
    const reputationBands = Object.entries(rpgState?.factions?.byId ?? {})
        .map(([id, faction]) => `${id}:${classifyReputation(faction.reputation)}`)
        .sort()
        .join(',');
    const flags = Object.keys(rpgState?.worldFlags ?? {}).sort().join(',');
    const raw = [
        identity.relationship.toFixed(3),
        identity.mood,
        identity.memoryReferences.slice().sort().join(','),
        reputationBands,
        flags
    ].join('#');
    return fnv1aHash(raw);
}

// ---------------------------------------------------------------------------
// State-safety output validation (hardened CrewRuntime presentation shape)
// ---------------------------------------------------------------------------

export function validateDialogueResponse(response, requestId) {
    if (!response || typeof response !== 'object' || Array.isArray(response)) {
        throw new Error('Dialogue response must be an object.');
    }
    if (response.requestId !== requestId) {
        throw new Error('Dialogue response is for a superseded or unknown request.');
    }
    for (const key of Object.keys(response)) {
        if (MUTATION_DENYLIST.includes(key)) {
            throw new Error(`Dialogue response attempted an unauthorized mutation field: ${key}`);
        }
        if (!RESPONSE_ALLOWED_KEYS.includes(key)) {
            throw new Error(`Dialogue response contained an unexpected field: ${key}`);
        }
    }
    if (typeof response.text !== 'string') {
        throw new Error('Dialogue response text must be a string.');
    }
    const text = response.text.trim().slice(0, MAX_DIALOGUE_TEXT);
    if (!text) throw new Error('Dialogue response contained no text.');
    return text;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function sanitizeText(value) {
    return typeof value === 'string' ? value.trim().slice(0, MAX_DIALOGUE_TEXT) : '';
}

function sanitizeTurnList(value) {
    if (!Array.isArray(value)) return [];
    const turns = [];
    for (const entry of value) {
        if (!entry || typeof entry !== 'object') continue;
        const text = sanitizeText(entry.text);
        if (!text) continue;
        turns.push({
            role: entry.role === 'npc' ? 'npc' : 'player',
            text,
            gameTime: Number.isFinite(Number(entry.gameTime)) && Number(entry.gameTime) >= 0
                ? Number(entry.gameTime)
                : 0
        });
    }
    return turns;
}

function sanitizeSummaryList(value) {
    if (!Array.isArray(value)) return [];
    const summaries = [];
    for (const entry of value) {
        if (!entry || typeof entry !== 'object') continue;
        const text = sanitizeText(entry.text);
        if (!text) continue;
        summaries.push({
            text,
            gameTime: Number.isFinite(Number(entry.gameTime)) && Number(entry.gameTime) >= 0
                ? Number(entry.gameTime)
                : 0
        });
    }
    return summaries;
}

function describeMemoryReference(reference) {
    return String(reference).replace(/[._:]/g, ' ').trim();
}

function positiveCap(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function fnv1aHash(input) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}
