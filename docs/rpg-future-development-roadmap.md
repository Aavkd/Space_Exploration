# Deep Space VR - Future RPG Development Roadmap

> **Status:** Proposed execution roadmap after the validated Phase 11 RPG slice.
> **Last updated:** 2026-06-28.
> **Sources:** `rpg-design-vision.md`, `worldbuilding.md`,
> `phase-11-rpg-roadmap.md`, and `phase-12-radio-transceiver.md`.
> **Agent prompts:** `rpg-phase-agent-prompts.md`.

## Purpose

Turn the RPG vision into playable, testable vertical slices. Every phase must
leave the game releasable, preserve what already works, and prove one new
category of risk before later work depends on it.

This roadmap separates foundation work, small proof slices, system expansion,
and content expansion. No phase attempts to finish an entire pillar such as
combat, economy, or autonomous simulation in one pass.

## Numbering Assumption

The existing radio transceiver is treated as the official **Phase 12**:

- Phase 12A, the physical radio console and CRT UI, is implemented.
- Phase 12B, custom local stations, remains optional backlog.
- Phase 12C, proximity signals, can later feed exploration missions.

RPG expansion resumes at **Phase 13**. If radio is intended to remain an
unnumbered side feature, the labels can shift without changing dependencies.

## Locked Engineering Rules

1. Deterministic authored systems own missions, inventory, credits, reputation,
   damage, access, NPC state, and simulation outcomes. LLM output never does.
2. Every phase produces a loop the player can start, finish or fail, save,
   reload, reset, and inspect.
3. A phase should introduce only one major unproven real-time risk.
4. Simulation time advances only while an active game is running.
5. Player-facing RPG systems have a physical location. Debug UI may bypass it.
6. Raising the save version requires migration code, an old-save fixture, and
   an automated migration test.
7. Optional RPG, voice, and simulation failures must not stop flight/rendering.
8. Content consumes public system contracts and never reaches into rendering,
   flight, or persistence internals.
9. Placeholder names, art, avatars, and audio are valid unless they are the risk
   under test.
10. Discoveries outside current acceptance criteria go to follow-up backlog.

## Shared Definition Of Done

A phase is complete only when all applicable gates pass.

### Implementation

- Public state/runtime contracts and stable IDs are documented.
- New state has defaults, validation, sanitization, and debug inspection.
- Unknown IDs and illegal transitions produce descriptive errors.
- Optional dependencies have a fallback or visible unavailable state.
- Explicit exclusions and known limitations are recorded.

### Automated verification

- Static/syntax checks pass for touched code.
- State transitions and failure paths have deterministic tests.
- Every saved field has round-trip and migration coverage.
- At least one browser smoke test covers the player-facing path.
- Existing Phase 11 tests remain green.
- Tests run from one documented command and in CI.

### Playability

- The clean-save loop is completable with normal controls and no debug shortcut.
- Reloading at each important checkpoint restores coherent state.
- Success plus failure/decline paths are checked where applicable.
- The feature can be reset without clearing unrelated browser data.

### Compatibility

- Flight, walking, landing, scale transitions, hyperdrive, audio, and existing
  cockpit stations still work.
- Keyboard/mouse and gamepad paths are checked.
- Changed physical interactions receive PCVR/WebXR signoff.
- Performance-sensitive phases define and meet a repeatable scene budget.

### Documentation

- The phase document contains a manual checklist and verification record.
- Debug APIs, save changes, test commands, and content IDs are documented.
- This roadmap is updated before starting the next dependent phase.

## Test Ladder

| Level | Purpose | Required use |
|---|---|---|
| T0 - Static | Syntax, imports, data validation | Every change |
| T1 - Domain | State machines and calculations | Every RPG system |
| T2 - Persistence | Round trip, migration, corruption, reset | Every saved field |
| T3 - Integration | Runtime-to-UI/flight/world boundaries | Every vertical slice |
| T4 - Browser | DOM, input, audio, renderer, reload | Every phase |
| T5 - Manual | Full normal-control player loop | Every phase |
| T6 - XR/device | Interaction and sustained headset behavior | Physical/UI/FX changes |

Randomized tests use an explicit seed and print it on failure. Time-dependent
tests use an injected clock. Network and LLM tests use deterministic fakes;
live-provider checks are optional manual tests.

## Roadmap At A Glance

| Phase | Playable proof | Main risk retired | Depends on |
|---|---|---|---|
| 12 | Radio and discoverable signal | Physical audio console | Existing work |
| 13 | Ship log, save slots, play-time clock | Durable evolving state | 11 |
| 14 | Two-system cargo delivery | Inventory, fuel, reward, objective chain | 13 |
| 15 | One persistent crew member | Physical NPC and hybrid dialogue boundary | 13 |
| 16 | One surface outpost mission | Seeded POI and surface NPC placement | 13 |
| 17 | Reputation-sensitive patrol | Faction space and local agents | 14 |
| 18 | Salvage, damage, repair | Ship-as-character-sheet state | 14, 17 |
| 19 | One ship combat encounter | Weapons, targeting, enemy tactics | 18 |
| 20 | Three-market trade loop | Dynamic economy | 14, 17 |
| 21 | EVA to one derelict | Untethered EVA and boarding transfer | 18 |
| 22 | One hostile surface site | Surface combat | 16, 18 |
| 23 | Three-faction autonomous simulation (substrate + LOD) | Headless deterministic tick and simulation-LOD contract | 17, 20 |
| 24 | Live NPC conversation | Hybrid authored + live-LLM dialogue, state-safe at real cost/latency | 15 |
| 25 | Region/continent layer + biome depth | Deterministic placement substrate; ground-cover/water budget | 16 |
| 26 | NPCs on surface, station, and ship | Cross-venue NPC presence and L2→L3 embodiment | 23, 24 |
| 27 | One procedural city | Settlement layout by tier, faction, and biome | 25, 26 |
| 28 | A city that lives | NPC life-sim: jobs, relationships, schedules | 23, 27 |
| 29 | Ten-system MVP content program | Content pipeline and breadth | Proven systems |
| 30 | Qualify for ascension | Knowledge and Tier 4 traces | 23, 29 |
| 31 | Ascend and indirectly influence | Phase transition and legacy | 30 |
| 32 | Direct manifestation | Focused Tier 4 powers | 31 |
| 33 | Cosmic construction/destruction | Procedural-universe mutation | 31, 32 |
| 34 | Tier 4 politics | Sustained post-ascension simulation | 23, 31-33 |

> **Reweighted 2026-06-28.** The vision centers a *living procedural world* —
> talk-to-every-NPC dialogue, biomes, cities, and NPCs with lives — over the
> ascension ceiling. Horizon 5 (the living world, phases 24–28) now precedes the
> content program and ascension. Ascension remains the endgame but is built last.
> All five living-world phases consume the Phase 23 simulation substrate and its
> LOD contract.

## Horizon 1 - Make The World Durable

### Phase 12 - Radio And Signal Bridge

**Status:** Phase 12A is implemented. Phase 12B-C are independent backlog.

Phase 12C is worth completing when a mission needs discoverable signals. Its
proof loop is tuning a nearby celestial signal, following signal strength, and
identifying its source.

Acceptance:

- Signals have stable IDs, source, frequency, range, and deterministic strength.
- Audio crossfades without duplicate loops and stops on power-off/scale change.
- One signal is discoverable with normal controls and no teleport.
- Radio failure cannot break or silence the main audio mix.

Phase 12B custom music does not block the RPG roadmap.

### Phase 13 - Ship Log, Save Slots, And Simulation Clock

**Status:** Complete; automated, desktop-browser, and owner-performed
normal-control/device validation are recorded in
[`phase-13-save-slots-and-clock.md`](phase-13-save-slots-and-clock.md).

**Objective:** establish the durable state envelope before more systems write
incompatible data.

**Proof loop:** use a physical ship computer to inspect RPG history, create or
select a slot, export it, change state, and restore/import the earlier state.

Deliverables:

- Ship-computer/codex interaction using an existing or placeholder anchor.
- Versioned save envelope separating player, ship, RPG, simulation, and settings.
- At least three local slots with new/load/delete and an autosave policy.
- Validated JSON export/import with preview before overwrite.
- Monotonic `gameTime` that advances only during active play.
- Event-log query and compaction/retention policy.
- CI workflow for the app regression suite.
- Migration from the current Phase 11 version-1 state.

Acceptance:

- A Phase 11 save migrates without changing mission, reputation, contact, event,
  or world-flag outcomes.
- Slots cannot overwrite or delete one another accidentally.
- Corrupt/future imports are rejected without changing the active save.
- Closing the browser adds no game time; pause/focus cannot create a time jump.
- The ship log shows `A Clean Copy` and its chosen outcome after migration.
- Storage failure remains visible but cannot break flight.
- CI passes from a clean checkout.

Out of scope: cloud sync, economy ticks, NPC schedules, and polished codex lore.

Decision gate: autosave points and whether import always creates a new slot.

## Horizon 2 - Prove Everyday RPG Life

### Phase 14 - Cargo, Fuel, And Two-System Delivery

**Status:** Complete; automated, Chromium-browser, and owner-performed
normal-control/gamepad/WebXR validation are recorded in
[`phase-14-cargo-fuel-delivery.md`](phase-14-cargo-fuel-delivery.md).

**Objective:** prove a multi-step job that carries state through travel, consumes
a resource, and pays a persistent reward.

**Proof loop:** accept cargo at Port Meridian, load it at the cargo terminal,
jump to a second authored system, deliver it, and receive credits/reputation.

Deliverables:

- Cargo definitions with stable ID, mass, quantity, and legality tags.
- Credits, fuel, cargo capacity, and a physical cargo interaction.
- A second authored system anchor and contact.
- Mission objectives separated from mission lifecycle state.
- Hyperdrive fuel formula plus reserve/recovery rule.
- Static refuel prices and mission rewards.

Acceptance:

- Cargo cannot be delivered before acceptance and loading.
- Capacity and insufficient-fuel states are enforced and explained.
- The clean proof route cannot permanently strand the player.
- Jump fuel cost is deterministic across reload.
- Delivery removes only required cargo and pays exactly once.
- Abandon, loss, duplicate delivery, full cargo, and low-fuel paths have tests.
- Saves before pickup, in transit, and after delivery restore correctly.
- The Phase 11 mission remains unchanged.

Out of scope: dynamic markets, general trade, contraband scans, NPC ships, and
docking simulation.

### Phase 15 - Persistent Crew Foundation

**Objective:** prove one ship-resident NPC whose presence and reactions follow
authoritative game state.

**Proof loop:** meet one crew member, discuss the delivery outcome, make one
relationship choice, leave/reload, and receive a changed contextual response.

Deliverables:

- Shared NPC contract for crew, contacts, and future encounters.
- One crew member with placeholder physical avatar and stable ship anchor.
- Presence, location, relationship, mood, memory reference, alive, and recruited
  state.
- Authored beats selected from mission, ship, and faction context.
- Optional LLM/voice adapter receiving a read-only context snapshot.
- Explicit offline, connecting, listening, responding, interrupted, and failed
  interaction states.

Acceptance:

- The NPC is present only when their state says they are aboard and alive.
- Relationship/memory changes persist and never duplicate.
- Mission-critical interaction works with the voice service offline.
- LLM text cannot invent rewards, completion, cargo, damage, or reputation.
- Malformed, late, and disconnected voice responses are ignored safely.
- Desktop, gamepad, and XR can start, interrupt, exit, and reopen interaction.
- The NPC reacts differently to both `A Clean Copy` branches.

Out of scope: roster recruitment, schedules, combat, death, and final animation.

Decision gate: provisional crew cap and whether the first avatar is a stand-in.

### Phase 16 - Surface Outpost Vertical Slice

**Status:** Complete; deterministic, migration, checkpoint, exclusion, browser,
normal-control, gamepad, and WebXR evidence is recorded in
[`phase-16-surface-outpost.md`](phase-16-surface-outpost.md).

**Objective:** connect orbit, landing, walking, a surface interaction, and a
mission objective on one authored planet.

**Proof loop:** scan a planet, select an outpost, land, walk to it, interact,
return to the ship, and report completion.

Acceptance:

- POI definition and placement are deterministic from named-system/planet data.
- Its marker works across orbit, descent, landing, and walking scales.
- The interaction point stays within tolerance of terrain, never buried/floating.
- The player can land, disembark, complete, return, board, and leave.
- Saves in orbit, landed, and after interaction restore valid state.
- Gas giants and unrelated planets receive no invalid surface POI.
- Existing landing/surface-EVA tests remain green.

Out of scope: procedural settlements, combat, crowds, interiors, and markets.

## Horizon 3 - Add Pressure And Consequence

### Phase 17 - Faction Territory And Patrol

**Status:** Implementation complete with 46 passing RPG regressions and an
owner-verified core browser loop. Extended manual policy/device checks remain
open before final phase signoff; see
[`phase-17-faction-patrol.md`](phase-17-faction-patrol.md).

**Proof loop:** enter Commonwealth space and be welcomed, inspected, warned, or
refused by one patrol according to reputation and cargo.

Acceptance:

- Faction influence is a deterministic query over location/state.
- One patrol supports spawn, approach, hail, wait, depart, and abort.
- Positive, neutral, negative, ignored-hail, and contraband paths are tested.
- Reputation thresholds do not flap at their boundaries.
- Patrols do not duplicate across reload or scale transition.
- The encounter cannot trap the player in UI or force combat in this phase.

### Phase 18 - Ship Condition, Hazard, Salvage, And Repair

**Status:** Implementation and T0–T4 verification complete with 53 passing RPG
regressions and a normal-control Chromium terminal smoke. The full travel-loop
manual pass and gamepad/PCVR device signoff remain open; see
[`phase-18-ship-condition.md`](phase-18-ship-condition.md).

**Proof loop:** investigate a derelict/hazard, suffer system damage, recover
parts, and repair at a physical ship station.

Acceptance:

- Hull and system condition have validated ranges and capability effects.
- Damage and repair persist; repair consumes the correct item exactly once.
- Salvage cannot duplicate through reload/re-entry.
- Degraded effects are bounded and observable.
- A recovery rule prevents an unrecoverable proof-slice save.
- Flight remains controllable in every condition reachable in this phase.

### Phase 19 - Ship Combat Foundation

**Status:** Implementation and T0–T3 automated verification in progress.
Browser normal-control, full manual checkpoint,
gamepad, PCVR, and sustained render-performance signoff remain open; see
[`phase-19-ship-combat.md`](phase-19-ship-combat.md).

**Proof loop:** detect one hostile, target it, fight or disengage, survive
persistent damage, and salvage/report the outcome.

The K-7 raider appears on entry, transmits after 10 active-play seconds, and
cannot attack during the following 5-second grace. Player combat mode is an
independent weapons control, not an encounter spawn/despawn switch.

Acceptance:

- Weapons, cooldown/heat, target lock, range/lead, hits, and system damage share
  documented deterministic contracts.
- One Tier 2 enemy can pursue, attack, retreat, and be destroyed.
- The encounter can be won and escaped with normal controls.
- Destroyed enemies do not respawn as if nothing happened.
- Escape cleans targets, projectiles, agents, and combat audio.
- Damage integrates with Phase 18 repair.
- Desktop, gamepad, PCVR, and a written frame-time budget pass.

Out of scope: fleets, capital ships, Tier 3 weapons, and boarding.

### Phase 20 - Dynamic Economy And Trade

**Status:** Implementation and T0–T3 automated verification complete with 74
passing RPG regressions and a live Chromium render/runtime smoke. The physical
terminal route, checkpoint checklist, gamepad, and PCVR/WebXR signoff remain
open. The authored-POI allocator now reserves all three market destinations in
the eight-row cockpit navigation list after Wayfarer was found to be clipped;
see [`phase-20-dynamic-economy.md`](phase-20-dynamic-economy.md).

**Proof loop:** inspect three markets, move a good from surplus to shortage,
profit, and observe supply/price response.

Acceptance:

- Market stock, production/consumption, and bounded price calculations are seeded.
- Economy ticks use Phase 13 play time and never run while closed.
- Buy/sell atomically updates credits, cargo, and stock.
- Rounding cannot create money; long runs stay finite and bounded.
- Save/reload mid-transaction is wholly before or wholly after.
- Contraband values feed Phase 17 patrol policy.

## Horizon 4 - Broaden Action And Autonomy

### Phase 21 - Untethered EVA And Derelict Boarding

**Status:** Implementation and T0–T3 automated verification complete with 83
passing RPG regressions and 112 source files passing syntax checks. Owner-
performed Chromium normal-control, checkpoint, gamepad, and PCVR/WebXR signoff
remains open, so the phase is partial; see
[`phase-21-eva-boarding.md`](phase-21-eva-boarding.md).

**Proof loop:** secure the ship near a derelict, EVA across, enter, recover one
item/log, and return.

Acceptance:

- Relative frames remain stable within documented movement limits.
- Oxygen/range/return feedback and recovery are clear and tested.
- Transfers cannot duplicate/lose the player, ship, or target.
- Saves outside, inside, and after return restore correctly.
- Loot cannot be collected twice.
- VR comfort and locomotion receive explicit signoff.

Hostile boarding and close-quarters combat remain out of scope.

### Phase 22 - Hostile Surface Site

**Status:** Implementation and T0–T3 automated verification complete with
100 passing RPG regressions and 130 source/test modules passing syntax checks.
Owner-performed browser normal-control, gamepad, and PCVR/WebXR comfort and
performance signoff remains open, so the phase is partial; see
[`phase-22-surface-combat.md`](phase-22-surface-combat.md).

**Proof loop:** approach one hostile POI, evade or engage, resolve a small
encounter, recover the objective, and return.

The separate `K-7 Black Cache` site uses the Phase 16 terrain sampler for
placement, collision, and LOS. One sentry and one heat/cooldown pulse carbine
support equal-reward `evaded` and `combat_resolved` routes. Suit defeat returns
the player safely aboard and leaves the mission retryable.

Acceptance:

- One weapon, enemy, cover/line-of-sight model, defeat, and recovery form a loop.
- Spawns cannot intersect terrain, structures, player, or ship.
- Leaving/reloading cannot duplicate enemies or rewards.
- Mission state distinguishes authored evasion, defeat, and combat outcomes.
- Desktop and VR aiming, comfort, feedback, and performance pass.

### Phase 23 - Autonomous World Simulation (Simulation Substrate)

**Status:** Design locked; see
[`phase-23-autonomous-simulation.md`](phase-23-autonomous-simulation.md).
This is the architecture-defining phase: its deliverable is the **simulation
substrate and its level-of-detail (LOD) contract**, not the three factions. The
factions are the test fixture; the substrate (`dormant → statistical →
simulated → embodied`, plus a headless deterministic tick) is what every later
plural-scale element reuses — crowds, populated cities, tier fluidity, the
post-ascension god-view, and cosmic mutation.

**Proof loop:** observe three factions pursue agendas over play time, receive a
report of a political/economic change, intervene, and see a different outcome.

Deliverables include a renderer-decoupled pure simulation tick
(`simCore.step({state, fromGameTime, toGameTime, seed, commands}) ->
{state, events}`), the four-tier simulation-LOD contract with deterministic
reversible promotion/demotion, a seeded scheduler, stable event IDs, faction
resources, behavioral drives, agendas, relationship matrix, event
prerequisites/effects, and one tier-transition proof.

**Locked design decision:** the Phase 20 economy is re-parented under the new
`simulation.world` facet (save envelope v10→v11) as the L1 economic projection,
and Phase 17 territory becomes a projection of the substrate rather than an
independent owner. Existing economy/territory IDs, contracts, and tests are
preserved.

Acceptance:

- Seed plus command sequence reproduces the same event history.
- The simulation core has no renderer/DOM/audio/`three` import (worker/WASM/
  server move is later and mechanical).
- LOD promotion L1→L2→L1 with no intervening sim is a verified no-op; demote→
  reload→promote reconstructs equivalent state from `(seed, aggregates, events)`.
- Catch-up is bounded and uses only accumulated play time.
- Invalidated events cancel/transform without corrupting successors.
- Territory, market, patrol, and relationship changes trace to event IDs.
- Intervention changes an input rather than selecting a scripted result.
- Long seeded soak tests preserve numeric/population invariants.
- Three factions behave distinctly from their authored drive seeds.

## Horizon 5 - The Living World

This horizon delivers the parts of the vision the earlier roadmap deferred:
talking to NPCs naturally, surfaces worth standing on, cities, and NPCs with
lives. Every phase here consumes the Phase 23 simulation substrate and its LOD
contract (`dormant → statistical → simulated → embodied`); none of them reaches
into rendering, flight, or persistence internals. The hard rule that LLM output
never owns state (combat, economy, missions, reputation, world state) holds
throughout.

### Phase 24 - Hybrid Dialogue System (Authored Beats + Live LLM)

**Status:** Design locked; see
[`phase-24-hybrid-dialogue.md`](phase-24-hybrid-dialogue.md).

**Objective:** turn "interact naturally with every NPC" from a stub into a real,
state-safe conversation layer, proven end-to-end against one live NPC at real
cost and latency. This is the central mid-term promise and every later NPC venue
depends on it, so it is built early — directly on the Phase 15 crew/NPC contract.

**Proof loop:** approach one NPC, hold a free-text conversation that mixes
authored mission-critical beats with open LLM responses, and confirm the LLM can
discuss anything but can never change game state.

Deliverables:

- A dialogue runtime over the shared NPC contract: authored beats take priority,
  interrupt, and redirect; open turns route to the Phase 09 voice/LLM service.
- A read-only context snapshot (NPC memory, mood, faction, current world facts)
  passed to the LLM; a strict output contract that is text-only and side-effect
  free.
- An intent/▸"the player asked for X" recognizer that maps to *authored*
  deterministic actions when a beat exists; otherwise stays conversational.
- LOD-aware model routing: cheap/local model (or canned lines) for ambient and
  `statistical`-tier crowds, the strong model only for the active conversation,
  with caching keyed on NPC memory state to bound cost.
- Explicit offline/connecting/listening/responding/interrupted/failed states and
  a deterministic text fallback that satisfies acceptance with the service down.

Acceptance:

- A mission-critical exchange completes with the voice/LLM service offline.
- LLM text can never invent rewards, completion, cargo, damage, reputation, or
  world changes; a fuzz/adversarial test proves injected "do X" output is inert.
- Authored beats deterministically win over open dialogue where both apply.
- Per-turn token cost and latency are measured and bounded by the LOD routing.
- Malformed, late, and disconnected responses are ignored safely.
- Desktop, gamepad, and XR can start, interrupt, exit, and reopen a conversation.

Out of scope: many simultaneous live conversations, NPC-to-NPC dialogue, and
voice synthesis quality bar (placeholder TTS is acceptable).

Decision gate: model tiering per NPC LOD, and the per-session/per-day LLM budget.

### Phase 25 - Biomes And Regions (Planet-Gen Depth)

**Status:** Design locked; see
[`phase-25-biomes-and-regions.md`](phase-25-biomes-and-regions.md).

**Objective:** per-point biome *classification* already ships
(`PlanetSurfaceModel.sampleAt` → biome/material/moisture/temperature, six
guaranteed archetypes). This phase adds the two things that are actually missing:
a **region/continent aggregation layer** with stable, queryable IDs (the
placement substrate cities and POIs sit on), and **biome depth** (ground cover,
water plane, weather hooks) so surfaces read as places. Valuable on its own as an
exploration/visual upgrade; no dependency on the Phase 23 substrate.

**Proof loop:** descend onto a planet, traverse two or more visibly distinct
regions/biomes whose boundaries are deterministic and reproducible on re-entry,
then resolve a `findRegions` candidate to coherent ground for placement.

Deliverables:

- A deterministic region map computed from a fixed low-res lattice of the
  existing `sampleAt` field (connected land → continents, dominant-biome zones →
  regions), independent of tile streaming/LOD: `regionAt(dir) → regionId`,
  `getRegions()`, `findRegions({biome,kind,minArea})`, stable
  `region:<planetSeed>:<n>` IDs.
- Biome depth within the existing tile budget: instanced (visual-only) ground
  cover that streams/disposes with its tile, a sea-level water plane with flat
  collision, and per-region weather *descriptors* (not simulation).
- Reuse of the streaming/LRU pipeline and the shipped surface model; no new
  precision regime, no shader-only height.

Acceptance:

- `regionAt` agrees with `sampleAt` biome at the same `dir`; region map is a pure
  function of planet seed with deterministically ordered, stable IDs.
- Region identity is independent of streaming/LOD and reproduces on re-entry.
- Region/biome boundaries do not flicker across LOD; the orbital silhouette is
  unchanged; ground cover never alters `heightAt`/collision.
- `findRegions` candidates resolve to in-tolerance terrain (never buried/floating)
  via a placement smoke reusing the Phase 16 marker discipline.
- A low-altitude pass with cover/water enabled holds the documented frame budget;
  gas giants and non-landable bodies are unaffected.

Out of scope: full hydrology, climate/weather simulation, fauna, vegetation
simulation, destructible/persistent terrain, and content placement itself (the
phase provides the substrate and helper only). No save-envelope bump — everything
is seed-derived.

Decision gate: region lattice resolution (not tied to render LOD), freezing the
existing biome taxonomy as stable IDs, and the ground-cover budget.

### Phase 26 - NPC Presence And Encounter Layer

**Status:** Design locked; see
[`phase-26-npc-presence.md`](phase-26-npc-presence.md).

**Objective:** make NPCs appear and be interactable across all three venues the
vision names — **surface, station, and ship** — by promoting substrate entities
through the LOD tiers into embodied, conversational agents. This is the first
real exercise of the Phase 23 `simulated → embodied` (L2→L3) boundary with
content, and it leans on Phase 24 for interaction.

**Proof loop:** encounter an NPC at a surface POI, a docked station, and aboard
during a boarding event; talk to each via the Phase 24 system; leave and return
and find their state coherent.

Deliverables:

- An instantiation service that promotes a `statistical`/`simulated` substrate
  entity into an embodied NPC near the player and demotes it on departure,
  folding changed state back to aggregates (the §23 reversible round trip).
- A placeholder embodied NPC representation reused across venues (surface walker,
  station resident, ship-boarder) sharing one NPC contract.
- A minimal station docking + interior venue (or reuse of an existing interior
  shell) so stations are a real interaction place, not just a map node.
- Hard caps on embodied NPC count with proximity/interest selection.

Acceptance:

- The same NPC identity survives demote→reload→promote without duplication or
  loss, reconstructed from `(seed, aggregates, events)`.
- Embodied count stays within budget under a crowded scene; over-budget entities
  demote deterministically.
- Each venue can start, run, and exit a Phase 24 conversation.
- No embodied NPC advances world time on its own; off-screen evolution is L1 only.
- Saves at each venue restore coherent presence and relationship state.

Out of scope: full city crowds (Phase 27), per-NPC daily schedules (Phase 28),
and hostile boarding combat.

Decision gate: station venue scope (new interior vs. reused shell) and the
embodied-NPC budget.

### Phase 27 - Procedural Settlements And Cities

**Status:** Design locked; see
[`phase-27-procedural-cities.md`](phase-27-procedural-cities.md).

**Objective:** generate one settlement/city deterministically, with **layout and
character driven by civ tier, controlling faction, and biome**, placed on a
Phase 25 region. The container that Phase 28 fills with life.

**Proof loop:** approach a flagged region, see a settlement signposted from
orbit, land, and walk a coherent generated layout (paths, structures, function
zones) appropriate to its tier and faction.

Deliverables:

- A settlement generator keyed on `(planet seed, region, civTier, factionId)`
  producing a deterministic layout: footprint, road/path graph, structure
  placement, and function zones (market, residential, civic, industry).
- Tier/faction style parameters (e.g. Commonwealth "lived-in warm" vs. Company
  of Doom "deliberately archaic") expressed as generation params, not bespoke art.
- Terrain-conformant placement using `heightAt`/`biomeAt`; nothing buried or
  floating; signposting from orbit (Phase 16 marker discipline).
- Instantiation as a substrate `simulated`/`embodied` cluster (player-pull: full
  detail only when landed/near; statistical otherwise).

Acceptance:

- Layout is deterministic and reproducible on re-entry from seed alone.
- Structures and paths conform to terrain and biome within tolerance.
- A clearly different tier/faction seed yields a visibly different city.
- Generation and streaming hold the frame budget on approach and on foot.
- Save/reload while in the city restores the same layout and placed NPCs.

Out of scope: building interiors at scale (one or two enterable shells only),
city-wide combat, and economy ownership of every structure.

Decision gate: city size cap and how many structure interiors are enterable.

### Phase 28 - NPC Life Simulation

**Status:** Design locked; see
[`phase-28-npc-life-simulation.md`](phase-28-npc-life-simulation.md).

**Objective:** make a city's NPCs *live* — the deferred Phase 23 `simulated` (L2)
tier becomes real content: jobs, relationships, hobbies, and daily schedules that
run deterministically and stay coherent whether observed or abstracted.

**Proof loop:** spend time in one city across a day cycle; watch NPCs go to work,
move between places, and interact; leave for a long trip and return to find their
lives have advanced plausibly (via the cheap L1 abstraction), not frozen.

Deliverables:

- An agent schedule/needs model (work, rest, social, leisure) ticked by the
  Phase 23 deterministic clock at L2 while embodied, and folded into L1
  aggregates when the player leaves (no per-agent off-screen simulation).
- Relationship state between NPCs that emerges from co-location and events, traced
  to substrate event IDs.
- Role assignment from settlement function zones (a market NPC works the market).
- Promotion/demotion that reconstructs an agent's plausible "current activity"
  from `(seed, aggregates, events, time-of-day)` rather than stored detail.

Acceptance:

- A seeded day reproduces the same schedule history; injected time advances are
  bounded and use accumulated play time only.
- Leave-and-return shows advanced-but-coherent lives with no agent duplication,
  loss, or teleport.
- Relationship/role changes trace to events and survive reload.
- L2 agent count per city stays within the documented budget; demotion to L1 is
  lossless for aggregate purposes.
- A long seeded soak keeps population/role/relationship invariants bounded.

Out of scope: full social AI, NPC reproduction/aging at scale, and emergent
politics within a single city (that lives at the faction substrate level).

Decision gate: day-cycle length, L2 agent budget per city, and needs-model depth.

## Horizon 6 - Scale Content Safely

### Phase 29 - Ten-System MVP Content Program

This is a sequence of independently shippable content batches, not one dump. It
now lands *after* the living-world systems exist, so each authored system can use
real dialogue, biomes, cities, and NPC lives rather than placeholders.

**29A - Authoring pipeline:** validate systems, planets, POIs, NPCs, dialogue,
missions, markets, signals, localization keys, references, and reachability.

**29B - Tier 2 network:** complete the six faction hubs in small batches. Each
has a distinct role/landmark, at least two persistent NPCs, one multi-step
thread, and observable favorable and hostile consequences.

**29C - Civilization extremes:** add the Tier 3 enclave, Tier 0 world, deep-void
trace, and Threshold. Each proves a distinct interaction—not a reskinned market.

Every authored system must have deterministic placement, reachable entry/exit
and recovery, valid references, save checkpoints, content-only tests, a manual
playthrough, and a performance spot check.

Content starts earlier rather than waiting for Phase 29:

| Phase | Minimum proof content |
|---|---|
| 14 | Second system/contact and delivery |
| 15 | One crew member |
| 16 | One planet/outpost/surface interaction |
| 17 | One patrol policy |
| 18 | One hazard and derelict |
| 19 | One hostile ship |
| 20 | Three markets |
| 21 | One boardable interior |
| 22 | One hostile POI |
| 23 | Three faction drive sets |
| 24 | One fully conversational NPC |
| 25 | One planet with named regions and two biomes |
| 26 | One NPC per venue (surface, station, ship) |
| 27 | One procedural city |
| 28 | One city that lives across a day |

## Horizon 7 - Ascension

### Phase 30 - Ascension Precursor

Discover a Tier 4 trace, accumulate explainable knowledge, receive higher-tier
contact, and unlock—but do not trigger—the Threshold.

Acceptance:

- Eligibility follows documented event/knowledge rules, not a hidden score.
- It is explainable from history and reproducible in tests.
- Player pursuit and autonomous simulation can each cause contact.
- LLM presentation cannot control eligibility or contact consequences.
- Unrelated play cannot accidentally trigger ascension.

### Phase 31 - Ascension And Indirect Influence

Acceptance:

- Explicit confirmation creates a pre-transition save.
- Ship, crew, cargo, and relationships become a persistent legacy actor.
- The player perceives the same live universe without a physical body.
- One indirect action changes a simulation input, not a scripted outcome.
- Saves on both sides cannot mix control modes.

### Phase 32 - Direct Manifestation

Ship one focused physical intervention with explicit targeting, precursors,
effect, cancellation, aftermath, stable events, and lower-/higher-tier reaction.
It must use general world mutation APIs and leave unrelated worlds untouched.

### Phase 33 - Cosmic Construction And Destruction

Universe changes are sparse overlays on procedural generation. A system mutation
must have precursors, cancellation, completion, aftermath, and referential-
integrity handling for navigation, missions, NPCs, markets, and legacy actors.
Galaxy-scale destruction stays disabled until system-scale mutation passes
long-run save and recovery tests.

### Phase 34 - Tier 4 Politics And Living Legacy

At least two non-player Tier 4 actors need distinct drives and plans. Alliance,
opposition, indifference, and delayed response must emerge from shared agenda
and event contracts. The former ship/crew can create events without privileged
scripts, and long seeded runs remain bounded and inspectable.

## Required Decision Gates

| Before | Decision | Recommended default |
|---|---|---|
| Signoff | Is radio official Phase 12? | Yes; RPG resumes at 13 |
| 13 | Autosave/import policy | Major transitions; imports make a new slot |
| 14 | Fuel recovery | Protected reserve plus emergency rescue |
| 15 | Crew cap/representation | Design for 4; ship 1 stand-in first |
| 15 | Live voice required? | No; deterministic text is acceptance path |
| 16 | First surface world | Delivery destination unless lore conflicts |
| 19 | Weapon resource | Cooldown/heat first, ammunition later |
| 19 | Defeat | Recoverable damage/tow, never save deletion |
| 21 | EVA recovery | Conservative acceleration plus explicit recovery |
| 22 | Priority | Defer if ship combat/boarding are not yet strong |
| 24 | LLM model tiering and budget | Cheap/local for ambient, strong model only for the active conversation, cached on NPC memory |
| 25 | Region lattice resolution, biome taxonomy, ground-cover budget | Lattice independent of render LOD; freeze the shipped biome set as IDs; instanced cover within the tile budget |
| 26 | Station venue and embodied-NPC budget | Reuse an interior shell first; hard-cap embodied NPCs by proximity |
| 27 | City size and enterable interiors | Small footprint, one or two enterable shells first |
| 28 | Day-cycle length and L2 agent budget | Short day cycle; cap L2 agents per city, fold to L1 off-screen |
| 29 | Names/art bar | Lock one content batch at a time |
| 31 | First god-phase view | Familiar universe plus information overlay |

## Scope And Replanning Rules

Split a phase if it introduces multiple unproven real-time systems, requires
more than one new environment/NPC archetype, cannot test migration separately
from UI, requires final lore/art and new system code together, lacks recovery
before destructive state, or has no repeatable performance scene.

Phases 15 and 16 may swap. Optional radio work is independent. Phase 18 must
precede 19, Phase 16 precedes 22, and Phase 23 precedes full ascension.

Living-world ordering (Horizon 5): Phase 23 precedes all of 24–28. Phase 24
(dialogue) precedes 26 (NPCs are worth meeting only once they can talk). Phase 25
(biomes/regions) precedes 26's surface venue and 27 (content is placed on
regions). Phase 26 (embodiment) precedes 27's city population and 28. Phase 27
(cities) precedes 28 (life-sim fills a city). The whole living-world horizon
precedes the Phase 29 content program and all of ascension (30–34).

## Next Action

Phases 12–22 are shipped. The current frontier is **Phase 23 — the simulation
substrate** ([`phase-23-autonomous-simulation.md`](phase-23-autonomous-simulation.md)),
whose design is locked. Its first implementation step is the pure `simCore`
module and the L1↔L2 LOD round-trip no-op test with one synthetic entity — not
the three factions.

After Phase 23's determinism and migration tests are green, write the **Phase 24
implementation document** (hybrid dialogue) specifying: the authored-beat vs.
open-LLM arbitration contract, the read-only context snapshot and side-effect-free
output contract, LOD model routing and budget, the offline/failure state machine,
and the adversarial test that proves LLM output is inert against game state. Do
not design Phase 26 NPC venues until the Phase 24 dialogue contract is stable.

Copy-paste implementation and audit prompts for every phase are available in
[`rpg-phase-agent-prompts.md`](rpg-phase-agent-prompts.md).
