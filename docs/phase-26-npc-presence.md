# Phase 26 — NPC Presence And Encounter Layer

> **Status:** Proposed design — not started. Horizon 5 (The Living World). The
> first phase to exercise the Phase 23 `simulated → embodied` (L2→L3) boundary
> with real content, across the three venues the vision names: **surface,
> station, and ship.**
> **Dependencies:** Phase 23 simulation substrate + LOD contract (promotion/
> demotion, aggregates, events), Phase 24 hybrid dialogue (every embodied NPC is
> talkable), Phase 15 shared NPC contract (`registries.js`/`npcs.js`,
> `NPC_KINDS = ['contact','crew','encounter']`, presence/relationship/mood/memory),
> Phase 16 surface venue + Phase 25 regions (surface placement), Phase 21
> untethered EVA/boarding (ship-boarder venue), Phase 13 saves.
> **Enables:** Phase 27 city crowds and Phase 29 authored NPC content.
> **Source design:** `rpg-design-vision.md` §4.1 (NPC categories), §3.3 (planet
> population), `rpg-future-development-roadmap.md` (Phase 26).
> **Last updated:** 2026-06-28.

---

## 1. Why this phase, and what it inherits

The NPC *data* model already exists and is single-instance proven:

- `NPC_KINDS = ['contact','crew','encounter']` — the `encounter` kind is defined
  but **no encounter NPC exists yet**.
- NPC state is `{ presence, locationId, relationship, mood, memoryReferences,
  alive, recruited }`, and physical presence is derived
  (`isNpcPhysicallyPresent` = `alive && recruited && presence === 'aboard'`).
- Phase 24 makes any NPC talkable; Phase 23 holds populations as `statistical`/
  `simulated` aggregates with reversible promotion/demotion.

Two things are missing, and they are exactly the 1→N risk the roadmap has
deferred every phase so far:

1. **Presence is ship-anchored.** `isNpcPhysicallyPresent` only knows "aboard at
   one anchor." There is no venue-agnostic way for an NPC to be *here* on a
   surface, in a station, or aboard during a boarding.
2. **Nothing turns a substrate aggregate into a standing, talkable body** and
   back. The Phase 23 `simulated → embodied` boundary has only a synthetic test.

Phase 26 builds the **embodiment service** that crosses that boundary with
content, venue-agnostic, and proves the same NPC identity survives the round trip
without duplication or loss. It does **not** add city-scale crowds (Phase 27) or
per-NPC daily schedules (Phase 28).

---

## 2. The embodiment service (centerpiece)

A single service owns the L2↔L3 transition for every venue. It is the content
exercise of the Phase 23 LOD contract, not a new simulation.

```text
embodyNear({ venue, locationRef, budget }) -> EmbodiedNpc[]   // promote L2→L3
release(npcId) -> void                                        // demote L3→L2/L1
```

Rules (locked, inherited from Phase 23 §2):

1. **Promotion derives a body from aggregates + seed**, never from retained L3
   detail. An NPC that was a row in a `simulated` settlement becomes a standing,
   named, talkable agent; on `release` its changed relationship/memory folds back
   into the substrate.
2. **The round trip is reversible and lossless for identity.** `embody → release
   → embody` (or `embody → reload → embody`) reconstructs the same NPC from
   `(seed, aggregates, events)`. This is the Phase 23 no-op asserted with content.
3. **No embodied NPC advances world time.** Off-screen evolution stays L1; an
   embodied NPC only changes its *own* relationship/memory through interaction,
   and only the substrate clock advances the world.
4. **Budget-bounded.** Embodied count is hard-capped; over-budget candidates are
   selected by proximity/interest and the rest stay `statistical`/`simulated`
   (no body, ambient at most).

Embodied NPCs reuse the generalized NPC contract (§5) and the Phase 24 dialogue
runtime; the service supplies only presence, a placeholder body, and the
venue-anchored pose.

---

## 3. The three venues

One embodiment service, three placement adapters. To keep this phase to a single
new real-time risk (embodiment), the two venues that already have environments
are the proof path; the station reuses an existing interior shell rather than a
bespoke build.

### 3.1 Surface (existing environment)
- Placement via Phase 25 `findRegions`/`regionAt` + a seeded offset, resolved to
  terrain with the Phase 16 marker/placement discipline (never buried/floating).
- Body walks the tangent plane reusing `SurfaceLocomotion` ground-follow; the
  player meets it on foot after landing.

### 3.2 Ship (existing environment)
- Reuses the Phase 21 untethered-EVA/boarding frame and the walkable interior:
  an `encounter`-kind NPC is aboard during a boarding event, present in the
  interior, and leaves when the event resolves.
- Generalizes the crew presence rule so "aboard" is one venue among several.

### 3.3 Station (thin new venue, reused shell)
- A minimal docking approach + **reused interior shell** (the boarding/ship
  interior block) so stations are a real place to meet NPCs, **not** a bespoke
  environment this phase. A station resident is an embodied NPC at a fixed anchor
  inside the shell.
- Full bespoke station interiors, exterior art, and docking simulation are
  deferred to content (Phase 29) or a dedicated split.

---

## 4. Budget and selection

Reuses the Phase 23 LOD budgets; conversation cost is governed by Phase 24.

- **Embodied cap** per scene is config; exceeding it demotes lowest-interest NPCs
  to `simulated`/`statistical`.
- **One active conversation** gets the strong dialogue model (Phase 24 §4);
  other embodied NPCs are ambient/cached or silent.
- Selection key: proximity, then interest (faction relevance, mission link,
  relationship magnitude). Selection is deterministic given the same scene state.

---

## 5. Stable IDs and contracts

- **Generalized NPC contract.** Extend the shared `registries.js`/`npcs.js`
  definition so an NPC's location is venue-agnostic:

```text
NpcPlacement {
  venue: 'ship' | 'surface' | 'station',
  ref: { anchorId? } | { planetId, regionId, offsetSeed } | { stationId, anchorId }
}
```

  `isNpcPhysicallyPresent` generalizes from "aboard one anchor" to "embodied at
  the player's current venue and alive." Crew (`aboard`) remains a special case of
  the same rule; existing crew behavior is unchanged.
- **Encounter NPCs become real.** The defined-but-unused `encounter` kind gets
  its first instances here (surface resident, station resident, ship boarder),
  all sharing `id`, `kind`, identity, faction, persistence shape.
- **Substrate linkage.** An embodied NPC carries the `entityId` of its Phase 23
  source aggregate so `release` knows where to fold state back. Authored NPCs
  (contacts/crew) have no aggregate parent and never demote.
- Embodied bodies are a placeholder representation reused across venues (one
  stand-in mesh), explicitly temporary art.

---

## 6. Saved-state contract

The save envelope advances one version (v12→v13, assuming Phase 24 shipped v12).
The RPG `npcs` domain generalizes from "crew only" to a **bounded registry of met
NPCs**:

```text
npcs: {
  crewCapacity, crewRoster,            // unchanged
  byId: {
    <id>: {
      kind,                            // contact | crew | encounter
      placement,                       // venue-agnostic (§5)
      relationship, mood, memoryReferences, alive,
      recruited,                       // crew only
      entityId?,                       // Phase 23 substrate parent (encounter)
      metAtGameTime
    }
  }
}
```

- **Only NPCs the player has actually met persist**, and the registry is bounded
  with an eviction/compaction policy (least-recently-met, but never a crew/contact
  with mission memory). Transient embodied bodies are **not** persisted — they are
  reconstructed from substrate aggregates on the next visit.
- Authoritative memory remains the Phase 15 `memoryReferences` discipline
  (inserted once, gameplay-readable); Phase 24 dialogue memory stays flavor-only.
- Every field validates, sanitizes, round-trips, and migrates. The v12→v13
  migration lifts the existing single-crew `byId` into the generalized registry
  without changing Lyra's relationship, mood, memory, or any prior outcome.
- An embodied NPC's existence is **derived** (presence at a venue), never a saved
  fact; reload reconstructs presence from substrate + registry, so it cannot
  duplicate or strand an NPC.

---

## 7. Acceptance criteria

- [ ] The same NPC identity survives `embody → release → embody` and
      `embody → reload → embody`, reconstructed from `(seed, aggregates, events)`,
      with no duplication, loss, or teleport.
- [ ] An embodied NPC can be met and held a Phase 24 conversation at **each**
      venue (surface, station, ship boarding).
- [ ] Embodied count stays within budget in a crowded scene; over-budget NPCs
      demote deterministically by proximity/interest.
- [ ] No embodied NPC advances world time; leaving and returning shows substrate
      (L1) evolution only, never per-body off-screen simulation.
- [ ] Surface placement resolves to in-tolerance terrain via Phase 25 regions
      (never buried/floating); ship/station placement sits at valid anchors.
- [ ] `isNpcPhysicallyPresent` generalizes without changing crew (Lyra) behavior;
      existing Phase 15 crew tests stay green.
- [ ] Met-NPC registry persists bounded relationship/memory; v12→v13 migration
      preserves the existing crew record exactly.
- [ ] Saves at each venue restore coherent presence and relationship state; an
      interrupted/aborted encounter cannot corrupt the registry.
- [ ] Desktop, gamepad, and XR can approach, converse, and leave at each venue.
- [ ] Embodiment/dialogue failure cannot stop flight or rendering.

---

## 8. Explicit exclusions

- **City-scale crowds and procedural settlements** (Phase 27) — this phase proves
  a handful of embodied NPCs per venue, not a populated city.
- **Per-NPC daily schedules, jobs, relationships-between-NPCs** (Phase 28) — an
  embodied NPC stands, talks, and reacts; it does not run a life yet.
- **Bespoke station environment, exterior art, and docking simulation** — the
  station venue reuses an interior shell; full stations are content/split work.
- **Hostile boarding and close-quarters combat** — encounter NPCs here are
  non-hostile presence; combat is Phase 19/22 territory.
- **Final NPC art, animation, faces, and voices** — one placeholder body, static
  idle; placeholder TTS per Phase 24.
- **Recruitment of encounter NPCs into crew** beyond the existing Phase 15 crew
  slot — roster growth is later work.

---

## 9. Decision gates

| Decision | Recommended default |
|---|---|
| Station venue scope | Reuse the boarding/ship interior shell; defer a bespoke station |
| Embodied-NPC budget | Small hard cap per scene; demote by proximity then interest |
| Body representation | One placeholder stand-in mesh shared across venues |
| Encounter persistence | Persist relationship/memory only for met NPCs; bounded, evictable |
| Generalize presence vs. fork | Generalize `isNpcPhysicallyPresent`; do not fork crew |
| Split trigger | If the station shell becomes a real environment, split it into its own phase (one new environment per phase) |

---

## 10. Test ladder mapping

| Level | Phase 26 coverage |
|---|---|
| T0 Static | `node --check` on touched `src/`+`tests/`; `git diff --check` |
| T1 Domain | Embody/release round-trip no-op (with content), budget/selection determinism, generalized presence rule, placement resolution |
| T2 Persistence | v12→v13 migration with an old single-crew fixture, met-NPC registry round trip, eviction/compaction cap, corruption rejection, reset |
| T3 Integration | Embodiment ↔ Phase 23 substrate fold-back; ↔ Phase 24 dialogue at each venue; ↔ Phase 25 surface placement; flight/render isolation on failure |
| T4 Browser | Meet and converse with an embodied NPC at each venue; reload; confirm coherent presence and no duplication |
| T5 Manual | Land → meet a surface NPC; dock → meet a station NPC; boarding → meet a ship NPC; leave/return and verify substrate-driven continuity |
| T6 XR/device | Approach/converse/leave at each venue with gamepad and PCVR |

Randomized tests print their seed on failure; substrate/dialogue use deterministic
fakes.

---

## 11. Debug API (planned)

```js
window.__deepSpaceDebug.npcs.getEmbodied()                       // active L3 NPCs + venue
window.__deepSpaceDebug.npcs.embodyNear('surface')               // force-promote near player
window.__deepSpaceDebug.npcs.release(npcId)                       // demote, fold back
window.__deepSpaceDebug.npcs.getBudget()                          // cap, count, demoted
window.__deepSpaceDebug.npcs.getRegistry()                        // met-NPC persisted records
window.__deepSpaceDebug.npcs.getPlacement(npcId)                  // venue + resolved pose
window.__deepSpaceDebug.npcs.roundTrip(npcId)                     // embody→release→embody assert
```

`getPlanetState()`/venue telemetry gains embodied-NPC count and current venue.

---

## 12. Verification record

To be completed when implemented. Expected commands:

```powershell
node --experimental-default-type=module --test tests/rpg/*.test.mjs
node --experimental-default-type=module --check <each src/test JavaScript file>
git diff --check
```

- T0–T3: pending (the embody/release identity round-trip is the gating test).
- T4–T6: pending owner per-venue normal-control + PCVR verification.

---

## 13. Next action

If accepted, the first implementation step is the **embodiment service and the
generalized NPC contract**, not the station venue. Generalize
`isNpcPhysicallyPresent` and the `npcs` registry, build `embodyNear`/`release`
over the Phase 23 substrate with the identity round-trip test, and prove it on the
**surface** venue first (Phase 25 placement already exists). Add the ship-boarding
and reused-shell station venues only once the round trip and budget are green. Do
not start Phase 27 city crowds until single-venue embodiment is stable.
