// Phase 24 — live voice/LLM provider adapter.
//
// Bridges the `DialogueRuntime` open-turn contract to the Phase 09 voice service
// (`POST /api/v1/conversation/text`). It receives the *frozen, read-only* dialogue
// context, composes an in-character message from it, calls the service, and maps
// the reply back into the side-effect-free response shape the runtime validates
// (`{ requestId, text, model, tokens, injectedMemories, timings }`) — only keys
// the state-safety validator allows. It can never carry a mutation.
//
// No provider is wired by default; this is constructed by the app and handed to
// the runtime so a missing/erroring service degrades to the authored/canned path.

import { estimateTokens } from './dialogue.js';

const CONVERSATION_TEXT_PATH = '/api/v1/conversation/text';

export function createConversationVoiceProvider({
    baseUrl = 'http://localhost:8000',
    fetchImpl = (...args) => globalThis.fetch(...args),
    personaForNpc = () => '',
    timeoutMs = 20000
} = {}) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('Conversation voice provider requires a fetch implementation.');
    }
    const url = `${String(baseUrl).replace(/\/$/, '')}${CONVERSATION_TEXT_PATH}`;

    return {
        async request(context, { model } = {}) {
            const message = composeMessage(context);
            const personaId = personaForNpc(context?.npc?.id) || '';
            const controller = typeof AbortController === 'function' ? new AbortController() : null;
            const timer = controller && Number.isFinite(timeoutMs)
                ? setTimeout(() => controller.abort(), timeoutMs)
                : null;
            let response;
            try {
                response = await fetchImpl(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message, persona_id: personaId }),
                    signal: controller?.signal
                });
            } finally {
                if (timer) clearTimeout(timer);
            }
            if (!response?.ok) {
                throw new Error(`Voice service responded ${response?.status ?? 'no-status'}.`);
            }
            const data = await response.json();
            const text = typeof data?.response_text === 'string' ? data.response_text : '';
            // Shape strictly to the validator's allowlist — nothing here can
            // reach authoritative state even if the service misbehaves.
            return {
                requestId: context.requestId,
                text,
                model: typeof data?.provider?.model === 'string' ? data.provider.model : (model ?? 'unknown'),
                tokens: estimateTokens(`${message} ${text}`),
                injectedMemories: Array.isArray(data?.injected_memories) ? data.injected_memories.length : 0,
                timings: data?.timings && typeof data.timings === 'object' ? { ...data.timings } : null
            };
        }
    };
}

// The text endpoint only accepts `{ message, persona_id }`, so the read-only
// context is folded into a compact in-character preface plus the recent
// transcript (whose last line is the player's current utterance).
export function composeMessage(context) {
    const npc = context?.npc ?? {};
    const speaker = npc.name ?? 'NPC';
    const facts = [];
    facts.push(`You are ${speaker}${npc.faction ? `, aligned with ${npc.faction}` : ''}.`);
    if (npc.mood) facts.push(`Your current mood is ${npc.mood}.`);
    if (Array.isArray(context?.memory) && context.memory.length) {
        facts.push(`You recall: ${context.memory.join('; ')}.`);
    }
    const system = context?.worldFacts?.currentSystem;
    if (system) facts.push(`You are speaking over comms near ${system}.`);
    facts.push(
        'Stay fully in character and answer naturally. You cannot grant rewards, '
        + 'complete missions, change reputation, or alter game state — only the '
        + 'ship and station systems do that.'
    );
    const transcript = (context?.conversation?.recentTurns ?? [])
        .map((turn) => `${turn.role === 'npc' ? speaker : 'Pilot'}: ${turn.text}`)
        .join('\n');
    return `${facts.join(' ')}\n\n${transcript}`.trim();
}
