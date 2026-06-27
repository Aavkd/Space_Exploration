# Phase 21 — Untethered EVA And Derelict Boarding

> **Status:** Implementation and T0–T3 automated verification complete. Manual
> Chromium, normal-control, gamepad, and PCVR/WebXR signoff is
> explicitly owner-performed and remains open until those results are supplied.
> **Dependency evidence:** Phase 18 ship condition/recovery and Phase 4/5
> tethered EVA are implemented. The pre-Phase-21 RPG regression baseline is 74
> passing tests.

## Scope and playable proof

Phase 21 adds one peaceful authored encounter at Wayfarer Exchange. The player
locks `wayfarer_research_derelict`, approaches and stabilizes the ship, leaves
through the existing airlock, crosses a short untethered-EVA gap, enters one
placeholder room, recovers `wayfarer_derelict_ops_log`, exits, and returns.

The proof uses normal cockpit navigation, flight, walking, airlock, EVA, and
contextual interaction controls. Debug APIs inspect and recover the feature but
are never required to complete it.

Explicit exclusions are hostile boarding, close-quarters combat, moving-ship
assault, docking, NPCs, general loot/inventory, procedural interiors, final art,
and life-support-condition scaling.

## Stable IDs and authored limits

- Encounter: `wayfarer_derelict_boarding`
- Derelict: `wayfarer_research_derelict`
- Mission: `wayfarer_derelict_recovery`
- Log: `wayfarer_derelict_ops_log`
- Named system: `drifter_convergence`
- System-local placement: `[0, 0, 43050]`, 250 m inward from the current
  Wayfarer system entry position
- Secure gate: at most 75 m from the derelict and at most 1.5 m/s ship speed
- EVA acceleration: 1.4 m/s²
- EVA maximum speed: 3 m/s; boost is disabled
- Oxygen: 180 active-play seconds; warnings at 60, 30, and 10 seconds
- Range caution: 110 m from the ship; automatic recovery at 150 m
- Placeholder interior: one 12 × 6 × 18 m room

## Authoritative state contracts

The RPG boarding record uses these checkpoints:

`undiscovered → approach → outside → inside → objective_complete → returning → completed`

`outside` is written when the ship is secured and the player exits its airlock.
`inside` is written on entry. `objective_complete` is the exact-once log
transaction. Exiting with the log writes `returning`; boarding the ship resolves
the mission and writes `completed`.

Recovery before log collection returns the player aboard and resets the
checkpoint to `approach` without reverting already-complete objectives. Recovery
after collection completes the return. Oxygen exhaustion and hard-range breach
use the same safe recovery path and never damage the ship or delete progress.

Envelope version 10 contains player-state version 1:

```text
player: {
  version
  location: ship | eva | derelict
  referenceFrame: ship-local | boarding-local | derelict-local
  encounterId
  position[3]
  velocity[3]
  yaw
  pitch
  oxygenRemaining
  oxygenUpdatedAtGameTime
}
```

Positions and velocities are encounter-local, finite, and bounded. Player and
RPG checkpoints are validated together so corrupt mixed-frame saves are
rejected. Version-9 saves migrate to an aboard player, RPG version 8, and an
untouched boarding record. Oxygen advances only from Phase 13 `gameTime`.

Important autosaves occur on discovery, airlock departure, interior entry, log
recovery, interior exit, ship return, explicit/automatic recovery, and the
existing five-second active-play checkpoint.

## Presentation, controls, and failure containment

- The system navigation list pins `Wayfarer Survey Wreck [EVA]`.
- `C`, gamepad Triangle, and XR select retain contextual interaction.
- Untethered movement retains `W/A/S/D` or left stick plus `R/F` or grips.
- `Y`, gamepad Circle, or XR right-face/A invokes explicit safe return.
- Desktop and VR status surfaces show oxygen, ship range, target range,
  checkpoint, and recovery control.
- Hatch and recovery transfers use a short black comfort fade and never force
  camera rotation.
- The ship is halted and cannot be piloted or use hyperdrive while the encounter
  frame is active.
- Boarding runtime or presentation failure produces a visible unavailable state;
  flight, rendering, walking, and ordinary tethered EVA remain usable.

## Acceptance criteria

- Relative-frame motion is finite and stable within the 150 m encounter limit.
- Acceleration and velocity cannot exceed the documented limits.
- Oxygen and range use active-play time and provide clear warning/recovery.
- Every transfer is idempotent or fails descriptively; no player, ship, target,
  objective, log, or event can duplicate.
- Outside, inside, returning, and completed saves restore coherent player and
  encounter state.
- Reset restores an undiscovered encounter without clearing unrelated browser
  storage.
- Existing flight, walking, surface EVA, stations, RPG state, and Phase 18–20
  systems remain functional.

## Automated verification

- [x] T0: all 112 `src/**/*.js` files pass `node --check`.
- [x] T1: placement, locomotion, oxygen, range, transition, recovery, and
  exact-once domain tests pass.
- [x] T2: v9 fixture migration, every checkpoint round trip, corruption,
  storage failure, slot isolation, and reset tests pass.
- [x] T3: navigation/runtime transition failure and prior-domain preservation tests
  pass.
- [x] Complete RPG regression command passes with 83/83 tests:
  `node --experimental-default-type=module --test tests/rpg/*.test.mjs`.

Automated verification was run on 2026-06-27. Expected warning output from the
deliberate storage-failure tests was observed; no test failed. Per owner request,
no browser or device result is claimed by this implementation pass.

## Owner-performed browser and device checklist

- [ ] Start from a clean slot and reach Wayfarer with normal cockpit controls.
- [ ] Lock the `[EVA]` wreck, approach inside 75 m, slow below 1.5 m/s, walk to
  the airlock, and confirm the secure/EVA prompt.
- [ ] Cross with keyboard/mouse, enter, recover the log once, exit, and board.
- [ ] Reload separate saves at outside, inside, returning, and completed.
- [ ] Use explicit return before and after collecting the log; retry the former.
- [ ] Trigger oxygen and hard-range recovery and confirm no damage or duplicate
  log/reward/event.
- [ ] Repeat movement, interaction, and return using a gamepad.
- [ ] In PCVR/WebXR, check sticks, grips, select, right-face return, HUD
  legibility, fades, comfort, and sustained rendering.
- [ ] Recheck ordinary tethered EVA, flight, walking, landing, hyperdrive,
  audio, cockpit stations, and save reset.

## Known limits

- Encounter placement is authored for the current Wayfarer system-entry
  geometry.
- Reload reconstructs the compact encounter relative to the restored ship; the
  broader scale-stack transform is not persisted.
- Oxygen is a fixed EVA-session budget and is not yet coupled to Phase 18 life
  support.
- The derelict has one abstract collision room and placeholder geometry only.
- Manual desktop/gamepad/PCVR evidence is owner-owned, so Phase 21 cannot be
  marked complete until that evidence is recorded.
