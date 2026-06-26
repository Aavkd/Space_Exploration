# Phase 11 - RPG Roadmap

> **Status:** Phase 11A, 11B, 11C, and 11D implemented; Phase 11E is the next RPG slice.
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

**Implementation status:** Complete as of 2026-06-26.

Objective: create the minimal data and persistence layer needed by every future RPG feature.

Deliverables:

- `src/rpg/` module boundary. **Implemented.**
- `RpgState` model with schema/version number. **Implemented with version `1`.**
- Local save/load adapter. **Implemented with `localStorage` key `deep-space-vr:rpg-state:v1`.**
- Event log with append-only deterministic events. **Implemented with sequential `event-000001` IDs.**
- Faction registry with reputation values. **Implemented with the six locked Tier 2 factions.**
- Named system registry with placeholder authored system IDs. **Implemented with the ten MVP role IDs.**
- Debug access through `window.__deepSpaceDebug`. **Implemented under `window.__deepSpaceDebug.rpg`.**

Debug API:

```js
window.__deepSpaceDebug.rpg.getState();
window.__deepSpaceDebug.rpg.getFaction('commonwealth');
window.__deepSpaceDebug.rpg.getReputation('commonwealth');
window.__deepSpaceDebug.rpg.adjustReputation('commonwealth', 0.25, 'manual-test');
window.__deepSpaceDebug.rpg.appendEvent('debug.test', { ok: true });
window.__deepSpaceDebug.rpg.reload();
window.__deepSpaceDebug.rpg.reset();
```

The compact RPG summary is also mirrored into `#deep-space-debug-state` as `rpg`, including version, reputation values, event count, and named-system count.

Acceptance criteria:

- A new game creates a deterministic initial RPG state.
- Reputation can be changed and read back.
- Event log entries can be appended and inspected.
- Reloading the page restores the local RPG state.
- Save data includes a version number for future migrations.

Known limits:

- No comms UI, missions, contacts, bespoke authored-system content, or simulation ticks exist yet.
- There is one implicit local save only; multiple save slots and backend migration remain deferred.
- Corrupt or unsupported save data falls back to a fresh state and logs a warning.

Suggested tests:

- Unit-style browser/debug test for state creation.
- Manual reload test: mutate reputation, refresh, verify persistence.
- Corrupt/missing save fallback test.

## Phase 11B - Authored System Anchor

**Implementation status:** Complete as of 2026-06-26.

Objective: make one authored system reachable in the existing procedural universe.

Deliverables:

- One MVP named system definition, using placeholder names if needed. **Implemented as `entry_hub` / `Port Meridian`.**
- Fixed seed override or deterministic placement hook. **Implemented with fixed root-universe position `[12000, 1400, -18000]` and child seed `rpg-entry-hub-v1`.**
- System metadata exposed through existing POI/navigation surfaces. **Implemented through `Universe.getAuthoredSystemPOIs()`, `Universe.getPOIs()`, and `[RPG]` navigation markers.**
- RPG metadata available when the player enters the system. **Implemented through system debug state, current-node RPG payloads, and `window.__deepSpaceDebug.rpg.getActiveNamedSystem()`.**

Acceptance criteria:

- The authored system appears consistently across runs. **Verified by browser smoke test.**
- The player can navigate to it using existing universe markers. **Implemented; `Port Meridian [RPG]` is reserved a navigation slot.**
- Entering the system exposes its RPG metadata in debug state. **Verified by forced descent smoke test; active named system becomes `entry_hub`.**
- The system still behaves like a normal scale-stack system for flight, gravity, and descent/ascent. **Implemented by injecting the anchor into the standard star-system descent candidate flow.**

Suggested tests:

- Regenerate/reload consistency check.
- Debug state shows active named system ID.
- Existing procedural systems still spawn normally.

Implementation notes:

- `entry_hub` now carries display name, navigation label, fixed position, fixed system seed, and star profile in `src/rpg/registries.js`.
- Root `StarField` injects authored named-system anchors into the same `systemAnchors` list used by procedural systems. Galaxy-level star fields do not receive root authored anchors.
- `Universe.getPOIs()` reserves room for authored systems so the first RPG anchor is discoverable through the existing navigation overlay.
- `SystemContents.getCurrentNode()` and `getDebugState()` expose the RPG payload after descent.
- `RpgRuntime` tracks `activeNamedSystemId` as transient runtime context; it is not persisted into local save data.
- Browser smoke test on 2026-06-26 loaded the app through local static server, confirmed no console/page errors, found `Port Meridian` in `getUniverseState().authoredSystems`, and confirmed forced descent exposes `entry_hub` as the active named system.

Known limits:

- The authored system does not yet add bespoke planets, stations, POIs, NPCs, comms, or missions. Those remain Phase 11C and later.
- The first anchor uses placeholder naming and a fixed root-space position; final lore names and broader authored placement rules can be revised later.
- The authored star is currently represented through navigation/POI data, not a unique visible star mesh distinct from the normal star field.

## Phase 11C - Cockpit Comms Interaction

**Implementation status:** Complete as of 2026-06-26.

Objective: add the first physical RPG interaction point: cockpit comms.

Deliverables:

- A comms station interaction trigger in the ship/cockpit flow. **Implemented as the `commsStation` ship anchor and `openComms` contextual action.**
- Minimal comms UI or diegetic panel state. **Implemented as the `Cockpit Comms` DOM panel owned by `App`.**
- One contact NPC reachable only in the authored system. **Implemented as `port_meridian_harbormaster` / `Harbormaster Vale`, available only in `entry_hub`.**
- Deterministic authored dialogue choices for mission-critical beats. **Implemented through authored contact dialogue nodes and choices.**
- Optional LLM flavor text path, gated so it cannot mutate mission state directly. **Implemented as a disabled-by-default stub with no backend calls.**

Debug API:

```js
window.__deepSpaceDebug.rpg.getContacts();
window.__deepSpaceDebug.rpg.getCommsState();
window.__deepSpaceDebug.rpg.openComms();
window.__deepSpaceDebug.rpg.openComms('port_meridian_harbormaster');
window.__deepSpaceDebug.rpg.chooseComms('ask_port_meridian');
window.__deepSpaceDebug.rpg.closeComms();
window.__deepSpaceDebug.rpg.setCommsLlmFlavorEnabled(true);
```

Acceptance criteria:

- Player can enter the authored system and use cockpit comms. **Implemented.**
- Contact appears only when context rules allow it. **Implemented; no contacts are reachable outside `entry_hub`.**
- Player can start, continue, and exit the conversation. **Implemented; conversation node state persists in the local RPG save.**
- Authored choices are deterministic and visible in debug state. **Implemented through `getCommsState()` and the mirrored debug JSON.**
- LLM output, if enabled, is treated as presentation/flavor, not authority. **Implemented as a stub `{ enabled, source: 'stub', text: null }`; no live LLM calls are made.**

Suggested tests:

- Contact unavailable outside the authored system.
- Contact available inside the authored system.
- Conversation state survives leaving and reopening comms.

Implementation notes:

- `src/rpg/contacts.js` defines the first comms contact and authored dialogue tree.
- `RpgRuntime` owns contact availability, active comms state, deterministic dialogue choices, and the LLM flavor gate.
- RPG save version remains `1`; contact and comms fields are additive and older v1 saves sanitize forward with defaults.
- `#deep-space-debug-state.rpg.comms` mirrors available contacts, active contact, current node, visible choices, and LLM flavor gate state.
- The comms panel can be opened through the cockpit comms station, `C` / Triangle / XR select, or debug hooks.

Known limits:

- Phase 11C does not create missions, reputation consequences, world flags, voice playback, or live LLM/service calls.
- `Harbormaster Vale` is placeholder first-slice content and can be renamed or rewritten when final Port Meridian lore is authored.
- The comms station is an abstract cockpit anchor and DOM panel, not a bespoke GLB terminal mesh.
- Gamepad/XR can open the panel, but deterministic choice selection is currently keyboard/click-first.

## Phase 11D - First Mission Loop

**Implementation status:** Complete as of 2026-06-26.

Objective: implement one complete mission with a consequence.

Recommended first mission shape:

```text
Contact asks the player to choose what happens to one piece of route/intel data.
Choice A helps the Commonwealth-style entry hub.
Choice B sells the data to an Index-style archive contact.
```

This proves consequence without needing combat, cargo, economy, or surface content.

Deliverables:

- Mission definition format. **Implemented in `src/rpg/missions.js`.**
- Mission state machine: unavailable, offered, accepted, resolved, failed. **Implemented in `RpgRuntime`.**
- One authored contact. **Implemented through `port_meridian_harbormaster`.**
- One mission with two deterministic resolution branches. **Implemented as `port_meridian_route_packet` / `A Clean Copy`.**
- Reputation mutation for at least two factions. **Implemented for `commonwealth` and `index`.**
- World-state flag mutation. **Implemented under `worldFlags` with `port_meridian.*` keys.**
- Event log entries for offer, accept, resolve, and consequence. **Implemented with `mission.offered`, `mission.accepted`, `mission.resolved`, and `mission.consequence`.**

Debug API:

```js
window.__deepSpaceDebug.rpg.getMissions();
window.__deepSpaceDebug.rpg.getMission('port_meridian_route_packet');
window.__deepSpaceDebug.rpg.offerMission('port_meridian_route_packet');
window.__deepSpaceDebug.rpg.acceptMission('port_meridian_route_packet');
window.__deepSpaceDebug.rpg.resolveMission('port_meridian_route_packet', 'commonwealth');
window.__deepSpaceDebug.rpg.resolveMission('port_meridian_route_packet', 'index');
window.__deepSpaceDebug.rpg.failMission('port_meridian_route_packet', 'declined');
```

Acceptance criteria:

- Mission can be offered through cockpit comms. **Implemented through `ask_work`, which offers the mission and opens the offer node.**
- Player can accept or decline. **Implemented through `accept_route_packet` and `decline_route_packet`.**
- Player can resolve the mission through a deterministic choice. **Implemented through `resolve_route_commonwealth` and `resolve_route_index`.**
- Reputation changes immediately and persists after reload. **Implemented through persisted faction reputation deltas.**
- World-state flags persist after reload. **Implemented through persisted `worldFlags`.**
- Reopening comms reflects the resolved outcome. **Implemented by moving the contact conversation to the branch-specific resolved node.**

Suggested tests:

- Fresh save: mission is offered. **Covered by RPG runtime smoke test through `ask_work`.**
- Decline path: state is remembered. **Covered by RPG runtime smoke test; mission status becomes `failed` with outcome `declined`.**
- Resolve path A: faction reputation and world flag match expected values. **Covered by RPG runtime smoke test; Commonwealth +0.18, Index -0.08, owner `commonwealth`.**
- Resolve path B: different faction reputation and world flag match expected values. **Covered by RPG runtime smoke test; Index +0.18, Commonwealth -0.08, owner `index`.**
- Reload after resolution: contact dialogue reflects the chosen outcome. **Implemented through persisted mission/contact conversation state; browser reload validation remains part of Phase 11E.**

Implementation notes:

- `src/rpg/missions.js` defines mission IDs, legal statuses, branch consequences, reputation deltas, and world flag mutations.
- RPG save version remains `1`; mission fields are additive and older v1 saves sanitize forward with default mission state.
- `RpgRuntime` exposes explicit mission helpers for debugging and scripted validation, while comms dialogue choices use the same helpers through deterministic `missionAction` metadata.
- The first mission starts unavailable, becomes offered when the player asks Harbormaster Vale for work, can be accepted or declined, and resolves immediately through one of two deterministic data-routing choices.
- Consequences are intentionally small but persistent: reputation changes, route-packet owner flags, and deterministic event log entries.

Known limits:

- The mission is a single comms-only proof of consequence; it does not require cargo, docking, travel, timers, combat, economy, rewards, or surface POIs.
- Decline is represented by the existing `failed` mission status with outcome `declined`; a distinct declined status can be added later if the content model needs it.
- There is no bespoke Index contact yet. The Index branch is represented as an archive channel inside Harbormaster Vale's authored comms flow.
- Browser reload validation and broader hardening are deferred to Phase 11E.

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
