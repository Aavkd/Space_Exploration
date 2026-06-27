# Deep Space VR - Future RPG Development Roadmap

> **Status:** Proposed execution roadmap after the validated Phase 11 RPG slice.
> **Last updated:** 2026-06-27.
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
| 23 | Three-faction autonomous simulation | Scheduler, agendas, relationships, tiers | 17, 20 |
| 24 | Ten-system MVP content program | Content pipeline and breadth | Proven systems |
| 25 | Qualify for ascension | Knowledge and Tier 4 traces | 23, 24 |
| 26 | Ascend and indirectly influence | Phase transition and legacy | 25 |
| 27 | Direct manifestation | Focused Tier 4 powers | 26 |
| 28 | Cosmic construction/destruction | Procedural-universe mutation | 26, 27 |
| 29 | Tier 4 politics | Sustained post-ascension simulation | 23, 26-28 |

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

**Proof loop:** approach one hostile POI, evade or engage, resolve a small
encounter, recover the objective, and return.

Acceptance:

- One weapon, enemy, cover/line-of-sight model, defeat, and recovery form a loop.
- Spawns cannot intersect terrain, structures, player, or ship.
- Leaving/reloading cannot duplicate enemies or rewards.
- Mission state distinguishes authored evasion, defeat, and combat outcomes.
- Desktop and VR aiming, comfort, feedback, and performance pass.

### Phase 23 - Autonomous World Simulation

**Proof loop:** observe three factions pursue agendas over play time, receive a
report of a political/economic change, intervene, and see a different outcome.

Deliverables include a seeded scheduler, stable event IDs, faction resources,
behavioral drives, agendas, relationship matrix, event prerequisites/effects,
and one tier-transition proof.

Acceptance:

- Seed plus command sequence reproduces the same event history.
- Catch-up is bounded and uses only accumulated play time.
- Invalidated events cancel/transform without corrupting successors.
- Territory, market, patrol, and relationship changes trace to event IDs.
- Intervention changes an input rather than selecting a scripted result.
- Long seeded soak tests preserve numeric/population invariants.
- Three factions behave distinctly from their authored drive seeds.

## Horizon 5 - Scale Content Safely

### Phase 24 - Ten-System MVP Content Program

This is a sequence of independently shippable content batches, not one dump.

**24A - Authoring pipeline:** validate systems, planets, POIs, NPCs, dialogue,
missions, markets, signals, localization keys, references, and reachability.

**24B - Tier 2 network:** complete the six faction hubs in small batches. Each
has a distinct role/landmark, at least two persistent NPCs, one multi-step
thread, and observable favorable and hostile consequences.

**24C - Civilization extremes:** add the Tier 3 enclave, Tier 0 world, deep-void
trace, and Threshold. Each proves a distinct interaction—not a reskinned market.

Every authored system must have deterministic placement, reachable entry/exit
and recovery, valid references, save checkpoints, content-only tests, a manual
playthrough, and a performance spot check.

Content starts earlier rather than waiting for Phase 24:

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

## Horizon 6 - Ascension

### Phase 25 - Ascension Precursor

Discover a Tier 4 trace, accumulate explainable knowledge, receive higher-tier
contact, and unlock—but do not trigger—the Threshold.

Acceptance:

- Eligibility follows documented event/knowledge rules, not a hidden score.
- It is explainable from history and reproducible in tests.
- Player pursuit and autonomous simulation can each cause contact.
- LLM presentation cannot control eligibility or contact consequences.
- Unrelated play cannot accidentally trigger ascension.

### Phase 26 - Ascension And Indirect Influence

Acceptance:

- Explicit confirmation creates a pre-transition save.
- Ship, crew, cargo, and relationships become a persistent legacy actor.
- The player perceives the same live universe without a physical body.
- One indirect action changes a simulation input, not a scripted outcome.
- Saves on both sides cannot mix control modes.

### Phase 27 - Direct Manifestation

Ship one focused physical intervention with explicit targeting, precursors,
effect, cancellation, aftermath, stable events, and lower-/higher-tier reaction.
It must use general world mutation APIs and leave unrelated worlds untouched.

### Phase 28 - Cosmic Construction And Destruction

Universe changes are sparse overlays on procedural generation. A system mutation
must have precursors, cancellation, completion, aftermath, and referential-
integrity handling for navigation, missions, NPCs, markets, and legacy actors.
Galaxy-scale destruction stays disabled until system-scale mutation passes
long-run save and recovery tests.

### Phase 29 - Tier 4 Politics And Living Legacy

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
| 24 | Names/art bar | Lock one content batch at a time |
| 26 | First god-phase view | Familiar universe plus information overlay |

## Scope And Replanning Rules

Split a phase if it introduces multiple unproven real-time systems, requires
more than one new environment/NPC archetype, cannot test migration separately
from UI, requires final lore/art and new system code together, lacks recovery
before destructive state, or has no repeatable performance scene.

Phases 15 and 16 may swap. Optional radio work is independent. Phase 18 must
precede 19, Phase 16 precedes 22, and Phase 23 precedes full ascension.

## Next Action

After signoff, write a Phase 13 implementation document specifying save-envelope
and migration contracts, the ship-computer interaction, autosave/import choices,
the exact automated matrix, desktop/gamepad/XR checklist, and recovery behavior.
Do not design Phase 14 saved state until Phase 13 contracts are stable.

Copy-paste implementation and audit prompts for every phase are available in
[`rpg-phase-agent-prompts.md`](rpg-phase-agent-prompts.md).
