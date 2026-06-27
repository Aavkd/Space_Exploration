# Phase 16 — Surface Outpost Vertical Slice

> **Status:** Complete. Automated verification, clean-browser smoke testing, and
> the owner-performed normal-control/gamepad/WebXR checklist are recorded below.
> **Dependencies:** Phase 13 save slots and the shipped true-radius landing /
> surface-EVA stack. Phase 14 supplies the `index_hq` destination. Phase 15's
> shared NPC definition shape is reused for the surface terminal attendant.

## Scope and playable proof

Phase 16 adds one authored surface site to the first terrestrial world in
`Index Relay K-7`. The placeholder site is `K-7 Cartography Annex`, a small
landing pad, mast, equipment shelter, and physical survey terminal.

The normal-control loop is:

1. Travel to `Index Relay K-7` and use the cockpit navigation computer.
2. Select the `K-7 Cartography Annex` scanner contact attached to its authored
   planet. This discovers the site and accepts `K-7 Surface Verification`.
3. Descend using the existing scale transition and follow the same marker from
   low orbit to its landing area.
4. Land inside the safe-area radius, leave through the airlock, and walk to the
   outpost terminal.
5. Press `C`, Triangle, or XR select at the terminal to verify the archive
   beacon.
6. Walk back, board the same ship, then use the physical ship log to report the
   survey and complete the mission.

Debug APIs call the same authoritative runtime and are not required by this
loop.

## Stable content IDs and placement contract

- System: `index_hq`
- Planet: `index_hq_planet_1`
- Surface POI: `index_k7_cartography_outpost`
- Surface NPC/terminal identity: `index_k7_surface_terminal`
- Mission: `index_k7_surface_verification`
- Objectives:
  `discover_k7_outpost`, `land_at_k7_outpost`,
  `access_k7_surface_terminal`, `return_to_ship`,
  `report_k7_surface_survey`
- Successful branch: `survey_reported`

The POI definition owns a fixed latitude/longitude, landing radius, interaction
radius, planet selector, and placeholder visual profile. Runtime placement
converts the authored latitude/longitude to a unit direction and samples the
same `heightAt` terrain function used by rendering, collision, landing, and
walking. The landing pad and terminal are projected independently onto that
surface and oriented to the sampled normal. Reload, re-entry, tile streaming,
and floating-origin rebases therefore cannot change their geographic location.

The definition is returned only for the matching named system, stable planet
ID, terrestrial kind, and landable descriptor. Gas giants and all unrelated
planets return no surface POI.

## State contract

The save envelope advances from version 4 to version 5 and RPG state from
version 3 to version 4. `rpg.surface.byId.index_k7_cartography_outpost` stores:

- `checkpoint`: `undiscovered`, `orbit`, `landed`, `walking`,
  `objective_complete`, `returned`, or `completed`;
- `discoveredAt`, `visitedAt`, `landedAt`, `interactedAt`, `returnedAt`, and
  `completedAt` ISO timestamps or `null`.

Mission objectives remain the detailed authoritative progression. Surface
timestamps are stable discovery/visit evidence and debug visibility, not a
parallel mission state machine. Transitions are monotonic and idempotent.
Unknown POI, planet, mission, objective, and transition IDs fail
descriptively.

Autosaves occur on scan/discovery, first planetary visit, safe-area landing,
surface disembark, terminal interaction, boarding, and final report. The saved
checkpoints deliberately do not invent a new spatial-flight restore system:
reload restores authoritative mission/outpost progress, while the existing app
continues to own scale, ship, and player transforms.

## Marker and interaction contract

- System scale: an outpost scanner contact is colocated with the authored
  planet and carries stable system/planet/POI metadata.
- Planetary orbit/descent: the marker resolves to the terrain-projected landing
  pad and reports range in the existing cockpit navigation HUD.
- Landed/walking: the marker remains at the pad while the contextual interaction
  prompt appears only within the terminal's physical radius.
- Scale changes remap the selected marker by stable POI ID rather than retaining
  a stale coordinate from the prior frame.

The terminal is presentation plus one deterministic `interact` command. It
cannot grant cargo, credits, reputation, damage, or other later-phase state.

## Acceptance criteria

- [x] POI definition and placement are deterministic from named-system and
  planet data.
- [x] The marker is useful at system, orbit, descent, landed, and walking scales.
- [x] Pad and terminal remain terrain-aligned within 0.5 m and the authored
  landing sample stays within the documented slope limit.
- [x] Normal controls complete scan, descent, landing, disembark, terminal
  interaction, return, boarding, and ship-log report.
- [x] Orbit, landed, walking, objective-complete, returned, and completed
  checkpoints round-trip through save/reload.
- [x] Version-4 / RPG-version-3 saves migrate without altering prior missions,
  cargo, fuel, crew, reputation, or world flags.
- [x] Gas giants and unrelated planets receive no surface POI.
- [x] Illegal ordering, wrong system/planet, out-of-range interaction, duplicate
  interaction/report, reset, and corrupt state are tested.
- [x] Existing RPG and surface/landing behavior remains green.
- [x] Browser smoke covers the real renderer, scale/site placement, terminal,
  save/reload, reset, and recovery.
- [x] Keyboard/mouse and gamepad interaction routing pass. Physical PCVR is
  recorded separately when a headset is available.

## Explicit exclusions

No procedural settlements, surface combat, weapons, hostile agents, crowds,
building interiors, markets, docking, roaming NPC schedules, final outpost art,
dynamic terrain deformation, arbitrary surface-site authoring UI, or spatial
ship/player transform persistence is added.

## Manual checklist

- [x] Clean slot: enter Index Relay K-7 and acquire the outpost through the
  physical navigation computer.
- [x] Confirm the scanner marker identifies the correct terrestrial planet and
  remains useful through scale descent.
- [x] Reload the orbit checkpoint and reacquire the same geographic site.
- [x] Land inside the marked safe area; confirm pad/structures are neither
  buried nor floating and reload the landed checkpoint.
- [x] Disembark with `C`, walk to the terminal, and reload before interaction.
- [x] Activate the terminal; reload and confirm it cannot activate twice.
- [x] Return to the ship and board with `C`; reload the returned checkpoint.
- [x] Report at the ship log; reload and confirm exact-once completion.
- [x] Ascend/re-enter and confirm unchanged latitude, longitude, terrain
  alignment, marker identity, and completed state.
- [x] Reset only the active slot and confirm other slots and unrelated browser
  data survive.
- [x] Confirm an unrelated terrestrial planet and a gas giant have no outpost.
- [x] Repeat terminal open/action/close with a gamepad.
- [x] Repeat the changed physical interactions with a PCVR/WebXR controller.
- [x] Confirm flight, walking, landing, scale transition, hyperdrive, audio,
  navigation, comms, cargo, ship log, crew, and prior missions still function.

## Debug API

```js
window.__deepSpaceDebug.surfaceOutpost.getState()
window.__deepSpaceDebug.surfaceOutpost.getDefinition()
window.__deepSpaceDebug.surfaceOutpost.scan()
window.__deepSpaceDebug.surfaceOutpost.sync()
window.__deepSpaceDebug.surfaceOutpost.interact()
window.__deepSpaceDebug.surfaceOutpost.recordBoarded()
window.__deepSpaceDebug.surfaceOutpost.report()
window.__deepSpaceDebug.surfaceOutpost.getPlacement()
window.__deepSpaceDebug.surfaceOutpost.openTerminal()
```

## Verification record

Recorded on 2026-06-27.

```powershell
node --experimental-default-type=module --test tests/rpg/*.test.mjs
node --experimental-default-type=module --check <each touched .js file>
git diff --check
```

- T0 static: all touched JavaScript modules passed `node --check`.
- T1–T3 domain/persistence/integration: 34/34 tests passed. Phase 16 coverage
  includes deterministic placement selection, gas/unrelated-planet exclusion,
  version-4 fixture migration, every saved checkpoint, ordering/range/location
  failures, duplicate actions, corrupt IDs/timestamps, and exact-once report.
- T4 browser: a clean app load at `http://127.0.0.1:5178/` rendered live
  telemetry and the WebGL canvas with no console errors or warnings. The owner
  exercised the real renderer and full surface loop, including all checkpoint
  reloads and reset/recovery.
- T5 manual: the owner completed the full normal-control checklist. Two
  player-facing findings were fixed before signoff: the surface scanner contact
  is now pinned and explicitly labelled `[SURFACE SCAN]`, and ship-log reporting
  recovers a missed return edge for valid aboard saves.
- T6 device: the owner confirmed the gamepad and WebXR physical interaction
  checklist.

## Known limits

- The outpost, pad, mast, shelter, and terminal use primitive placeholder art.
- There is one authored site on one planet; no procedural stamping is enabled.
- Saves persist authoritative visit/objective/return progress, not ship/player
  spatial transforms. Reloading restores coherent mission state and the site
  remains at the same geography, while normal flight owns re-entry.
- The surface terminal has deterministic text only and no market, interior,
  combat, crowd, schedule, voice, or LLM authority.
