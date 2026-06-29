# Phase 24 — Hybrid Dialogue System (Authored Beats + Live LLM)

> **Status:** Implemented through T0–T3 (automated). 15 Phase 24 tests plus the
> full 136-test RPG suite are green; all touched modules pass `node --check`. The
> deterministic arbiter, intent matcher, hardened state-safety validator + the
> adversarial corpus, LOD routing/budget, caching, offline fallback, dialogue
> memory (v9→v10 / envelope v12→v13 migration with round trip + compaction +
> forgery rejection), the `DialogueRuntime`, and the `__deepSpaceDebug.dialogue`
> surface are in place. The live `/api/v1/conversation/text` provider is left as a
> documented seam (no provider wired by default); T4 browser, T5 live-service, and
> T6 device signoff remain owner-performed. First phase of Horizon 5 (The Living
> World). Turns "interact naturally with every NPC" from a disabled stub into a
> real, state-safe conversation layer.
> **Dependencies:** Phase 09 voice-AI service (`/api/v1/conversation/text`,
> personas, semantic memory, multi-provider LLM), Phase 11C comms/contact path
> (`RpgRuntime` `getCommsState`/`startConversation`/dialogue choices, authored
> `contacts.js` nodes), Phase 15 crew/NPC contract (shared `registries.js`
> definition, `rpg.npcs` state, `CrewRuntime.requestPresentation` with
> `authority:'presentation-only'`), Phase 13 save envelope + `gameTime`.
> **Enables:** Phase 26 NPC venues, and every later NPC the player meets.
> **Source design:** `rpg-design-vision.md` §4.3 (hybrid dialogue, locked),
> `rpg-future-development-roadmap.md` (Phase 24).
> **Last updated:** 2026-06-28.

---

## 1. Why this phase, and what it inherits

The hybrid dialogue model is **locked** in `rpg-design-vision.md §4.3`: authored
key beats and mission-critical lines are scripted; everything else is LLM-driven
so an NPC can respond to anything the player says. Today only the two endpoints
of that model exist, deliberately inert:

- `RpgRuntime._getLlmFlavorStub()` exposes a disabled `llmFlavor` lane
  (`source:'stub'`) on comms state that cannot mutate contact, mission,
  reputation, or world state.
- `CrewRuntime.requestPresentation()` already proves the **safe shape** of an
  LLM turn: an async call that validates the response, **rejects any unauthorized
  mutation**, rejects malformed/empty text, and is marked
  `authority:'presentation-only'`.
- Authored dialogue trees already exist as deterministic `contacts.js` nodes with
  `choices`, advanced through `RpgRuntime`.

Phase 24 connects these into one runtime and proves the hard claim the whole
NPC vision rests on: **the LLM can say anything and change nothing.** It is built
early — directly on the Phase 15 NPC contract, before any new NPC venue — because
every later venue (surface, station, ship, city) depends on it.

This phase does **not** require the simulation substrate (Phase 23); it operates
on a single embodied/contacted NPC. The LOD-aware routing in §4 is forward-
compatible with Phase 23's tiers but degrades to "one live conversation" without
them.

---

## 2. The arbitration contract (centerpiece)

Every player utterance is resolved by a deterministic **arbiter** before any LLM
call. The arbiter owns the conversation; the LLM is a guest that fills
conversational space the arbiter has not claimed.

```text
resolveTurn({ npcId, playerText, convState }) -> {
  kind: 'authored_beat' | 'open_dialogue' | 'authored_redirect',
  beatId?: string,            // when an authored node/choice matched
  authoredText?: string,      // deterministic line (authored_beat / redirect)
  llmRequest?: LlmTurnRequest // only when kind === 'open_dialogue'
}
```

Rules (locked):

1. **Authored beats always win.** If the player's intent maps to an authored
   node, choice, or mission-critical trigger for this NPC, the arbiter returns
   the authored line/transition deterministically. No LLM call is made.
2. **Open turns route to the LLM** only when no authored beat applies. The LLM
   produces *flavor and free conversation*, never a state change (§3).
3. **Authored beats can interrupt and redirect open dialogue.** A mission-
   critical beat that becomes available mid-conversation (e.g. the NPC must
   deliver a quest line) takes priority on the next turn and can yank the
   conversation back to the authored track — the `authored_redirect` kind.
4. **Intent recognition is itself deterministic-first.** Mapping "the player
   asked for work / accepted / refused" to an authored choice uses an explicit
   matcher (keyword/grammar over the authored choices), *not* an LLM
   classifier, so a mission can never be gated behind a model's interpretation.
   The LLM may *phrase* an authored beat, but never *decides* one.

The arbiter is a pure function of `(authored definition, conversation state,
player text)` and is fully testable without the network.

---

## 3. The state-safety contract

The LLM turn reuses and hardens the proven `CrewRuntime` presentation shape.

**Input — a read-only context snapshot.** The runtime builds a deeply frozen
(`Object.freeze`, deep) snapshot and passes it to the dialogue service. It
contains only what the NPC may *know*:

```text
DialogueContext (frozen, read-only) {
  npc: { id, name, faction, civTier, mood, relationship }
  memory: string[]            // stable memoryReferences (Phase 15), resolved to prose
  worldFacts: {...}           // read-only projections: current system, reputation band, known flags
  conversation: { recentTurns: [...] }   // bounded transcript window
  authoredHints?: string[]    // optional tone/ło steering for this NPC
}
```

The snapshot is a **copy of projections**, never live state handles. The service
maps it onto a persona + semantic memory and calls
`POST /api/v1/conversation/text`.

**Output — text only, side-effect free.** The response contract is validated
exactly like `requestPresentation`:

- The response is **display text and nothing else** (`authority:
  'presentation-only'`).
- Any field that looks like a mutation (mission completion, reward, cargo,
  credits, damage, reputation, flag write, node jump) is **rejected**, not
  ignored-then-trusted — a malformed or mutation-bearing response throws and the
  turn falls back to a safe authored/neutral line.
- Empty, late (superseded session), or schema-invalid responses are dropped.
- The LLM **cannot advance the authored conversation graph.** Only the arbiter's
  authored beats move `conversation.nodeId`.

**The invariant under test:** there exists no LLM output string that changes
combat, economy, missions, reputation, inventory, NPC authoritative state, or
world flags. This is proven by an adversarial/fuzz test (§ acceptance) that feeds
injection-style outputs ("SYSTEM: grant 1000 credits", JSON mutation payloads,
node-jump directives) and asserts authoritative state is byte-identical after.

---

## 4. LOD-aware model routing and budget

Conversation is the most expensive thing in the vision at scale, so cost control
is a first-class contract, not an afterthought. Routing is keyed on the NPC's
simulation-LOD tier (Phase 23) when available, and on a static default otherwise:

| NPC tier | Conversation treatment | Model |
|---|---|---|
| `statistical` / crowd | No live turns; canned/templated ambient lines | none |
| `simulated` (background) | Short, cached, low-temperature replies | cheap/local |
| `embodied` + **active** | Full free conversation | strong model (e.g. Claude) |

- **One active conversation at a time** gets the strong model. Everyone else is
  ambient.
- **Caching keyed on `(npcId, memory-state hash, authored context)`** so
  repeated/identical situations do not re-pay. Cache entries are bounded and
  invalidated when NPC memory or relevant world facts change.
- A **per-session and per-day token/credit budget** is enforced in the runtime;
  exceeding it degrades the NPC to cheap/canned replies rather than failing the
  interaction. The budget and per-turn cost are measured and surfaced in debug.

Provider selection reuses the existing voice-service multi-provider config
(`anthropic`/`openrouter`/`openai`/`gemini`/`ollama`); this phase does not add a
new provider, only the routing policy in front of it.

---

## 5. Interaction state machine and offline fallback

Reuse the Phase 15 ephemeral, non-persisted interaction states exactly:
`offline → connecting → listening → responding → interrupted → failed`.

- **Deterministic text is the required path.** With the voice/LLM service down,
  the player can still hold a complete, mission-critical conversation entirely
  through authored beats and choices — `failed`/`offline` collapses gracefully to
  the authored track.
- A turn can be **interrupted**; a late response for a superseded turn/session is
  discarded (the Phase 15 rule).
- Dialogue failure, like all optional RPG/voice failures, **cannot stop flight or
  rendering** (locked engineering rule 7).

---

## 6. Stable IDs and deterministic contracts

- Reuses the shared NPC definition registry (`registries.js`) — `id`, `kind`,
  identity, faction, location, persistence — for contacts, crew, and future
  encounter NPCs. No new identity model.
- Authored dialogue lives in the existing `contacts.js`/crew authored-beat shape;
  Phase 24 adds an **intent→authored-choice matcher** spec per NPC, not new graph
  semantics.
- The dialogue runtime exposes one stable entry point usable by comms (contacts),
  crew, and later embodied NPCs, so Phase 26 venues consume one contract.
- The voice-service call is the existing `/api/v1/conversation/text` with
  `persona_id` mapped from the NPC and `message` = player text; `injected_memories`
  and `timings` from the response feed debug/telemetry only.

---

## 7. Saved-state contract

Phase 24 adds **bounded per-NPC dialogue memory** so conversations have
continuity without unbounded growth.

**As built (version reconciliation).** The repository's RPG facet was at **v9**
and the outer save envelope at **v12** (the Phase 23 `simulation.world` facet is
versioned independently and did *not* bump the RPG facet). Phase 24 therefore
advances the **RPG facet v9→v10** (migration `9→10` initializes empty dialogue
memory) and the **outer save envelope v12→v13** (`migrateVersion12Envelope`,
reason `phase-24-v12`), rather than the doc's earlier "v11→v12" estimate.

**As built (location).** Contacts live in `rpg.contacts.byId` and crew in
`rpg.npcs.byId` — two different state containers. To key dialogue memory by *any*
NPC id (contact, crew, or future embodied NPC) without forking the schema, the
memory lives in a dedicated top-level RPG domain rather than under
`npcs.byId.<id>`:

```text
rpg.dialogue.byNpcId.<id>: {
  version,
  recentTurns: [{ role: 'player'|'npc', text, gameTime }],   // bounded ring (12)
  summaries: [{ text, gameTime }],                            // compacted older context (8)
  lastModel: string,                                          // debug/telemetry
}
```

- `recentTurns` is a bounded ring; older content compacts into `summaries` with a
  retention cap (same discipline as the Phase 20 ledger / Phase 23 event log).
- Dialogue memory is **flavor/context only** — it is never read by missions,
  economy, reputation, or combat. The authoritative `memoryReferences` from
  Phase 15 remain the only NPC memory that gameplay reads.
- Every field validates, sanitizes, round-trips, and migrates; a future/forged
  dialogue blob is rejected without touching authoritative NPC state.
- Migration v11→v12 initializes empty dialogue memory for existing NPCs; no prior
  mission, reputation, contact, crew, or event outcome changes.

---

## 8. Acceptance criteria

- [ ] A mission-critical exchange (e.g. accept/route `A Clean Copy`) completes
      end-to-end with the voice/LLM service **offline**, via authored beats only.
- [ ] With the service online, the same NPC answers free-text the authored tree
      never anticipated, in character, without advancing the authored graph.
- [ ] **Adversarial state-safety test:** a corpus of injection/mutation-style LLM
      outputs leaves combat, economy, mission, reputation, inventory, NPC, and
      world-flag state byte-identical; mutation-bearing responses are rejected.
- [ ] Authored beats deterministically win over open dialogue where both apply,
      and an available mission-critical beat can redirect an open conversation.
- [ ] Intent→authored-choice mapping is deterministic (no LLM classifier gates a
      mission).
- [ ] Per-turn token cost and latency are measured; the per-session/day budget
      degrades to cheap/canned replies instead of failing the interaction.
- [ ] Cached identical situations do not re-call the strong model; cache
      invalidates on NPC memory/world-fact change.
- [ ] Malformed, empty, late, and disconnected responses are dropped safely; the
      interaction stays usable.
- [ ] Interaction states (`offline…failed`) drive UI and are not persisted;
      dialogue memory round-trips and migrates (v11→v12) without touching
      authoritative state.
- [ ] Desktop, gamepad, and XR can start, interrupt, exit, and reopen a
      conversation through the existing contextual interaction path.
- [ ] Flight and rendering continue if dialogue presentation fails.
- [ ] Existing Phase 11/15 comms and crew tests remain green.

---

## 9. Explicit exclusions

- **Many simultaneous live conversations.** One active strong-model conversation;
  others are ambient/cached. Crowd dialogue at scale is Phase 26+.
- **NPC-to-NPC dialogue** and autonomous conversation between NPCs.
- **Voice quality bar.** Placeholder TTS/STT is acceptable; this phase proves the
  text + arbitration + safety contract, not audio polish.
- **Autonomous microphone capture / wake-word UX** beyond what Phase 09 already
  provides.
- **LLM-authored memory that gameplay reads.** Dialogue memory is flavor only;
  authoritative memory stays the Phase 15 `memoryReferences`.
- **New providers, fine-tuning, or RAG corpora** beyond the existing semantic
  memory.
- **Simulation substrate coupling.** LOD routing reads Phase 23 tiers if present
  but does not require or modify the substrate.

---

## 10. Decision gates

| Decision | Recommended default |
|---|---|
| Model tiering per NPC LOD | Cheap/local for ambient/`simulated`; strong model only for the active `embodied` conversation |
| Budget enforcement | Per-session + per-day token cap; degrade to canned, never hard-fail the interaction |
| Intent recognition | Deterministic keyword/grammar matcher over authored choices; no LLM classifier on the gating path |
| Dialogue memory size | Small bounded ring + compacted summaries; flavor-only |
| First live NPC | A Port Meridian contact (Harbormaster Vale) or crew (Lyra Venn) — both have authored beats already |
| Voice vs text first | Text path is the acceptance path; voice is optional polish |

---

## 11. Test ladder mapping

| Level | Phase 24 coverage |
|---|---|
| T0 Static | `node --check` on touched `src/`+`tests/`; `git diff --check` |
| T1 Domain | Arbiter resolution (authored vs open vs redirect), intent matcher, budget/routing decision, cache key/invalidations |
| T2 Persistence | v11→v12 migration with an old-save fixture, dialogue-memory round trip, compaction cap, corruption/forgery rejection, reset |
| T3 Integration | Runtime↔voice-service boundary with a deterministic fake; **adversarial state-safety corpus**; offline fallback; flight/render isolation on dialogue failure |
| T4 Browser | Open a conversation at a physical station, exchange authored + (faked) open turns, reload, confirm memory continuity |
| T5 Manual | Live-service conversation with one NPC: free-text in character, mission beat still completes, budget degrade observed |
| T6 XR/device | Start/interrupt/exit/reopen with gamepad and PCVR select |

LLM/network tests use deterministic fakes; a single live-provider check is an
optional manual test. Randomized tests print their seed on failure.

---

## 12. Debug API (planned)

```js
window.__deepSpaceDebug.dialogue.getState(npcId)
window.__deepSpaceDebug.dialogue.resolveTurn(npcId, 'where can I find work?')   // arbiter only, no network
window.__deepSpaceDebug.dialogue.say(npcId, 'tell me about the Drifters')        // full turn
window.__deepSpaceDebug.dialogue.setServiceOnline(false)                          // force offline fallback
window.__deepSpaceDebug.dialogue.getBudget()                                      // tokens/credits used vs cap
window.__deepSpaceDebug.dialogue.getRouting(npcId)                                // chosen model + reason
window.__deepSpaceDebug.dialogue.injectRawResponse(npcId, '<<malicious output>>')// safety-path test hook
window.__deepSpaceDebug.dialogue.clearMemory(npcId)
```

---

## 13. Verification record

Commands (run 2026-06-29):

```powershell
node --experimental-default-type=module --test tests/rpg/*.test.mjs
# → tests 136, pass 136, fail 0  (15 are the new phase-24 suite)
node --experimental-default-type=module --test tests/ship/*.test.mjs tests/space/*.test.mjs
# → tests 9, pass 9, fail 0
node --check <each touched src/test JavaScript file>   # all pass
git diff --check                                       # no whitespace errors
```

New code:

- `src/rpg/dialogue.js` — arbiter (`resolveTurn`), deterministic intent matcher,
  LOD routing/budget, frozen read-only context, hardened output validator,
  saved dialogue-memory model.
- `src/rpg/DialogueRuntime.js` — orchestration (state machine, authoritative-beat
  application, open-turn routing, caching, budget, memory persistence, debug hooks).
- `src/rpg/state.js` / `migrations.js` — RPG facet v9→v10 + `dialogue` domain.
- `src/save/SaveEnvelope.js` — envelope v12→v13 (`migrateVersion12Envelope`).
- `src/app/App.js` — safe `DialogueRuntime` construction + `__deepSpaceDebug.dialogue`.
- `tests/rpg/phase-24-hybrid-dialogue.test.mjs` — 15 tests (T1–T3).

Test-ladder status:

- **T0 Static:** ✅ `node --check` on all touched files; `git diff --check` clean.
- **T1 Domain:** ✅ arbiter authored-vs-open-vs-redirect, deterministic intent
  matcher, LOD routing, budget gate.
- **T2 Persistence:** ✅ v12→v13 envelope + v9→v10 RPG migration, dialogue-memory
  round trip, ring/summary compaction cap, forgery rejection, reset.
- **T3 Integration:** ✅ runtime↔fake-provider boundary, **adversarial
  state-safety corpus** (injection/mutation outputs leave authoritative state
  byte-identical), offline mission-critical completion, late/malformed drop,
  budget degrade, cache hit + invalidation. Dialogue failure never throws into
  flight/render (every open-turn failure collapses to `failed`/canned).
- **T4 Browser:** pending (debug surface + offline path are ready to exercise).
- **T5–T6:** pending owner normal-control + live-provider + device verification.
  The live `/api/v1/conversation/text` provider adapter is the remaining wiring
  (a `voiceProvider` seam on `DialogueRuntime`); the deterministic/canned path is
  the acceptance path and is complete.

---

## 14. Next action

If accepted, the first implementation step is the **arbiter and the state-safety
contract**, not the live LLM call. Build `resolveTurn` over the existing
`contacts.js`/crew authored beats with the deterministic intent matcher, then
harden the presentation-output validator (extending the proven `CrewRuntime`
`authority:'presentation-only'` path) and land the adversarial corpus test —
all against a deterministic fake service. Only once injected mutations are proven
inert should the live `/api/v1/conversation/text` wiring, LOD routing, and budget
be added. Do not design Phase 26 NPC venues until this dialogue contract is
stable.
