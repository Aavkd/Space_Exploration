# Phase 28 — NPC Life Simulation

> **Status:** Proposed design — not started. Final phase of Horizon 5 (The Living
> World). The deferred Phase 23 `simulated` (L2) tier becomes real content: NPCs
> in a city get jobs, daily schedules, hobbies, and relationships that run
> deterministically and stay coherent whether observed or abstracted.
> **Dependencies:** Phase 23 substrate (deterministic clock, L1/L2 tiers,
> aggregates, event log, reversible promotion/demotion), Phase 27 cities (function
> zones, structures, `populationTarget`, stable settlement/structure IDs), Phase
> 26 embodiment (L2→L3 bodies), Phase 24 dialogue (life context feeds
> conversation), Phase 13 active-play `gameTime`.
> **Enables:** Phase 29 authored faction-hub life, and the believable populated
> world the whole vision rests on.
> **Source design:** `rpg-design-vision.md` §4 (NPCs), §7 (simulation),
> `worldbuilding.md` (faction drives), `rpg-future-development-roadmap.md` (Phase
> 28).
> **Last updated:** 2026-06-28.

---

## 1. Why this phase, and the hard problem

A city now exists (Phase 27), its NPCs can stand and talk (Phase 26/24), and the
substrate advances populations as aggregates over play time (Phase 23). The last
missing thing is the one the vision names directly: NPCs that **simulate a life —
job, relationships, hobbies** — and that have *advanced plausibly* when the
player returns, instead of being frozen since they left.

The hard problem is not writing a schedule. It is doing it **without per-agent
off-screen simulation**. The project cannot run thousands of agent schedules
while the player is light-years away, and the locked rules forbid unbounded
catch-up. The solution is an **abstraction boundary** (§3): while the player is
present, agents run a real L2 schedule; while absent, only cheap L1 aggregates
advance, and an agent's "current life" is **reconstructed deterministically** on
return from `(seed, aggregates, events, time-of-day)`.

This phase proves that on **one city**. It does not add city-to-city travel,
crowd-scale agents, or emergent city politics.

---

## 2. The schedule and needs model (centerpiece)

While a city is `embodied`/`simulated` (player present), each agent runs a small,
deterministic schedule driven by needs and a role.

```text
Agent (L2) {
  id,                       // stable: `<settlementId>:agent:<n>`
  entityId,                 // Phase 23 substrate parent (for fold-back)
  role,                     // assigned from a Phase 27 function zone
  needs: { work, rest, social, leisure },   // bounded scalars
  schedule,                 // derived day plan: place + activity per time block
  location,                 // current structure/zone anchor
  relationships,            // edges to other agents (see §4)
}
```

- **Roles come from the city, not thin air.** A market-zone agent is a vendor; a
  civic-zone agent is an administrator; residential anchors are homes. Role
  assignment is deterministic from `(settlementId, agent index, zone mix)`.
- **The schedule is a deterministic function of `(seed, role, time-of-day)`** —
  work block at the workplace, rest at home, social/leisure at gathering zones.
  Needs modulate which optional activity is chosen, bounded so behavior never
  diverges unboundedly.
- **Ticked by the Phase 23 clock at L2**, only while present and only on
  accumulated active-play time. Agents move between Phase 27 structures along the
  city path graph; the player sees a vendor open a stall, walk home at dusk, meet
  others at a gathering place.
- **No agent advances world time.** Only the substrate clock does; agents react
  to it.

---

## 3. The abstraction boundary (the key trick)

This is what makes "leave and return to advanced lives" both cheap and coherent.

| Player state | Tier | What runs |
|---|---|---|
| In the city | L2 `simulated` | Full per-agent schedule/needs/movement |
| Away | L1 `statistical` | Only aggregate deltas: employment, prosperity, social cohesion, population — closed-form per tick |
| Returning | L2 (reconstructed) | Each agent's *current activity* derived from `(seed, role, aggregates, events, time-of-day)` |

Rules (locked, extending Phase 23 §2–3):

1. **Off-screen is L1 only.** Leaving a city demotes its agents to the city's L1
   aggregates (employment rate, prosperity, social cohesion). No per-agent state
   is ticked while away. Catch-up is bounded and uses accumulated play time.
2. **Return reconstructs, it does not replay.** On promotion, each agent's
   present activity is *computed* from the current time-of-day, its role, the
   city aggregates, and any events that touched it — not by simulating the
   intervening days. A vendor seen at the market at dusk, returned-to days later
   at dawn, is plausibly at home opening up — derived, not journaled.
3. **Events are the only durable off-screen change.** Anything that must persist
   across an absence (a relationship formed, a role lost to an economic shift) is
   a Phase 23 event with a stable ID, applied to aggregates; the reconstruction
   reads events, so returns are explainable from history.
4. **Demote→reload→promote is lossless for identity and explainable for state**
   — the Phase 23/26 round trip, now carrying a life.

---

## 4. Relationships

- **Emerge from co-location and events.** Agents who share work/social blocks
  accrue relationship edges; significant interactions (and player actions) emit
  Phase 23 events that adjust them.
- **Traced to event IDs.** Every relationship change references the event that
  caused it; there is no hidden relationship drift.
- **Bounded.** Each agent keeps a capped set of strongest edges; weaker ones
  decay. Relationships the *player* is part of persist via the Phase 26 met-NPC
  registry; agent-to-agent edges live as bounded substrate state.
- **Feeds dialogue.** An agent's role, schedule, mood, and relationships enter the
  Phase 24 read-only context snapshot, so conversation reflects their life — still
  text-only and side-effect free.

---

## 5. Day cycle and time

- One **day cycle** is a fixed span of Phase 13 `gameTime` (short; decision gate),
  advancing only during active play. Time-of-day drives schedules and lighting
  cues.
- Catch-up across an absence is bounded and deterministic; closing the game
  advances no city time (the Phase 13/20/23 rule).
- Randomized choices draw from a seeded stream and print the seed on test
  failure.

---

## 6. Stable IDs and contracts

- **Agent ID:** `<settlementId>:agent:<n>`, deterministic from the Phase 27
  settlement and substrate aggregates; reconstructed identically on return.
- **Role/zone linkage:** roles reference Phase 27 zone/structure IDs (which Phase
  27 guarantees stable), so a schedule always points at a real place.
- **Events:** relationship and role-change events use the Phase 23 event-ID
  contract and feed the same audit/trace path.
- Consumes only public substrate/city/dialogue contracts; reaches into no
  rendering, flight, or persistence internals.

---

## 7. Saved-state contract

The save envelope advances one version (v13→v14, assuming Phase 26 shipped v13),
adding a **bounded social/role layer to the Phase 23 `simulation.world` facet** —
not per-agent schedules.

```text
simulation.world.society: {
  version,
  bySettlementId: {
    <settlementId>: {
      aggregates: { employment, prosperity, socialCohesion, population },
      roleDistribution: { vendor, civic, labor, ... },   // counts, bounded
      relationshipEdges: [{ aId, bId, weight, lastEventSequence }],  // capped
    }
  }
}
```

- **Individual agent schedules and positions are NOT persisted** — they are
  derived on promotion (§3). Only aggregates, role distribution, and capped
  relationship edges (each traceable to an event sequence) are durable.
- Player-involved relationships persist via the Phase 26 met-NPC registry; this
  facet holds the world-side social state.
- Every field validates, sanitizes, round-trips, and migrates. The v13→v14
  migration initializes society aggregates from existing city `populationTarget`
  and substrate state at the saved `gameTime`; it simulates no pre-migration days.
- Relationship-edge and role-distribution sets are bounded with compaction that
  preserves event-trace integrity (consistent with the Phase 20 ledger / Phase 23
  event-log discipline).

---

## 8. Acceptance criteria

- [ ] A seeded day reproduces the same schedule history for the same city while
      present; randomized choices are seed-stable.
- [ ] Agents move between Phase 27 zones/structures on a role-appropriate daily
      schedule the player can observe (work, home, social/leisure).
- [ ] **Leave-and-return shows advanced-but-coherent lives** — agents are at
      plausible current activities reconstructed from `(seed, role, aggregates,
      events, time-of-day)`, with no duplication, loss, or teleport, and **no
      per-agent off-screen simulation occurred**.
- [ ] Off-screen change is L1 only; catch-up is bounded and uses accumulated play
      time; closing the game advances no city time.
- [ ] Relationship and role changes trace to Phase 23 event IDs and survive
      reload; there is no untraced relationship drift.
- [ ] L2 agent count per city stays within the documented budget; demotion to L1
      is lossless for aggregate purposes and reconstruction is deterministic.
- [ ] An agent's life (role, schedule, relationships) feeds the Phase 24 dialogue
      context without letting the LLM change any of it.
- [ ] v13→v14 migration preserves prior city/substrate/NPC state; society state
      round-trips, compacts within bounds, and rejects forged/forward blobs.
- [ ] A long seeded soak keeps employment/prosperity/cohesion/population and
      relationship-edge counts finite and bounded.
- [ ] Existing Phase 23/26/27 tests stay green; life-sim failure cannot stop
      flight or rendering.

---

## 9. Explicit exclusions

- **Crowd-scale agents** — a budgeted L2 set per city, not thousands embodied.
- **City-to-city travel, migration journeys, and intra-/inter-city traffic.**
- **Emergent city politics, governance, factions-within-a-city** — city-level
  political dynamics live at the Phase 23 faction-substrate level, not per-agent
  here.
- **Reproduction, aging, birth/death pipelines at scale** — agents are derived
  from aggregates; demographic turnover is an L1 aggregate effect, not a per-agent
  lifecycle this phase.
- **Romance, crime, full social-AI planning, or needs-driven emergent narrative
  beyond the bounded model.**
- **Per-agent persistent journals** — lives are reconstructed, not logged;
  durable facts are events and bounded aggregates only.
- **Final NPC art, animation, and barks** — placeholder bodies/idles and Phase 24
  text continue.

---

## 10. Decision gates

| Decision | Recommended default |
|---|---|
| Day-cycle length | Short fixed `gameTime` span; tune for observable routine without grind |
| L2 agent budget per city | Small hard cap; reconstruct the rest as aggregate-only background |
| Needs-model depth | Four bounded needs (work/rest/social/leisure); no deep planner |
| Off-screen model | L1 aggregates only; reconstruct on return; never per-agent catch-up |
| Relationship scope | Capped edges per agent, event-traced; player edges via Phase 26 registry |
| Demographics | Aggregate-level turnover only; no per-agent birth/death this phase |
| Persistence | Society aggregates + capped edges under the Phase 23 facet (v13→v14); no agent schedules saved |

---

## 11. Test ladder mapping

| Level | Phase 28 coverage |
|---|---|
| T0 Static | `node --check` on touched `src/`+`tests/`; `git diff --check` |
| T1 Domain | Schedule determinism (seed+role+time → plan), needs modulation bounds, role assignment from zones, relationship-edge math, reconstruction determinism |
| T2 Persistence | v13→v14 migration with an old city/substrate fixture, society round trip, edge/role compaction within bounds, corruption/forgery rejection, reset |
| T3 Integration | L2 schedule ↔ Phase 27 zones; demote→L1→reconstruct equivalence; relationship events ↔ Phase 23 log; life context ↔ Phase 24 (LLM cannot mutate); flight/render isolation |
| T4 Browser | Spend a day in a city; observe routines; leave and return; confirm coherent reconstructed lives and no duplication |
| T5 Manual | Watch a vendor's day; leave for a long trip; return at a different time-of-day and verify plausible current activity + persisted relationships |
| T6 XR/device | Sustained in-city day-cycle pass holds comfort/perf on PCVR |

Long seeded soak tests assert population/role/relationship invariants stay
bounded; randomized tests print their seed on failure.

---

## 12. Debug API (planned)

```js
window.__deepSpaceDebug.life.getAgents(settlementId)             // active L2 agents + role + activity
window.__deepSpaceDebug.life.getSchedule(agentId)                // derived day plan
window.__deepSpaceDebug.life.getSociety(settlementId)            // aggregates, role distribution, edges
window.__deepSpaceDebug.life.advanceDays(n)                      // bounded play-time catch-up (test)
window.__deepSpaceDebug.life.leaveAndReturn(settlementId, atGameTime)  // reconstruction assert
window.__deepSpaceDebug.life.getRelationships(agentId)
window.__deepSpaceDebug.life.getBudget()                         // L2 cap, count, demoted
```

`getPlanetState()`/city telemetry gains active agent count, day-of-cycle, and
time-of-day.

---

## 13. Verification record

To be completed when implemented. Expected commands:

```powershell
node --experimental-default-type=module --test tests/rpg/*.test.mjs
node --experimental-default-type=module --check <each src/test JavaScript file>
git diff --check
```

- T0–T3: pending (schedule determinism + leave/return reconstruction are the
  gating tests).
- T4–T6: pending owner in-city day-cycle + PCVR verification.

---

## 14. Next action

If accepted, the first implementation step is the **schedule/needs model and the
abstraction boundary**, not relationships. Build deterministic role assignment
over Phase 27 zones, the `(seed, role, time-of-day)` schedule, and the
demote-to-L1 / reconstruct-on-return path, and prove leave-and-return coherence
with no per-agent off-screen simulation. Add relationship edges and their event
tracing only once reconstruction is green. This completes Horizon 5; the Phase 29
content program then populates the ten-system network with this living-world
stack.
