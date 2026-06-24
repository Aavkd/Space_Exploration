# Phase 04 - Ship Interior & Relative Motion Notes

Adds a walkable interior, a desktop first-person player, and the
walking <-> piloting <-> EVA transitions, all in the **ship-local reference
frame**. The ship keeps being simulated every frame (Phase 3), so it coasts on
inertia and is bent by gravity while the player walks around inside it.

## Core idea: everything is ship-local

The single hardest requirement of this phase is the player/ship reference-frame
swap. The implementation makes it trivial and robust:

- The `PlayerRig` is **parented to `ship.interiorRoot`**, so the player's pose is
  stored in ship-local coordinates and rides along with every ship translation
  and rotation for free. The player can never be "thrown" by the ship's world
  motion, because that motion doesn't change local coordinates at all.
- `RelativeLocomotion` does *all* of its math in the ship-local frame: "down" is
  always local `-Y`, the walkable footprint is always the same set of local
  rectangles, and pseudo-gravity is a settle toward the local deck. There is no
  world-space gravity vector for the player, so a slowly rotating/translating
  ship leaves interior walking perfectly stable.
- The only local -> world hop is for rendering: `PlayerRig.getCameraWorldPose()`
  refreshes the ancestor matrix chain (ship root -> interior -> rig -> head) and
  decomposes the head's world matrix onto `App.camera` each frame, *after* the
  ship transform was integrated this same frame (no one-frame lag).

```
ShipRoot (position / quaternion / velocity, integrated every frame)
  ShipInterior (interiorRoot)
    PlayerRigLocalToShip (yaw + feet position, ship-local)
      PlayerHead (eye height + pitch)  -> camera world pose
  ShipExterior (imported hull)
  ShipAnchors (cockpit / airlock / spawns)
```

## Done

- **`src/player/RelativeLocomotion.js`** - pure ship-local locomotion + simple
  collision solver. `walk()` does heading-relative XZ movement with per-axis AABB
  sliding against the walkable blockout plus a pseudo-gravity settle to the deck;
  `floatEVA()` does free 6-DOF movement relative to the look direction (still in
  the ship frame). Reports `lastStep` (`grounded`, `blockedX/Z`, `volumeId`) and
  exposes `containsXZ` / `nearestVolumeId` / `clampInside` for spawn safety.
- **`src/player/PlayerRig.js`** (rewrite) - ship-local yaw/pitch/head FPS rig with
  configurable eye height, a wireframe body marker (hidden in first person), and
  `getCameraWorldPose()`.
- **`src/player/PlayerController.js`** - the `WALKING` / `PILOTING` / `EVA` state
  machine. Reads held keys for movement, pointer-lock mouse deltas for look, and
  resolves a single **contextual interact (`C`)** from proximity to the cockpit
  controls and airlock anchors. Piloting and locomotion are **separate states**:
  in `PILOTING` the movement keys are routed to `ShipControls` (Phase 3) and head
  look does not steer the ship; in `WALKING`/`EVA` the ship coasts.
- **`src/ship/ShipInterior.js`** - added `SHIP_WALKABLE_VOLUMES`, a hand-authored
  contiguous AABB collision blockout (zone footprints + two connector volumes).
  Lowered `eyeHeight` to 1.5 m.
- **`src/app/App.js`** - player vs debug camera mode, pointer-lock mouse look,
  correct update order (ship -> camera -> environment -> sky), a center-bottom
  interaction prompt, telemetry now shows `PLAYER:<state>` / `DEBUG:<mode>`, and a
  Phase 4 debug surface on `window.__deepSpaceDebug`.

## States & transitions

| State | Frame | Movement | Look | Notes |
| --- | --- | --- | --- | --- |
| `WALKING` | ship-local | `W/S/A/D` (+Shift run) on the deck | mouse | pseudo-gravity holds the player to the deck; collides with the walkable blockout |
| `PILOTING` | seated at cockpit | `W/S/A/D`, `R/F`, arrows, `Q/E` fly the ship | mouse (free head look, does **not** steer) | enters via `C` near the controls; ship flown by `ShipControls` |
| `EVA` | ship-local (tethered) | `W/S/A/D` + `R/F` look-relative float | mouse | exits via `C` at the airlock; re-enters via `C` near the airlock |

Transition map: `WALKING --C(near controls)--> PILOTING --C--> WALKING`, and
`WALKING --C(near airlock)--> EVA --C(near airlock)--> WALKING`.

## Controls

| Input | Action |
| --- | --- |
| Click canvas | grab mouse (pointer lock); `Esc` or opening `F2` releases it |
| Mouse | look (first person) |
| `W/S/A/D` | walk / strafe (WALKING), thrust / strafe (PILOTING), float (EVA) |
| `Shift` | run (WALKING) / boost (PILOTING, EVA) |
| `R/F` | up / down (PILOTING vertical thrust, EVA vertical float) |
| Arrows, `Q/E` | pitch/yaw, roll - **PILOTING only** |
| `C` | contextual interact: take/leave controls, exit/enter airlock |
| `Z` | inertial dampeners (flight assist) | `X` airbrake (hold) |
| `1` / `2` | debug exterior / interior free camera (mouse released) |
| `V` | return to the first-person player camera |
| `F2` | FX panel | `F3` markers | `F4/F6/F7` Retro/ASCII/Halftone | `P/L` start anim |

## Collision blockout (`SHIP_WALKABLE_VOLUMES`)

A curated set of ship-local XZ rectangles the player center is constrained to
(union, per-axis sliding). It is intentionally **independent of the imported
GLB interior**: the GLB ships its own detailed cabin, but that geometry is not
aligned to the abstract anchors/zones (see phase-02/03 notes), so colliding
against it is out of scope here. The rectangles are tuned to overlap so the whole
interior is traversable, including two connector volumes
(`observationToReactor`, `observationToAirlock`) that bridge the gaps the raw
zone footprints leave.

## Validation (measured via debug hooks)

`window.__deepSpaceApp` and `window.__deepSpaceDebug` expose, among others:
`getPlayerState()`, `getCameraMode()`, `enterPlayerMode()`, `playerInteract()`,
`setPlayerShipLocalPosition([x,y,z])`, `getWalkableVolumes()`, and
`walkPlayer(keyList, seconds)` (drives the player with synthetic held keys).

- **Relative locomotion**: `walkPlayer(['KeyW'], 1)` advances the ship-local
  position along the heading while `coastShip()` keeps the ship moving in world
  space - the two are independent.
- **Collision**: walking into a wall sets `lastStep.blockedX/Z` and the position
  stops at the volume edge; `containsXZ` stays non-null across room seams.
- **Pseudo-gravity stability**: rotating the ship (pilot roll/pitch) does not move
  the player's ship-local position or lift them off the deck (`grounded` stays
  true) - "down" is local `-Y`.
- **Take / leave controls**: `C` near `pilotControls` -> `PILOTING` (`pilotActive`
  true, ship responds to keys); `C` -> back to `WALKING` (ship coasts).
- **EVA**: `C` at the airlock -> `EVA` (free float); `C` near the airlock ->
  `WALKING` at the interior airlock.

## Manual checklist

1. Serve the project (`python -m http.server 5177` from
   `D:\Documents\PROJECTS\DEEP_SPACE_VR`) and open it. Hard-refresh (the
   `ship.glb` is ~140 MB; the hull appears a few seconds after load).
2. You start in first person inside the ship. **Click** the canvas to grab the
   mouse, then look around with the mouse.
3. Walk with `W/S/A/D` (Shift to run). Confirm you stay on the deck and stop at
   the walls; confirm you can move cockpit <-> corridor <-> observation <-> reactor
   and into the airlock.
4. While walking, watch a window: the **stars/galaxies drift past** because the
   ship is still moving (it starts with a gentle -Z drift).
5. Walk to the cockpit; the prompt **"Press C - take the controls"** appears.
   Press `C`. Fly the ship: `W/S` thrust, `A/D` strafe, arrows pitch/yaw, `Q/E`
   roll. The whole cockpit view banks with the ship.
6. Press `C` to leave the controls: you stand up next to the seat and the ship
   **keeps coasting** on its own.
7. Fly/coast toward the black hole or landmark galaxy and confirm the trajectory
   bends (telemetry "pull" rises) - external gravity still acts while you walk.
8. Walk to the airlock; the prompt **"Press C - exit through the airlock (EVA)"**
   appears. Press `C` to float outside (`W/S/A/D` + `R/F`). Return near the
   airlock and press `C` to step back in - the interior is coherent and you are
   not left behind by the moving ship.
9. Press `1`/`2` for the debug free cameras, `V` to return to the player. Open
   `F2` and confirm the mouse is released for the panel and tweaks still apply.

## Limits & scale notes (deferred / known)

- **Collision is a center-point blockout**, not a capsule sweep: the player
  *center* is constrained to the walkable rectangles, so there is no player-radius
  standoff from walls and no collision against the detailed GLB interior, props,
  furniture, or the cockpit seat. Walls live at the abstract zone edges.
- **EVA is tethered to the ship frame** (relative, not world-space). Exiting does
  not detach the player into world coordinates, so the ship cannot fly away and
  leave the player behind. True world-frame EVA with station-keeping is deferred.
- **No vertical traversal** (no stairs/jump/ladders); the interior is a single
  deck at `y = 0`. No door/airlock animation or pressurization state machine yet.
- **Anchors are still the abstract blockout**, not aligned to the imported GLB
  cabin (carried over from Phase 2/3); the cockpit seated pose is positioned over
  the seat footprint, not snapped to the modeled seat.
- **No head-upright comfort option**: while piloting/standing in a rolling ship
  the player's horizon rolls with the deck (physically correct, but a VR comfort
  pass in Phase 5 should offer an upright-head option).
- **No physical ship-vs-interior or ship-vs-attractor collision** (Phase 3/later).

## Deferred intentionally

- WebXR / VR controllers and comfort locomotion (Phase 5).
- Collision against the modeled GLB interior, props, and a real player capsule.
- World-frame (untethered) EVA and a proper airlock pressurization sequence.
- Diegetic in-cockpit UI and seated hand interactions.
