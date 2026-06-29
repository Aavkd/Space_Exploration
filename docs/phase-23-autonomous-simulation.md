# Phase 23 — Autonomous World Simulation (Simulation Substrate)

> **Status:** Proposed design — not started. This document defines the
> architecture-defining phase, not a content phase. Its deliverable is the
> **simulation substrate and its level-of-detail contract**, proven with three
> factions. The three factions are the test fixture; the substrate is the
> product.
> **Dependencies:** Phase 13 active-play `gameTime` clock and versioned save
> envelope, Phase 14 cargo/credits, Phase 17 faction territory and reputation,
> Phase 20 dynamic economy and tick model.
> **Source design:** `rpg-design-vision.md` §2 (tier fluidity), §5 (factions),
> §7 (simulation), `worldbuilding.md` (faction roster, tier-transition triggers),
> `rpg-future-development-roadmap.md` (Phase 23 row).
> **Last updated:** 2026-06-28.

---

## 1. Why this phase is different

Every phase from 13 to 22 ships a **single-instance proof**: one crew member,
one patrol, one raider, three markets, one outpost, one derelict. That was
correct de-risking. But the entire mid- and long-term vision — emergent
civilizations, crowds, procedurally populated cities, and the post-ascension
god-view that perceives the whole simulation at once — depends on one unproven
claim the codebase has never validated: **the world runs as a coherent
simulation independent of the player's viewpoint, observed at variable
resolution.**

Phase 23 retires exactly that risk. It introduces a **headless deterministic
simulation tick** decoupled from the renderer, and a **simulation
level-of-detail (LOD) contract** that lets the same world be represented as raw
lore, as aggregate statistics, as scheduled agents, or as embodied rendered
entities — promoting and demoting entities by player proximity and interest.

This single substrate is reused, unchanged, by later work:

| Later vision element | Reuses |
|---|---|
| Thousands of NPCs / crowds | Simulation-LOD tiers (`dormant` → `statistical`) |
| Procedurally populated cities | `simulated` tier instantiated on landing |
| Emergent factions/civilizations | Faction agendas + relationship matrix on the tick |
| Tier fluidity (civ ascend/descend) | Tier-transition events on the tick |
| Post-ascension god-view (Phase 26+) | Reading/perturbing the substrate without a body |
| Cosmic mutation (Phase 28) | The substrate's referential-integrity rules |

If this phase is built well, the rest of the plural vision is content and
tuning. If it is built as "just three factions," the project re-incurs the 1→N
risk on every future phase.

---

## 2. The Simulation LOD contract (centerpiece)

Every simulation entity (civilization, faction, settlement, future NPC, future
city) exists at exactly one **simulation LOD tier** at any moment. This is
**simulation resolution**, and is orthogonal to the in-world **civilization
tier** (0–4) from `rpg-design-vision.md` §2. The two must never be conflated in
code or data.

| LOD | Name | What exists | Cost | Promotes when |
|---|---|---|---|---|
| **L0** | `dormant` | Lore + identity only. No live numbers. | ~0 | Player enters the same region / it becomes referenced by an active event |
| **L1** | `statistical` | Aggregate scalars: population, wealth, stability, civ tier, faction control, agenda progress. Advances by closed-form per-tick deltas. | cheap, bounded | Player enters the system, or it participates in a faction event |
| **L2** | `simulated` | Concrete scheduled agents/sites with individual state, derived from the L1 aggregates on promotion. | moderate, capped count | Player lands / docks / is in close range |
| **L3** | `embodied` | Rendered, walkable, voice/LLM-eligible entities in the Three.js scene. | expensive, hard-capped | Entity is within the active scene frame |

**Rules (locked):**

1. **Promotion is deterministic and reversible.** Promoting L1→L2 derives
   concrete agents from aggregates + seed; demoting L2→L1 folds their changed
   state back into aggregates. A round trip with no intervening simulation is a
   no-op. This is the same "what you see is what you touch, reproducibly"
   contract `planetHeightBasis.js` enforces for terrain, applied to population.
2. **Only L1 is authoritative for off-screen time.** L2/L3 never advance world
   time on their own; when the player leaves, their state demotes to L1 and all
   further evolution is the cheap closed-form L1 tick. There is no per-agent
   off-screen simulation and no unbounded catch-up.
3. **The player observes a resolution, never changes the rules by observing.**
   Demote→promote across a save/reload or a trip away must reconstruct
   equivalent state from `(seed, aggregates, event history)`, not from retained
   L2 detail.
4. **Hard caps per tier are configuration, not emergent.** `simulated` agent
   count and `embodied` entity count have explicit budgets; exceeding them
   selects by proximity/interest and demotes the rest.

The promotion/demotion boundary is the single most important interface in the
project. It is what makes "thousands of NPCs", "populated cities", and the
god-view all the *same problem at different resolutions*.

---

## 3. The headless simulation tick

The simulation core is a **pure, deterministic module with no `three`, DOM,
audio, or renderer import**. It advances world state from accumulated Phase 13
`gameTime` only, exactly like the Phase 20 economy tick, and is structured so it
can later be moved to a Web Worker, WASM, or a local sim server without changing
its contract (platform is not a project constraint; this phase keeps the option
open by drawing the boundary now).

```text
simCore.step({ state, fromGameTime, toGameTime, seed, commands }) -> { state, events }
```

- **Pure function of inputs.** Same `(state, seed, command sequence, time span)`
  always yields the same `(state, events)`. Randomized internals draw from a
  seeded stream (`rng.js`) and print the seed on test failure.
- **Bounded catch-up.** Processes ticks in capped batches across update calls;
  resumes remaining accumulated active-play ticks later (reuses the Phase 20
  pattern). Never reads wall clock or page-close duration.
- **Commands are the only intervention input.** The player (pre-ascension via
  in-world actions, post-ascension via god-mode) perturbs the simulation by
  enqueuing a `command` that changes an *input* to the tick — never by selecting
  a scripted outcome. This is the contract Phase 26 indirect influence inherits.
- **Events are the audit log.** Every observable change (territory shift, market
  swing, relationship change, tier transition) emits a stable-ID event; all
  downstream state must trace to an event. This is what makes the simulation
  explainable and is the prerequisite for the Phase 25 "eligibility is
  explainable from history" rule.

The renderer/runtime layer (`RpgRuntime` and friends) becomes a **pure view and
command source** over this core. Existing Phase 17 territory queries and Phase
20 economy state become *projections* of the substrate rather than independent
owners. (Migration note: Phase 20 economy is folded under the substrate as the
L1 economic facet; its existing contract and IDs are preserved.)

---

## 4. Stable IDs and deterministic contracts

Factions (proof fixture — drawn from `worldbuilding.md`, three of the locked
Tier 2 roster, placeholder until §24B content):

- `faction_commonwealth` (reuses Phase 17 Commonwealth influence)
- `faction_index`
- `faction_drifters`

Civilizations / settlements at this phase remain **L0/L1 only** (no `simulated`
agents yet — agents arrive with crew/city phases). Each L1 entity has a stable
ID, a seed, an authored initial aggregate vector, and a civ tier.

Drives and agendas:

- Each faction has an authored **drive vector** (e.g. `expansion`,
  `accumulation`, `aggression`, `isolation`) seeded distinctly so the three
  factions behave observably differently from their drives alone.
- An **agenda** is a stateful goal derived from drives + world state
  (`expanding`, `consolidating`, `at_war`, `retreating`, `trading`).
- A **relationship matrix** holds pairwise attitude floats in `[-1, 1]`;
  conflict zones are where adjacent territories of mutually negative factions
  meet.

Tier transition (the one tier-fluidity proof for this phase):

- One deterministic transition rule from `worldbuilding.md` triggers (e.g. a
  faction whose `stability` crosses a threshold after sustained `at_war`
  descends a civ tier). The transition is an event, mutates the entity's civ
  tier as data, and is reversible only via further events — never silently.

Tick cadence: one simulation tick is a fixed span of Phase 13 `gameTime`
(proposed 60 s to match the economy tick; decision gate below). Ticks are
deterministic, bounded, and capped per update.

---

## 5. Saved-state contract

The save envelope advances from **version 10 to 11**. A new `simulation.world`
facet is added (and the Phase 20 `simulation.economy` facet is re-parented under
it as the economic projection, preserving its existing fields and IDs):

```text
simulation.world: {
  version,
  seed,
  lastTickGameTime,
  nextEventSequence,
  lod: {
    byEntityId: { [entityId]: { tier: 'dormant'|'statistical'|'simulated'|'embodied' } }
  },
  factions: {
    byId: {
      [factionId]: {
        id, civTier, drives: {...}, agenda,
        aggregates: { population, wealth, stability, controlProgress },
        territory: { systemIds: [...] }
      }
    }
  },
  relationships: { pairs: { [factionPairKey]: { attitude } } },
  events: [{
    id, sequence, type, gameTime, subjectIds: [...],
    cause: { commandId | priorEventId | 'tick' },
    before: {...}, after: {...}
  }]
}
```

- The version-10→11 migration **initializes the world facet at the saved
  `simulation.gameTime`** and does not simulate elapsed pre-migration time
  (same rule as Phase 20). Existing Phase 17 territory/reputation and Phase 20
  economy migrate non-destructively and are reconciled as projections.
- Every field validates, sanitizes, and bounds-checks through the envelope.
  Forged aggregates, out-of-range attitudes, non-monotonic event sequences,
  time regression, unknown faction/entity IDs, or an LOD tier inconsistent with
  presence fail descriptively.
- Event log retention is bounded with a documented compaction policy; compaction
  must preserve referential integrity (no surviving state references a compacted
  event without a retained summary).
- A reload mid-tick observes wholly-before or wholly-after world state via a
  single `saveDomains` write, exactly like the Phase 20 transaction rule.
  Storage failure follows the existing visible in-memory fallback.

---

## 6. Acceptance criteria

- [ ] The simulation core has no renderer/DOM/audio/`three` import and runs
      from accumulated Phase 13 `gameTime` only.
- [ ] `simCore.step` is a pure function: `(seed, state, command sequence, time
      span)` reproduces identical `(state, event history)`.
- [ ] Catch-up is bounded per update and uses only accumulated active play;
      closing the game advances no world time.
- [ ] The LOD contract is enforced: every entity has exactly one tier; promotion
      L1→L2→L1 with no intervening sim is a verified no-op.
- [ ] Demote→reload→promote reconstructs equivalent state from
      `(seed, aggregates, events)`, not from retained detail.
- [ ] Hard caps on `simulated`/`embodied` counts hold under stress; over-budget
      entities demote deterministically by proximity/interest.
- [ ] Three factions behave observably distinctly from their authored drive
      seeds alone (no per-faction scripted branches).
- [ ] Territory, market, patrol attitude, and relationship changes each trace to
      a stable event ID.
- [ ] One civ-tier transition fires from documented `worldbuilding.md` triggers,
      mutates tier as data, and is reversible only via further events.
- [ ] A player intervention command changes a *tick input* and produces a
      different, explainable event history — not a selected scripted result.
- [ ] Phase 17 territory queries and Phase 20 economy remain correct as
      projections; their existing tests stay green.
- [ ] Version-10→11 migration, version-11 round trip, corruption rejection,
      event-log compaction integrity, reset, and debug inspection are covered.
- [ ] A long seeded soak preserves population/wealth/stability invariants
      (finite, bounded, no NaN, no negative populations) over a large tick count.
- [ ] Existing RPG, flight, and rendering regressions remain green; an RPG/sim
      failure cannot stop flight or rendering (locked rule 7).

---

## 7. Explicit exclusions

- **No `simulated`-tier agents with individual schedules yet.** Per-NPC daily
  life (jobs, relationships, hobbies) and procedural city population are a later
  phase; Phase 23 ships L0/L1 plus the *contract and machinery* for L2/L3, with
  L2 exercised only by a synthetic promotion test, not by content.
- No procedural city/settlement layout generation, no biome system, no surface
  crowds. (Those consume this substrate later.)
- No live LLM in the simulation loop. LLM remains the disabled flavor lane and
  never owns state (locked rule 1).
- No Web Worker / WASM / server move in this phase. The boundary is drawn so the
  move is later mechanical; the core still runs in-process.
- No ascension, god-mode commands, or universe mutation (Phases 25–29). Phase 23
  only proves the substrate those phases command.
- No new physical interaction surface required; faction/world state is observed
  through existing comms, navigation, patrol, and the ship log/codex. A diegetic
  "world report" surface is a follow-up.

---

## 8. Decision gates

| Decision | Recommended default |
|---|---|
| World tick span | 60 s `gameTime`, matching the economy tick |
| LOD tier names/count | The four above (`dormant`/`statistical`/`simulated`/`embodied`) |
| Economy ownership | Re-parent Phase 20 economy as the L1 economic projection |
| Where the substrate lives now | In-process pure module; worker/WASM deferred |
| Proof faction count | Three (Commonwealth, Index, Drifters) |
| Player-facing world report | Reuse ship log/codex; defer a dedicated surface |
| Event-log retention | Bounded with compaction summaries preserving integrity |

---

## 9. Test ladder mapping

| Level | Phase 23 coverage |
|---|---|
| T0 Static | `node --check` on all touched `src/`+`tests/` files; `git diff --check` |
| T1 Domain | Pure `simCore.step` determinism, drive→agenda derivation, relationship/conflict math, one tier transition, LOD promotion/demotion no-op |
| T2 Persistence | v10→v11 migration with an old-save fixture, v11 round trip, corruption rejection, compaction integrity, reset |
| T3 Integration | Territory/economy/patrol projections agree with the substrate; intervention command changes event history; flight/render isolation on sim failure |
| T4 Browser | Static load to live telemetry; debug mirror shows world facet, faction aggregates, and event log |
| T5 Manual | Observe three factions diverge over active play; intervene once; observe a different reported outcome; reload preserves history |
| T6 XR/device | N/A unless a new diegetic surface is added (deferred) |

Randomized tests use an explicit seed printed on failure; time-dependent tests
use an injected clock; all simulation tests use deterministic fakes only.

---

## 10. Debug API (planned)

The debug surface calls the same authoritative runtime as normal play:

```js
window.__deepSpaceDebug.world.getState()
window.__deepSpaceDebug.world.getFaction('faction_index')
window.__deepSpaceDebug.world.getRelationships()
window.__deepSpaceDebug.world.getLod('faction_index')
window.__deepSpaceDebug.world.getEvents({ since: 0 })
window.__deepSpaceDebug.world.promote('faction_index', 'simulated')
window.__deepSpaceDebug.world.demote('faction_index', 'statistical')
window.__deepSpaceDebug.world.enqueueCommand({ type: 'incite_conflict', a: 'faction_commonwealth', b: 'faction_index' })
window.__deepSpaceDebug.world.step()          // advance one bounded batch
window.__deepSpaceDebug.world.soak(1000000)   // seeded invariant soak
```

---

## 11. Verification record

**Status:** Implemented 2026-06-29. T0–T4 automated/browser evidence recorded;
T5–T6 remain owner normal-control/device signoff.

Commands run:

```powershell
node --experimental-default-type=module --test tests/rpg/*.test.mjs   # 121 pass
node --experimental-default-type=module --test tests/**/*.test.mjs    # 130 pass
node --check <each touched src/ + tests/ file>                        # clean
git diff --check                                                       # clean
```

- **T0 Static:** `node --check` clean on `simWorld.js`, `WorldRuntime.js`,
  `rpg/index.js`, `save/SaveEnvelope.js`, `save/LocalSaveSlots.js`,
  `save/index.js`, `app/App.js`, and the new test. `git diff --check` clean.
- **T1 Domain:** `tests/rpg/phase-23-autonomous-simulation.test.mjs` — `simStep`
  determinism, drive→agenda divergence (expanding/trading/consolidating),
  relationship/conflict band events, LOD L1→L2→L1 fold no-op, embodied- and
  simulated-tier hard-cap demotion by interest, one civ-tier transition
  (data-only, not silently reversible), bounded catch-up (split == single; closed
  game = no ticks), intervention changes event history, seeded soak invariants,
  event-log compaction integrity.
- **T2 Persistence:** v11→v12 migration from `tests/fixtures/phase-22-v11-clean.json`
  (world initialized at saved `gameTime`, economy/ship/reputation unchanged),
  v12 round trip, demote→save/reload→promote reconstruction from
  `(seed, aggregates)`, corruption rejection (forged aggregates, out-of-range
  attitude, non-monotonic sequences, time regression, unknown faction/system IDs,
  bad LOD tier), active-slot reset.
- **T3 Integration:** territory projection agrees with Phase 17 `queryFactionInfluence`;
  WorldRuntime advances on play time, persists, and an intervention survives
  reload; closing the game adds no world time; a corrupt world facet is rejected
  at write while the economy facet on the same slots stays operable (flight/render
  isolation, locked rule 7).
- **T4 Browser:** static load on the live app (`http-server` :5990) — the world
  tick runs in the animation loop and `window.__deepSpaceDebug.world`
  (`getState`/`getFaction`/`getRelationships`/`getTerritory`/`getLod`/`getEvents`/
  `promote`/`demote`/`materialize`/`enqueueCommand`/`step`/`soak`) returns live
  telemetry with no console errors.
- **T5–T6:** pending owner normal-control verification.

### Implementation notes / decisions taken

1. **Save version is v11→v12, not v10→v11.** Phase 22 had already advanced the
   envelope to v11; this phase adds the `simulation.world` facet at v12 with the
   `phase-23-v11` migration reason.
2. **Faction IDs reuse the Phase 17 registry** (`commonwealth`/`index`/`drifters`)
   rather than the `faction_*` placeholders in §4, so territory and reputation
   read as projections of the same identities.
3. **The economy facet stays co-located at `simulation.economy`** and is treated
   as the L1 economic projection *logically* (the world substrate references it
   via `WorldRuntime`/projection helpers). It was not physically re-nested under
   `simulation.world` because acceptance criterion §6 requires the existing
   Phase 20 tests — which read `envelope.simulation.economy` directly — to stay
   green; the physical re-parent is deferred as a mechanical follow-up.
4. **Territory is static in this phase** (each faction holds its home system);
   the data-mutating, event-only proof of tier fluidity is the civ-tier descent.

### Known deviations from §6 acceptance criteria

These are the gaps where the shipped substrate does not yet meet a §6 bullet, kept
as deliberate, documented deferrals (locked rule 10: out-of-scope discoveries go
to follow-up backlog). The simulation-LOD machinery, determinism, persistence,
and divergence criteria are met; the items below are the projection/ownership
seams that later phases consume.

1. **Territory changes do not emit events.** §6 requires "territory … changes
   each trace to a stable event ID", but territory is static (note 4 above), so no
   `territory.changed` event type exists. *Relationship*, *agenda*, and *civ-tier*
   changes do trace to stable IDs. Closing this requires a deterministic
   territory-capture rule on the tick; deferred to the §24B faction-content pass.
2. **Market changes are not driven or projected by the substrate** and do not
   trace to world event IDs. The Phase 20 economy remains the owner; it is the L1
   economic projection only *logically* (note 3). Folding the economy tick under
   `simStep` so market swings emit world events is the same mechanical re-parent
   as item 3 above and is deferred with it.
3. **Patrol attitudes remain owned by the Phase 17 faction/patrol systems** rather
   than being projections of the substrate relationship matrix; patrol-policy
   changes do not trace to world event IDs. The substrate relationship matrix and
   `getRelationshipAttitude` exist as the future source; wiring Phase 17 patrols
   to read them (and emit on change) is deferred to the §24B pass.
4. **Full flight/render failure isolation is shown at the write boundary only.**
   The node tests prove a corrupt world facet is rejected at `saveDomains` and
   that other facets stay operable; the App-level containment of a *throwing tick*
   (`_updateWorldSafely` / `_createWorldRuntimeSafely`) keeps flight/render alive
   but is exercised at T4 (browser), not by a node unit, because the read path
   re-clones clean state via `structuredClone` and the render loop needs `three`.

Resolved during this pass (previously open): the **simulated-tier hard cap** is
now deterministically enforced by `enforceSimulatedBudget` (mirroring
`enforceEmbodiedBudget`), and a **demote → save/reload → promote** persistence
test proves L2 state is reconstructed from `(seed, aggregates)` rather than
retained detail.

---

## 12. Next action

If this framing is accepted, the first implementation step is **not** the three
factions — it is the pure `simCore` module and its LOD promotion/demotion test
with a single synthetic entity. Lock the `(seed, state, commands, span) ->
(state, events)` signature and the L1↔L2 round-trip no-op before any faction
content, drive tuning, or projection wiring is written. Author the three faction
drive seeds only after the substrate's determinism and migration tests are green.
