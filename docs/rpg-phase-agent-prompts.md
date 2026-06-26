# Deep Space VR - Agent Prompt Pack For Future RPG Phases

> **Purpose:** Copy-paste prompts for implementing the phases defined in
> `rpg-future-development-roadmap.md`.
> **Last updated:** 2026-06-27.

## How To Use This Pack

For a fresh agent, send the **Shared Execution Contract** followed by exactly
one phase prompt. Do not ask one agent to implement several phases at once.

Before starting a phase:

1. Confirm every listed prerequisite is actually complete in code and tests.
2. Resolve the decision gate named by the roadmap, if that decision affects
   state or architecture.
3. Give the agent any final lore, art, balance, or UX choices already made.
4. Work on a dedicated branch or checkpoint.

After the agent finishes, review its verification record before starting a
dependent phase. Passing unit tests alone is not phase completion.

## Shared Execution Contract

Copy this block before one phase-specific prompt:

```text
You are implementing one vertical slice of Deep Space VR.

Repository context:
- Read README.md first.
- Read docs/rpg-design-vision.md.
- Read docs/worldbuilding.md where relevant.
- Read docs/phase-11-rpg-roadmap.md.
- Read docs/rpg-future-development-roadmap.md, especially the shared Definition
  of Done, test ladder, target phase, dependencies, exclusions, and decision gates.
- Read the implementation and tests that currently own the affected systems.
- Treat the repository and current tests as evidence; do not assume a roadmap
  item is implemented merely because it is documented.

Working rules:
- Implement only the requested phase. Do not quietly absorb later phases.
- Preserve all existing user changes and unrelated worktree changes.
- Reuse current architecture and physical interaction patterns before adding
  parallel systems.
- Deterministic code is authoritative for missions, objectives, NPC state,
  inventory, credits, reputation, ship condition, simulation, and rewards.
  LLM output may provide presentation only.
- Simulation time advances only during active play.
- New persistent fields require validation, sanitization, debug visibility,
  round-trip tests, and a real migration from the previous save version.
- Keep flight/rendering functional when optional RPG, voice, audio, or
  simulation integrations fail.
- Use stable IDs and descriptive errors for invalid IDs/transitions.
- Placeholder content/art is acceptable unless final assets are explicitly
  supplied.
- Ask a question only if the answer changes architecture, saved data, destructive
  behavior, or player-facing rules. Otherwise state a reasonable assumption and
  continue.
- Do not commit, push, or open a PR unless explicitly asked.

Execution:
1. Inspect prerequisites and current architecture.
2. Write or update the dedicated phase document with exact scope, state
   contracts, acceptance criteria, explicit exclusions, and a manual checklist.
3. Implement the smallest complete normal-control player loop.
4. Add deterministic domain, failure, persistence, migration, and integration
   tests proportional to the change.
5. Add or update debug APIs without making them necessary for normal play.
6. Run existing and new tests, syntax/static checks, and an actual browser smoke
   test. Perform gamepad/XR checks when the phase changes physical interaction.
7. Exercise save/reload at every important checkpoint and validate reset/recovery.
8. Update README.md, the phase roadmap status, and known limits.

Do not call the phase complete unless every applicable acceptance criterion has
evidence. If a prerequisite is missing, stop before building around it and report:
- the missing prerequisite;
- the evidence;
- the smallest recovery phase;
- which work, if any, remains safe to do now.

Final response:
- Lead with whether the phase is complete, partial, or blocked.
- Summarize the playable loop and architecture changes.
- List changed files.
- Report exact test/browser/manual/XR results.
- Identify save-version changes and migration coverage.
- List remaining limitations and decisions.
```

## Phase 12B Prompt - Custom Local Radio Stations

```text
Implement Phase 12B, Custom Local Radio Stations.

Prerequisite: the implemented Phase 12A radio console, CRT UI, and audio
coordination described in docs/phase-12-radio-transceiver.md.

Goal:
Let a developer add supported local audio files to station folders, regenerate
a deterministic manifest, and play each folder as a reliable radio playlist.

Required scope:
- Documented custom-radio directory and versioned manifest schema.
- Cross-platform Node manifest generator with stable ordering, safe paths,
  supported-extension filtering, and descriptive validation errors.
- Station frequency assignment that remains stable when unrelated tracks change.
- Playlist sequencing, next-track behavior, volume, tune-away, power-off,
  reload, missing-file, decode-error, and empty-station handling.
- Audio-bus integration that cannot leave ambient music permanently ducked.
- Tests for manifest generation and playlist state; browser smoke with a small
  test fixture that does not commit copyrighted media.

Do not implement OS folder watching in the browser, uploads, streaming services,
celestial proximity signals, missions, or a general media library.

Update docs/phase-12-radio-transceiver.md with exact usage, limitations, and
verification results.
```

## Phase 12C Prompt - Proximity Signal Bridge

```text
Implement Phase 12C, Proximity Signal Bridge.

Prerequisite: the implemented Phase 12A radio console, CRT UI, and audio
coordination described in docs/phase-12-radio-transceiver.md.

Goal:
Let the player tune one deterministic celestial signal, follow signal-strength
feedback, identify its source using normal controls, and expose the discovery
for later exploration missions.

Required scope:
- Stable signal definition IDs with source, frequency, range, and seed/context.
- Deterministic distance-to-strength evaluation in the active scale context.
- Static/signal audio crossfade with no duplicate loops.
- CRT signal meter and waveform response.
- Clean handling of tune-away, power-off, leaving range, scale transition,
  reload, and audio/RPG failure.
- One discoverable proof signal and debug inspection.

Do not implement custom music discovery, missions, rewards, generalized anomaly
content, or radio-controlled world mutations.

Use the Phase 12 acceptance criteria in
docs/rpg-future-development-roadmap.md. Update
docs/phase-12-radio-transceiver.md with implementation and verification results.
```

## Phase 13 Prompt - Ship Log, Save Slots, And Simulation Clock

```text
Implement Phase 13, Ship Log, Save Slots, And Simulation Clock.

Prerequisite: validated Phase 11A-E. Radio work is not required.

Goal:
Create the durable, versioned world-state envelope needed by all later RPG
systems and prove it through a physical ship-computer save/log loop.

Use these defaults unless the user overrides them:
- Three local slots.
- Autosave on major transitions and authoritative RPG consequences, with
  debounce/coalescing where necessary.
- Import creates a new slot after validation and preview; it never silently
  overwrites the active slot.
- No cloud/backend synchronization.

Required scope:
- Physical ship-computer/codex interaction.
- Versioned save envelope with player, ship, RPG, simulation, and settings
  domains without inventing unused later-phase state.
- New/load/delete slots and explicit autosave metadata.
- Validated export/import and corrupt/future-version rejection.
- Monotonic injected game clock that advances only during active play.
- Event-log query plus documented retention/compaction policy.
- Migration from the current Phase 11 version-1 save with a fixture.
- A CI workflow running the app RPG regression suite from a clean checkout.

The normal loop must inspect `A Clean Copy`, export a slot, change state, and
restore the prior state. Validate close/reopen, pause/focus, storage failure,
slot isolation, import safety, and migration fidelity.

Do not add economy ticks, NPC schedules, cloud saves, or polished codex lore.
Create docs/phase-13-save-slots-and-clock.md and update roadmap status.
```

## Phase 14 Prompt - Cargo, Fuel, And Two-System Delivery

```text
Implement Phase 14, Cargo, Fuel, And Two-System Delivery.

Prerequisite: Phase 13 save envelope, migrations, slots, game clock, and CI are
implemented and passing.

Goal:
Prove a multi-step job that loads persistent cargo, travels to a second authored
system, consumes fuel, and pays credits/reputation exactly once.

Use these defaults unless overridden:
- The second anchor uses the Index HQ role with placeholder name/art.
- Fuel has a protected reserve and a deterministic emergency rescue/refuel path.
- Prices are static in this phase.

Required scope:
- Stable cargo definitions with quantity, mass, and legality tags.
- Ship credits, fuel, capacity, and a physical cargo-bay/terminal interaction.
- Second authored system/contact.
- Mission objectives separate from lifecycle status.
- Documented hyperdrive fuel formula and recovery rule.
- One delivery mission with pickup, in-transit, delivery, abandon/loss, and
  duplicate-prevention behavior.
- Save migration and debug inspection.

Test saves before pickup, after loading, in transit, after delivery, and during
failure paths. Verify full cargo, insufficient fuel, duplicate delivery,
re-entry, and exact-once rewards. Preserve Phase 11 behavior.

Do not build dynamic markets, free trading, patrol scans, docking, or NPC ships.
Create docs/phase-14-cargo-fuel-delivery.md and update roadmap status.
```

## Phase 15 Prompt - Persistent Crew Foundation

```text
Implement Phase 15, Persistent Crew Foundation.

Prerequisite: Phase 13. If Phase 14 exists, integrate contextual reactions to
its delivery outcome; otherwise keep the contract ready without fabricating it.

Goal:
Add one physically present ship-resident NPC whose presence, relationship,
memory, and authored dialogue respond to authoritative game state.

Use these defaults unless overridden:
- Design state for a maximum of four crew; ship one crew member now.
- Use a clearly documented placeholder avatar/animation.
- Deterministic text interaction is required; live voice is optional.

Required scope:
- Shared NPC contract compatible with contacts and future encounter NPCs.
- One stable crew anchor and physical interaction.
- Presence, location, relationship, mood, memory references, alive, and
  recruited state.
- Contextual authored beats for both `A Clean Copy` outcomes and Phase 14 if
  available.
- Read-only context adapter for optional LLM/voice presentation.
- Offline, connecting, listening, responding, interrupted, and failed UI states.
- Protection against late/malformed responses and unauthorized mutations.

Verify persistence, exact-once memories, offline completion, interruption,
reload, unavailable voice service, desktop/gamepad interaction, and PCVR.

Do not add recruitment systems, schedules, crew combat, death, romance, or final
character art. Create docs/phase-15-crew-foundation.md.
```

## Phase 16 Prompt - Surface Outpost Vertical Slice

```text
Implement Phase 16, Surface Outpost Vertical Slice.

Prerequisite: Phase 13 and the shipped landing/surface-EVA systems. Phase 15 is
optional; use the shared NPC contract if it exists.

Goal:
Connect orbit scanning, descent, landing, surface walking, one physical
interaction, return-to-ship, and mission completion on one authored planet.

Use the Phase 14 destination as the first surface world if available and not in
conflict with authored lore. Otherwise use a placeholder authored body.

Required scope:
- Deterministic planet POI definition and placement.
- Orbit-to-surface marker/approach feedback.
- One safe landing area and placeholder outpost.
- One surface NPC or terminal objective.
- Visit, discovery, objective, and return state with migration/debug support.

Verify stable geographic placement after reload/re-entry; marker usefulness at
every scale; terrain alignment tolerance; orbit, landed, walking, returned, and
completed saves; gas-giant exclusion; and existing surface tests.

Do not add procedural settlements, combat, crowds, interiors, or markets.
Create docs/phase-16-surface-outpost.md.
```

## Phase 17 Prompt - Faction Territory And Patrol

```text
Implement Phase 17, Faction Territory And Patrol.

Prerequisite: Phase 14 cargo legality, reputation, travel, and persistent state.

Goal:
Make location, reputation, and cargo create one deterministic patrol encounter
without requiring combat.

Required scope:
- Deterministic faction-influence query.
- One local patrol agent with spawn, approach, hail, wait, depart, and abort.
- Reputation thresholds with anti-flapping behavior.
- Cargo legality scan and policy evaluation.
- Welcome, inspection, warning/refusal, ignored-hail, and safe-hostility outcomes.
- Despawn, reload, and scale-transition rules.

Verify identical seed/state/location/time produces the same encounter; no agent
duplication; all policy paths; clean UI exit; and safe departure.

Do not add weapons, damage, fleets, dynamic faction agendas, or forced combat.
Create docs/phase-17-faction-patrol.md.
```

## Phase 18 Prompt - Ship Condition, Hazard, Salvage, And Repair

```text
Implement Phase 18, Ship Condition, Hazard, Salvage, And Repair.

Prerequisites: Phases 14 and 17.

Goal:
Establish the ship as the character sheet before combat can damage it.

Required scope:
- Validated hull plus engine, hyperdrive, sensors, comms, life-support, and
  weapons condition records.
- Bounded condition-to-capability effects.
- One non-combat hazard and one salvage source.
- Parts and hull-plate inventory.
- Physical maintenance interaction and atomic repair transaction.
- Recovery rule for critical state, migration, event records, and debug APIs.

Verify persistent deterministic damage; exact repair consumption; non-duplicating
salvage; extreme/corrupt-value sanitization; reload at every checkpoint; and
controllable flight for every reachable condition.

Do not add weapons, hostile AI, broad crafting, crew survival consumption, or
dynamic salvage markets. Create docs/phase-18-ship-condition.md.
```

## Phase 19 Prompt - Ship Combat Foundation

```text
Implement Phase 19, Ship Combat Foundation.

Prerequisite: Phase 18 ship condition, damage, salvage, repair, and recovery.

Goal:
Ship one fair arcade-style encounter that can be won or escaped and leaves
persistent, repairable consequences.

Use these defaults unless overridden:
- Weapons use cooldown/heat first; ammunition is deferred.
- Defeat uses recoverable damage plus tow/rescue, never save deletion.

Required scope:
- Weapon hardpoints, firing rules, feedback, target selection/lock/range/lead.
- Deterministic hit-to-system-damage contract.
- One Tier 2 enemy with patrol, pursue, attack, retreat, and destroyed states.
- Player disengagement, defeat/recovery, combat cleanup, and event records.
- Hooks for missions, reputation, crew reaction, and salvage through public APIs.
- Fixed-step combat tests and a written performance test scene/budget.

Verify win, flee, defeat, reload, destroyed-enemy persistence, friendly/neutral
rules, cleanup of projectiles/targets/audio/agents, repair integration, desktop,
gamepad, PCVR, and performance.

Do not add fleets, capital ships, boarding, Tier 3 weapons, or broad equipment
progression. Create docs/phase-19-ship-combat.md.
```

## Phase 20 Prompt - Dynamic Economy And Trade

```text
Implement Phase 20, Dynamic Economy And Trade.

Prerequisites: Phase 14 cargo/credits and Phase 17 faction/contraband policy.

Goal:
Create three understandable markets where moving goods from surplus to shortage
changes stock and price without destabilizing the simulation.

Required scope:
- Three markets and a small stable-ID trade-good set.
- Bounded stock, production, consumption, and deterministic price functions.
- Economy ticks driven only by Phase 13 play time.
- Atomic transactions, ledger, invariants, physical trade interactions.
- Age-stamped remote information and patrol-visible contraband value.
- Long-run seeded soak tests.

Verify determinism; no closed-game changes; no rounding exploits; finite bounded
prices/stocks; mid-transaction reload atomicity; insufficient funds/capacity;
and a viable proof route that responds to trade.

Do not add galaxy-wide logistics, speculative finance, crafting economy, or
autonomous faction budgets beyond what the proof needs.
Create docs/phase-20-dynamic-economy.md.
```

## Phase 21 Prompt - Untethered EVA And Derelict Boarding

```text
Implement Phase 21, Untethered EVA And Derelict Boarding.

Prerequisite: Phase 18 ship condition/recovery plus existing tethered EVA.

Goal:
Safely move from the ship to one nearby derelict interior, recover one item/log,
and return.

Use conservative acceleration and an explicit recovery/return action unless the
user supplies another comfort rule.

Required scope:
- Stable relative-frame movement within documented limits.
- Oxygen/range/return feedback and recovery.
- Ship-to-EVA-to-interior transfer states.
- One boardable placeholder derelict and exact-once objective.
- Save/load outside, inside, returning, and completed.
- VR comfort and failure recovery.

Do not add hostile boarding, close-quarters combat, moving-ship assault, or a
general interior generation system. Create docs/phase-21-eva-boarding.md.
```

## Phase 22 Prompt - Hostile Surface Site

```text
Implement Phase 22, Hostile Surface Site.

Prerequisites: Phase 16 surface POIs and Phase 18 damage/recovery. Reuse Phase 19
combat contracts where they genuinely apply, without forcing ship-combat code
into first-person combat.

Goal:
Add one surface encounter that supports evasion or engagement and a safe return.

Required scope:
- One player weapon and one enemy archetype.
- Cover/line-of-sight, aiming, damage, defeat, and recovery.
- Terrain/structure-safe deterministic spawning.
- Encounter persistence and non-duplicating objective/reward.
- Mission outcomes for authored evade, defeat, and combat resolution.
- Desktop and VR controls, comfort, feedback, and performance budget.

Do not add weapon rosters, squads, procedural bases, boarding combat, or final
combat balance. If ship combat and EVA are not stable/fun enough to support this
phase, report the evidence and recommend deferral rather than forcing it.
Create docs/phase-22-surface-combat.md.
```

## Phase 23 Prompt - Autonomous World Simulation

```text
Implement Phase 23, Autonomous World Simulation.

Prerequisites: Phase 17 faction/patrol behavior and Phase 20 economy.

Goal:
Prove three factions independently pursuing distinct agendas over play time,
with legible reports, traceable effects, and one meaningful player intervention.

Required scope:
- Seeded bounded scheduler, stable event IDs, replay protection, cancellation.
- Faction resources, authored behavioral drives, agendas, relationship matrix.
- Economy/faction/patrol effects through public contracts.
- Event prerequisites, effects, conflict resolution, and causal trace.
- One tier-transition proof event.
- Ship-log summaries that respect player knowledge.
- Seeded replay and long-run soak/invariant tools.

Verify deterministic history from seed and commands; bounded play-time-only
catch-up; invalidated-event handling; causal IDs for territory/market/patrol/
relationship changes; intervention through normal inputs; distinct faction
behavior; and long-run bounds.

Do not implement all six factions at full depth, offline real-time progress,
Tier 4 politics, or ascension. Create docs/phase-23-world-simulation.md.
```

## Phase 24A Prompt - Content Authoring Pipeline

```text
Implement Phase 24A, Content Authoring Pipeline.

Prerequisite: the system contracts from the phases whose content will be
authored. Do not redesign those systems inside the content pipeline.

Goal:
Make authored systems, planets, POIs, NPCs, dialogue, missions, markets, signals,
encounters, and localization references validate without launching the game.

Required scope:
- Explicit schemas/contracts and content-only validation command.
- Duplicate/missing ID, invalid reference, unreachable dialogue/objective,
  impossible prerequisite, reward duplication, and localization checks.
- A browser fixture/debug entry that enters one selected authored system.
- Clear error locations suitable for content authors.
- Documentation and one minimal valid/invalid fixture per content family.

Do not author all ten systems in this phase or move runtime authority into data
files. Create docs/phase-24-content-program.md with 24A verification.
```

## Phase 24B Prompt - Tier 2 Content Batch

```text
Implement one Phase 24B Tier 2 content batch, not all remaining hubs at once.

Prerequisites: Phase 24A validation and every gameplay system used by this batch.

Before coding, state exactly which one or two faction hubs are in this batch and
which existing contracts they consume. Use final lore supplied by the user;
otherwise keep clearly identified placeholders rather than inventing canon.

Each hub requires:
- Fixed authored seed/location and distinct role/landmark.
- At least two persistent NPCs across appropriate categories.
- One multi-step mission thread with reload checkpoints and exact-once rewards.
- One favorable and one hostile observable faction consequence.
- Valid entry, exit, failure, and recovery paths.
- Content-only validation, browser fixture, normal-control playthrough, and
  performance spot check.

Do not alter core systems to accommodate one-off story shortcuts. Record the
batch in docs/phase-24-content-program.md and leave later hubs untouched.
```

## Phase 24C Prompt - Civilization Extreme Content Batch

```text
Implement one Phase 24C civilization-extreme content batch.

Prerequisites: Phase 24A and the gameplay systems used by the selected location.

Select exactly one of: Tier 3 enclave, Tier 0 world, deep-void Tier 4 trace, or
The Threshold. Confirm its interaction thesis before implementation. It must
prove a distinct mode of play and must not be a reskinned Tier 2 market.

Required quality gates:
- Deterministic location/POIs and valid references.
- Distinct interaction rules appropriate to its civilization tier.
- Reachable entry, objective, exit, failure, and recovery paths.
- Persistent consequences and all-stage save/reload coverage.
- Content-only validation, browser fixture, manual playthrough, and performance.

Do not implement ascension mechanics while authoring the Threshold, and do not
invent final Tier 3/Tier 4 canon without user approval. Update the Phase 24 doc.
```

## Phase 25 Prompt - Ascension Precursor

```text
Implement Phase 25, Ascension Precursor.

Prerequisites: Phase 23 autonomous simulation and the necessary Phase 24 Tier 3,
Tier 4 trace, and Threshold content.

Goal:
Let the player discover traces, accumulate explainable knowledge, receive
higher-tier contact, and unlock—but not trigger—the Threshold.

Required scope:
- Knowledge/discovery/contact state tied to causal events.
- Documented eligibility rules explainable in the ship log.
- Both player-pursued and simulation-initiated contact paths.
- Authored deterministic authority boundary around optional LLM presentation.
- Threshold availability without phase transition.

Verify eligibility reproduction, missing/reordered prerequisites, reload,
duplicate discoveries, contact timing, and protection from accidental ascension.

Do not implement the ascension transition, god controls, manifestation, or
cosmic mutation. Create docs/phase-25-ascension-precursor.md.
```

## Phase 26 Prompt - Ascension And Indirect Influence

```text
Implement Phase 26, Ascension And Indirect Influence.

Prerequisite: Phase 25 eligibility/Threshold loop and a stable Phase 23
simulation.

Goal:
Ship the smallest complete post-ascension game: confirmed transition, legacy
preservation, expanded perception, and one indirect simulation influence.

Use a familiar universe view plus information overlay as the initial perception
unless the user decides otherwise.

Required scope:
- Explicit irreversible-action confirmation and automatic pre-transition save.
- Separate pre/post-ascension control modes and validated save state.
- Former ship, crew, cargo, and relationships converted into a persistent legacy
  actor using normal simulation contracts.
- Post-physical universe perception.
- One indirect influence that changes a normal simulation input.
- Recovery, migration, and debug inspection.

Verify both sides of transition, rejected/cancelled transition, pre-save restore,
legacy continuity, control-mode isolation, deterministic influence, and XR/UI.

Do not add direct manifestation, universe mutation, or full Tier 4 politics.
Create docs/phase-26-ascension.md.
```

## Phase 27 Prompt - Direct Manifestation

```text
Implement Phase 27, Direct Manifestation.

Prerequisite: stable Phase 26 post-ascension controls and simulation influence.

Goal:
Add exactly one focused physical Tier 4 intervention with visible precursors,
explicit targeting, cancellation, aftermath, and simulation response.

Required scope:
- General target/focus/effect state machine and stable events.
- One manifestation implemented through public world-mutation contracts.
- Lower-tier perception/reaction based on information.
- Tier 4 notice hook without implementing the full politics layer.
- Save/reload and cancellation at each stage.

Verify invalid targets, interruption, reload, unaffected-world integrity,
scale/terrain/navigation safety, causal reactions, and deterministic replay.

Do not add a power catalogue, cosmic topology changes, or bespoke scripted
faction outcomes. Create docs/phase-27-manifestation.md.
```

## Phase 28 Prompt - Cosmic Construction And Destruction

```text
Implement Phase 28, Cosmic Construction And Destruction, at SYSTEM SCALE ONLY.

Prerequisites: Phases 26-27 and stable world/simulation mutation contracts.

Goal:
Prove one slow, recoverable construction or destruction mutation as a sparse
overlay on procedural generation.

Safety constraints:
- Never destructively rewrite procedural seeds/generation data.
- Create an automatic backup/export before applying the mutation.
- Galaxy annihilation remains disabled.
- Stop if referential integrity for navigation, missions, NPCs, markets, events,
  and legacy actors is not designed and tested first.

Required scope:
- Precursor, targeting, scheduled progress, cancellation, completion, aftermath.
- Sparse mutation overlay with stable ID and event history.
- Reference migration/cancellation/relocation policy.
- Restore/recovery tooling and long-run save tests.

Verify cancellation/reload at every stage, backup restore, all references,
navigation/scale safety, unaffected systems, deterministic replay, and simulation
response. Create docs/phase-28-cosmic-mutation.md.
```

## Phase 29 Prompt - Tier 4 Politics And Living Legacy

```text
Implement Phase 29, Tier 4 Politics And Living Legacy.

Prerequisites: Phase 23 simulation plus stable Phases 26-28 post-ascension
actions/events. Final Tier 4 identities and behavioral directions require user
approval before becoming canon.

Goal:
Turn post-ascension play into a sustained political simulation rather than a
collection of powers.

Required scope:
- At least two non-player Tier 4 actors with distinct approved drives/plans.
- Shared agenda/event contracts for player and non-player Tier 4 actions.
- Alliance, opposition, indifference, delayed response, and incomplete
  information.
- Former ship/crew legacy acting through normal agent contracts.
- Causal ship-log/post-ascension observability and seeded soak tools.

Verify distinct behavior, delayed consequences, player action response, legacy
autonomy, no privileged one-off scripts, deterministic replay, long-run bounds,
save/reload, and coexistence with lower-tier simulation.

Do not add more actors/powers merely for content breadth until this minimum
political loop is legible and stable. Create docs/phase-29-tier4-politics.md.
```

## Optional Audit Prompt Between Phases

Use this with a fresh agent before beginning a high-risk dependent phase:

```text
Audit the claimed completion of Phase [NUMBER] in Deep Space VR without changing
code unless I explicitly authorize fixes.

Read the phase document, future roadmap Definition of Done, implementation,
tests, debug APIs, migration path, and verification record. Re-run safe automated
checks and inspect the normal player path using the browser where possible.

Report:
- acceptance criteria with PASS, FAIL, or NOT EVIDENCED;
- missing prerequisite contracts for the next phase;
- save/migration and failure-containment risks;
- untested browser/gamepad/XR/performance claims;
- scope that leaked in from later phases;
- the smallest remediation slice.

Do not accept documentation claims as evidence by themselves, and do not mark
manual or XR checks passed unless they were actually performed.
```
