# Phase 11 - RPG Roadmap

> **Status:** Planning locked for first implementation slice.
> **Last updated:** 2026-06-26.
> **Companion docs:** `rpg-design-vision.md`, `worldbuilding.md`, `phase-09-voice-ai-assistant.md`.

## Goal

Build the RPG layer in small, testable phases. The first playable slice is a single physical interaction loop:

```text
Arrive at an authored system
  -> use cockpit comms
  -> meet one contact
  -> accept or resolve one mission
  -> mutate reputation and world state
  -> persist the result
```

Once that loop is validated, expand the same architecture into crew, economy, patrols, surface POIs, combat, and larger simulation autonomy.

## Locked Decisions

- Development proceeds by testable phases, not by building the full RPG layer at once.
- The first slice uses cockpit comms as the interaction surface.
- First mission content can use placeholder IDs and names. Final lore names can be authored later.
- The first save system can be local and simple. Backend migration is deferred.
- Simulation time advances only while the game is running.
- LLM dialogue is allowed for flavor and open conversation, but authored mission state remains deterministic.
- Combat, economy, patrol AI, surface POIs, and larger autonomous simulation are deferred until the first loop is proven.

## Architecture Principle

The RPG layer should be a state system first and a content system second.

The first implementation should create a narrow `src/rpg/` boundary that owns:

- Runtime RPG state.
- Local persistence.
- Faction and reputation records.
- Named system definitions.
- Contact NPC definitions.
- Mission definitions and mission state.
- Deterministic event log entries.

Rendering, flight, scale transitions, voice, and UI should consume this state through small integration points instead of owning it directly.

## Phase 11A - RPG State Spine

Objective: create the minimal data and persistence layer needed by every future RPG feature.

Deliverables:

- `src/rpg/` module boundary.
- `RpgState` model with schema/version number.
- Local save/load adapter.
- Event log with append-only deterministic events.
- Faction registry with reputation values.
- Named system registry with placeholder authored system IDs.
- Debug access through `window.__deepSpaceDebug`.

Acceptance criteria:

- A new game creates a deterministic initial RPG state.
- Reputation can be changed and read back.
- Event log entries can be appended and inspected.
- Reloading the page restores the local RPG state.
- Save data includes a version number for future migrations.

Suggested tests:

- Unit-style browser/debug test for state creation.
- Manual reload test: mutate reputation, refresh, verify persistence.
- Corrupt/missing save fallback test.

## Phase 11B - Authored System Anchor

Objective: make one authored system reachable in the existing procedural universe.

Deliverables:

- One MVP named system definition, using placeholder names if needed.
- Fixed seed override or deterministic placement hook.
- System metadata exposed through existing POI/navigation surfaces.
- RPG metadata available when the player enters the system.

Acceptance criteria:

- The authored system appears consistently across runs.
- The player can navigate to it using existing universe markers.
- Entering the system exposes its RPG metadata in debug state.
- The system still behaves like a normal scale-stack system for flight, gravity, and descent/ascent.

Suggested tests:

- Regenerate/reload consistency check.
- Debug state shows active named system ID.
- Existing procedural systems still spawn normally.

## Phase 11C - Cockpit Comms Interaction

Objective: add the first physical RPG interaction point: cockpit comms.

Deliverables:

- A comms station interaction trigger in the ship/cockpit flow.
- Minimal comms UI or diegetic panel state.
- One contact NPC reachable only in the authored system.
- Deterministic authored dialogue choices for mission-critical beats.
- Optional LLM flavor text path, gated so it cannot mutate mission state directly.

Acceptance criteria:

- Player can enter the authored system and use cockpit comms.
- Contact appears only when context rules allow it.
- Player can start, continue, and exit the conversation.
- Authored choices are deterministic and visible in debug state.
- LLM output, if enabled, is treated as presentation/flavor, not authority.

Suggested tests:

- Contact unavailable outside the authored system.
- Contact available inside the authored system.
- Conversation state survives leaving and reopening comms.

## Phase 11D - First Mission Loop

Objective: implement one complete mission with a consequence.

Recommended first mission shape:

```text
Contact asks the player to choose what happens to one piece of route/intel data.
Choice A helps the Commonwealth-style entry hub.
Choice B sells the data to an Index-style archive contact.
```

This proves consequence without needing combat, cargo, economy, or surface content.

Deliverables:

- Mission definition format.
- Mission state machine: unavailable, offered, accepted, resolved, failed.
- One authored contact.
- One mission with two deterministic resolution branches.
- Reputation mutation for at least two factions.
- World-state flag mutation.
- Event log entries for offer, accept, resolve, and consequence.

Acceptance criteria:

- Mission can be offered through cockpit comms.
- Player can accept or decline.
- Player can resolve the mission through a deterministic choice.
- Reputation changes immediately and persists after reload.
- World-state flags persist after reload.
- Reopening comms reflects the resolved outcome.

Suggested tests:

- Fresh save: mission is offered.
- Decline path: state is remembered.
- Resolve path A: faction reputation and world flag match expected values.
- Resolve path B: different faction reputation and world flag match expected values.
- Reload after resolution: contact dialogue reflects the chosen outcome.

## Phase 11E - Validation And Hardening

Objective: stabilize the first RPG loop before expanding.

Deliverables:

- Manual validation checklist.
- Debug commands for resetting only RPG state.
- Save migration placeholder.
- Clear error handling for unknown mission/contact/faction IDs.
- Documentation update with implementation notes and known limits.

Acceptance criteria:

- The full first loop can be tested from a clean save in under five minutes.
- No RPG failure prevents core flight, scale transitions, or rendering.
- Save reset is possible without clearing browser/site data manually.
- Known limitations are documented before moving to expansion phases.

## Expansion Roadmap

Only start these once Phase 11A-E is validated.

### Phase 12 - Crew Foundation

- Ship-resident crew registry.
- Crew spawn/anchor points inside ship.
- Crew relationship/mood state.
- Basic crew dialogue through the same deterministic/LLM split.

### Phase 13 - Economy And Maintenance

- Credits, fuel, parts, hull plates, consumables.
- Trade-good definitions.
- Simple buy/sell or mission reward path.
- Ship condition state.

### Phase 14 - Faction Presence And Patrols

- Faction influence regions around named systems.
- Passive patrol/contact events.
- Reputation-gated hails, docking permission, warnings, and hostility.
- Autonomous faction agenda tick while the game is running.

### Phase 15 - Surface POIs

- Planet POI definition format.
- Orbit scanner/signpost layer.
- One surface settlement or outpost connected to a mission.
- Surface NPC encounter framework.

### Phase 16 - Ship Combat Foundation

- Weapon hardpoints.
- Targeting/lock-on.
- Per-system ship damage model.
- One hostile encounter type.

### Phase 17 - Boarding And Free EVA

- Untethered EVA between ships/structures.
- Boarding trigger.
- Temporary encounter NPCs inside ship/interior spaces.
- Close-quarters combat or non-combat boarding outcome.

### Phase 18 - Larger Simulation

- Faction agendas.
- Emergent faction relationship matrix.
- Economy flow.
- Tier fluidity events.
- Simulation event scheduler that advances only while playing.

### Phase 19 - Ascension Precursor

- Long-term knowledge/contact state.
- Tier 3/Tier 4 trace interactions.
- Conditions for ascension eligibility.
- No full god-phase implementation until the pre-ascension simulation is satisfying.

## Clarifications Still Needed Later

These do not block Phase 11A-E:

- Exact UI treatment for cockpit comms in VR.
- Final names and lore for first MVP system/contact/factions.
- Whether first LLM integration goes through text-only service calls or waits for voice/WebSocket integration.
- Save slot UX.
- How mission authored dialogue is stored: JS modules, JSON, or service-backed content.
- Whether local RPG save data should eventually move to the voice service SQLite, a separate backend, or browser storage plus export/import.

