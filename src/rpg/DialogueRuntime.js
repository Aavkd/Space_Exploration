// Phase 24 — DialogueRuntime.
//
// Orchestrates one conversation over the shared NPC contract. It owns the
// ephemeral interaction state machine, drives the deterministic arbiter, applies
// authored beats through the *authoritative* `RpgRuntime` path (so the LLM can
// never advance a mission), and routes open turns to the voice/LLM service with
// LOD-aware model selection, budget enforcement, caching, and the hardened
// state-safety output validator.
//
// Like the other optional RPG runtimes, every failure path here collapses to the
// authored track or a neutral line; a dialogue failure can never stop flight or
// rendering (locked rule 7).

import {
    DIALOGUE_CANNED_REPLY,
    DIALOGUE_TURN_TOKEN_ESTIMATE,
    appendDialogueTurn,
    budgetExceeded,
    createDialogueBudget,
    createDialogueContext,
    createInitialNpcDialogueMemory,
    decideRouting,
    dialogueCacheKey,
    estimateTokens,
    isKnownNpcId,
    resolveNpcIdentity,
    resolveTurn,
    sanitizeNpcDialogueMemory,
    validateDialogueResponse
} from './dialogue.js';
import { CONTACT_DEFINITIONS } from './contacts.js';
import { sanitizeRpgState } from './state.js';

const MAX_CACHE_ENTRIES = 64;

export class DialogueRuntime {
    constructor({
        rpg,
        voiceProvider = null,
        budget = {},
        getTier = () => 'embodied',
        getGameTime = () => 0,
        now = () => new Date().toISOString()
    } = {}) {
        if (!rpg) throw new Error('DialogueRuntime requires an RPG runtime.');
        this.rpg = rpg;
        this.voiceProvider = voiceProvider;
        this.getTier = getTier;
        this.getGameTime = getGameTime;
        this.now = now;
        this.budget = createDialogueBudget(budget);
        this.serviceOnline = true;
        this.cache = new Map();

        this.open = false;
        this.npcId = null;
        this.status = 'offline';
        this.error = null;
        this.lastTurnKind = null;
        this.lastModel = null;
        this.presentationText = null;
        this.requestSequence = 0;
        this.activeRequestId = null;
    }

    openConversation(npcId) {
        if (!isKnownNpcId(npcId)) throw new Error(`Unknown dialogue NPC ID: ${npcId ?? 'missing'}`);
        const definition = CONTACT_DEFINITIONS[npcId];
        if (definition) {
            // Contacts must be addressable in the active system for the
            // authoritative comms path to accept authored beats.
            this.rpg.setActiveNamedSystem(definition.namedSystemId);
            this.rpg.startConversation(npcId);
        }
        this.open = true;
        this.npcId = npcId;
        this.status = 'offline';
        this.error = null;
        this.lastTurnKind = null;
        this.presentationText = null;
        return this.getState();
    }

    closeConversation() {
        this._invalidateRequest();
        if (this.npcId && CONTACT_DEFINITIONS[this.npcId]) this.rpg.exitConversation();
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
        if (!this.open) throw new Error('Dialogue conversation is not open.');
        this._invalidateRequest();
        this.status = 'listening';
        this.error = null;
        return this.getState();
    }

    // Arbiter-only resolution: no network, no mutation. Mirrors the debug
    // `dialogue.resolveTurn` hook and is the pure decision the tests assert.
    resolveTurn(playerText) {
        this._assertOpen();
        return resolveTurn({
            npcId: this.npcId,
            playerText,
            rpgState: this.rpg.getState(),
            convState: { nodeId: this._currentNodeId(), lastTurnKind: this.lastTurnKind }
        });
    }

    // A full turn: arbitrate, then either apply the authored beat (authoritative)
    // or run the open LLM turn. Returns the conversation state.
    async say(playerText) {
        this._assertOpen();
        const decision = this.resolveTurn(playerText);
        this._recordPlayerTurn(playerText);

        if (decision.kind === 'authored_beat' || decision.kind === 'authored_redirect') {
            return this._applyAuthoredBeat(decision);
        }
        return this._runOpenTurn(decision);
    }

    getState() {
        return {
            open: this.open,
            npcId: this.npcId,
            status: this.status,
            error: this.error,
            lastTurnKind: this.lastTurnKind,
            lastModel: this.lastModel,
            presentationText: this.presentationText,
            nodeId: this._currentNodeId(),
            choices: this.npcId && CONTACT_DEFINITIONS[this.npcId]
                ? (this.rpg.getCommsState().visibleChoices ?? [])
                : [],
            routing: this.npcId ? this.getRouting(this.npcId) : null,
            budget: this.getBudget()
        };
    }

    getRouting(npcId = this.npcId) {
        const tier = this.getTier(npcId);
        const projected = Math.max(this.budget.lastTurnTokens, DIALOGUE_TURN_TOKEN_ESTIMATE);
        const overBudget = budgetExceeded(this.budget, projected) || !this.serviceOnline;
        return decideRouting({ tier, active: npcId === this.npcId && this.open, overBudget });
    }

    getBudget() {
        return { ...this.budget };
    }

    getMemory(npcId = this.npcId) {
        const dialogue = this.rpg.getState().dialogue;
        return sanitizeNpcDialogueMemory(dialogue?.byNpcId?.[npcId] ?? createInitialNpcDialogueMemory());
    }

    clearMemory(npcId = this.npcId) {
        const state = this.rpg.getState();
        if (state.dialogue?.byNpcId?.[npcId]) {
            delete state.dialogue.byNpcId[npcId];
            this.rpg.replaceState(sanitizeRpgState(state), 'dialogue-clear-memory');
        }
        return this.getMemory(npcId);
    }

    setServiceOnline(online) {
        this.serviceOnline = Boolean(online);
        return this.getState();
    }

    // Safety-path test hook: feed a raw provider response straight through the
    // validator and prove authoritative state is untouched no matter what.
    injectRawResponse(npcId, rawResponse) {
        const before = this.rpg.getState();
        let text = null;
        let rejected = null;
        try {
            text = validateDialogueResponse(rawResponse, rawResponse?.requestId);
        } catch (error) {
            rejected = error instanceof Error ? error.message : String(error);
        }
        const after = this.rpg.getState();
        return {
            npcId,
            text,
            rejected,
            stateUnchanged: JSON.stringify(before) === JSON.stringify(after)
        };
    }

    _applyAuthoredBeat(decision) {
        let text = null;
        if (CONTACT_DEFINITIONS[this.npcId]) {
            // The authoritative comms path applies the mission action and node
            // transition deterministically. The LLM is never on this path.
            const comms = this.rpg.chooseDialogue(decision.beatId);
            text = comms.activeContact?.node?.text ?? null;
            if (!text && comms.activeContactId === null) {
                text = 'Channel closed.';
            }
        }
        this.lastTurnKind = decision.kind;
        this.lastModel = null;
        this.status = 'offline';
        this.error = null;
        this.presentationText = text;
        if (text) this._recordNpcTurn(text, null);
        return this.getState();
    }

    async _runOpenTurn(decision) {
        const npcId = this.npcId;
        const routing = this.getRouting(npcId);
        this.lastTurnKind = 'open_dialogue';

        // Ambient / over-budget / offline → canned reply, no network. The
        // interaction stays usable; we never hard-fail an open turn.
        if (!routing.live || !this.serviceOnline || !this.voiceProvider?.request) {
            return this._emitCanned(npcId, decision, routing);
        }

        const cacheKey = dialogueCacheKey({
            rpgState: this.rpg.getState(),
            npcId,
            playerText: decision.llmRequest.playerText,
            nodeId: decision.nodeId
        });
        if (this.cache.has(cacheKey)) {
            this.budget.cacheHits += 1;
            const cachedText = this.cache.get(cacheKey);
            this.lastModel = routing.model;
            this.status = 'offline';
            this.error = null;
            this.presentationText = cachedText;
            this._recordNpcTurn(cachedText, routing.model);
            return this.getState();
        }

        const requestId = `dialogue-request-${++this.requestSequence}`;
        this.activeRequestId = requestId;
        this.status = 'connecting';
        this.error = null;
        const context = createDialogueContext({
            rpgState: this.rpg.getState(),
            npcId,
            requestId,
            recentTurns: this.getMemory(npcId).recentTurns,
            activeSystemId: this.rpg.getActiveNamedSystem()?.id ?? null,
            authoredHints: routing.live ? [routing.reason] : []
        });

        try {
            this.status = 'responding';
            const response = await this.voiceProvider.request(context, { model: routing.model });
            // A superseded/interrupted turn drops its late response (Phase 15 rule).
            if (!this.open || this.activeRequestId !== requestId) return this.getState();
            const text = validateDialogueResponse(response, requestId);
            const tokens = Number.isFinite(Number(response.tokens))
                ? Math.max(0, Math.floor(Number(response.tokens)))
                : estimateTokens(context.conversation.recentTurns.map((t) => t.text).join(' ') + text);
            this._chargeBudget(tokens);
            this._cachePut(cacheKey, text);
            this.lastModel = routing.model;
            this.status = 'offline';
            this.presentationText = text;
            this._recordNpcTurn(text, routing.model);
        } catch (error) {
            if (this.activeRequestId !== requestId) return this.getState();
            // Malformed/mutation-bearing/empty response → fail safely, keep the
            // authored track usable. No authoritative state was touched.
            this.status = 'failed';
            this.error = error instanceof Error ? error.message : String(error);
        } finally {
            if (this.activeRequestId === requestId) this.activeRequestId = null;
        }
        return this.getState();
    }

    _emitCanned(npcId, decision, routing) {
        this.lastModel = routing.model;
        this.status = 'offline';
        this.error = null;
        this.presentationText = DIALOGUE_CANNED_REPLY;
        this._recordNpcTurn(DIALOGUE_CANNED_REPLY, routing.model);
        return this.getState();
    }

    _chargeBudget(tokens) {
        this.budget.sessionTokens += tokens;
        this.budget.dayTokens += tokens;
        this.budget.turns += 1;
        this.budget.lastTurnTokens = tokens;
    }

    _cachePut(key, text) {
        this.cache.set(key, text);
        while (this.cache.size > MAX_CACHE_ENTRIES) {
            const oldest = this.cache.keys().next().value;
            this.cache.delete(oldest);
        }
    }

    _recordPlayerTurn(text) {
        this._recordTurn('player', text, null);
    }

    _recordNpcTurn(text, model) {
        this._recordTurn('npc', text, model);
    }

    // Dialogue memory is flavor/context only — never read by missions, economy,
    // reputation, or combat. It lives in the dedicated `rpg.dialogue` domain.
    _recordTurn(role, text, model) {
        if (!text) return;
        const state = this.rpg.getState();
        state.dialogue ??= { version: 1, byNpcId: {} };
        state.dialogue.byNpcId ??= {};
        const memory = sanitizeNpcDialogueMemory(
            state.dialogue.byNpcId[this.npcId] ?? createInitialNpcDialogueMemory()
        );
        const next = appendDialogueTurn(memory, role, text, this.getGameTime());
        if (model) next.lastModel = String(model).slice(0, 48);
        state.dialogue.byNpcId[this.npcId] = next;
        this.rpg.replaceState(sanitizeRpgState(state), 'dialogue-memory');
    }

    _currentNodeId() {
        if (!this.npcId) return null;
        return resolveNpcIdentity(this.rpg.getState(), this.npcId).nodeId;
    }

    _assertOpen() {
        if (!this.open) throw new Error('Dialogue conversation is not open.');
    }

    _invalidateRequest() {
        this.requestSequence += 1;
        this.activeRequestId = null;
    }
}

export function createDialogueRuntime(options = {}) {
    return new DialogueRuntime(options);
}
