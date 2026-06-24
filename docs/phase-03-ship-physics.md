# Phase 03 - Ship Physics Notes

Replaces the placeholder 1-DOF motion in `Ship.update` with a real 6-DOF
rigid-body model, an attractor gravity field, and explicit flight assists. The
ship is now simulated every frame whether or not anyone is piloting.

## Done

- Added `src/ship/ShipPhysics.js`: 6-DOF inertial integrator (quaternion
  orientation, body-frame angular velocity). Forward/back thrust, left/right
  strafe, up/down vertical, pitch/yaw/roll. Inertia is conserved by default.
- Added `src/ship/ShipControls.js`: maps held keys + latched toggles into a ship
  command. No DOM/THREE dependency, so it stays testable and VR-swappable.
- Added `src/space/GravityField.js`: Newtonian point-attractor gravity decoupled
  from any mesh. Sums the nearest attractors, clamps per-attractor acceleration,
  exposes `setGravityScale` and `nearestAttractor` (for the HUD).
- `DeepSpaceEnvironment.getAttractors()` hands out world positions + masses for
  the black hole and the landmark galaxy (masses are a "physics weight" separate
  from visual size).
- `Ship` now owns a `ShipPhysics` instance, exposes `velocity` / `angularVelocity`
  / `speed`, takes a `GravityField`, and is updated every frame in `App._tick`.
- Default flight model is **inertial** (dampeners OFF). Two explicit assists:
  - **Inertial dampeners** (toggle `Z`): flight assist that cancels drift not in
    the commanded thrust direction and brings the ship to rest when no
    translation is commanded. It does **not** fight the thrust axis.
  - **Airbrake** (hold `X`): hard linear + angular brake.
- Speed lines and the warp post-FX are driven by the real ship speed. The warp
  factor is capped by the VR Comfort `warpMax` knob, so F2 always pulls effect
  intensity down.
- F2 panel: `Deep Space` group gained `gravityScale`; `VR Comfort` `warpMax`
  default is now permissive (1) on desktop and `accelerationCap` is wired into
  `ShipPhysics`. (Warp / Deep Space / VR Comfort groups already existed.)
- Added a bottom-left telemetry HUD: camera mode, pilot/dampener state, airbrake,
  speed, angular speed, and nearest-attractor distance + pull.
- Debug camera gained a **pilot chase cam**; pressing `C` engages pilot mode and
  the chase cam, leaving it restores the previous free camera. Pressing `1`/`2`
  also disengages pilot mode.
- Debug hooks for validation: `getShipMotionState`, `getControlsState`,
  `setPilotActive`, `setDampeners`, `sendShipCommand`, `coastShip`,
  `getGravityState`, `haltShip`, `pause`/`resume`/`isPaused`,
  `getWarpSpeedFactor`, `getSpeedLinesOpacity`. `window.__deepSpaceApp` is also
  exposed for poking F2-equivalent config from the console.

### Ship orientation fix (GLB)

The imported `ship.glb` hull faces **+Z** (cockpit/canopy on the +Z end), but the
whole project treats **-Z** as forward (physics thrust, cockpit/window anchors,
speed lines). Left as-is the ship flew tail-first and read as "reversed" in every
camera mode. `ShipModelGLB` now rotates the hull 180 deg about Y before
`normalizeHull`, so the nose leads and the canopy (now ~z = -9) sits near the
cockpit anchor (z = -11.8). Fine interior/anchor alignment is still Phase 4.

## Polish fixes (follow-up)

- **Dampeners reworked into real flight assist**: they cancel drift not aligned
  with the commanded thrust and stop the ship when no translation is commanded,
  but never fight the thrust axis. Previously they capped top speed at
  `forwardForce / rate` (~30 m/s) and felt stuck.
- **GLB nose flip**: imported hull rotated 180 deg about Y so the ship flies
  nose-first in every camera mode (it faced +Z against the project's -Z forward).
- **Debug markers hidden by default**: the Phase 2 anchor spheres (incl. the two
  in the cockpit) and the player scale capsule are off by default; toggle with
  `F3` or `__deepSpaceDebug.toggleDebugMarkers()`.
- **Two independent ship material sliders** in the F2 `Ship` group:
  - `brightness` - scales the hull albedo only (skips the canopy glass).
  - `bloom` - scales the hull's authored emissive (cockpit displays, panel
    lights, engines) into the shared bloom, independent of the global Bloom group.
- **White rectangle floating in front of the ship - fixed**: it was the hull
  mesh `Interior_Divider_Door001`, a thin panel authored with the shared
  "Architectural Glass" material. Its mesh name does not match
  `GLASS_MESH_PATTERN`, so `applyGlassMaterials` never made it transparent and it
  rendered as a solid white card at the nose top (moving with the ship, affected
  by the hull sliders). `ShipModelGLB` now hides these stray divider/door panels
  by name (`STRAY_PANEL_MESH_PATTERN` / `hideStrayPanels`), like `hideFxSprites`
  does for the flame/RCS cards.
- **Canopy glass** also made non-mirror (high roughness, `envMapIntensity` 0.12)
  and excluded from the hull intensity sliders, so it no longer reflects the
  `RoomEnvironment` studio IBL as a bright patch.
- **Telemetry HUD** moved to the top-left so it no longer overlaps the controls
  HUD (bottom-left).
- **Speed lines** fade fully to zero at rest (no opacity floor).

## Controls

| Key | Action |
| --- | --- |
| `C` | Take / leave the controls (pilot mode + chase cam) |
| `W` / `S` | Thrust forward / back |
| `A` / `D` | Strafe left / right |
| `R` / `F` | Vertical up / down |
| Arrows | Pitch (up/down) and yaw (left/right) |
| `Q` / `E` | Roll left / right |
| `Shift` | Throttle boost |
| `Z` | Toggle inertial dampeners |
| `X` | Airbrake (hold) |
| `1` / `2` | Free exterior / interior camera (leaves pilot mode) |

Movement keys only pilot the ship while pilot mode is engaged; otherwise arrows +
`Q`/`E` drive the free debug camera.

## Validation (measured via debug hooks)

- **6-DOF**: thrust `v=[0,0,-21]`, strafe `[13,0,0]`, lift `[0,13,0]`; pitch/yaw/
  roll set angular velocity on x/y/z and rotate the quaternion. All as expected.
- **Inertia on release**: after thrusting to 42 m/s, releasing (dampeners off)
  holds 42 m/s.
- **Unpiloted coast**: with pilot mode off the ship keeps moving (120 m/s ->
  +240 m over 2 s) and is still bent by gravity.
- **Gravity deviation**: parked 1000 m abeam the black hole, coasting, lateral
  velocity bent -18.5 m/s toward it; with `gravityScale = 0`, zero deviation.
- **Dampeners (fixed model)**: ON + forward thrust climbs 42->84->126->168 (free,
  not capped); ON cancels a 60 m/s sideways drift to ~3.6 while the forward axis
  builds; ON + release stops (120 -> 1.8); OFF + release coasts (120 -> 120).
- **Warp / speed lines** track speed (speed-line opacity 0.08 / 0.22 / 0.38 at
  10 / 100 / 600 m/s); warp factor saturates by 600 m/s.
- **F2 reduces intensity**: zeroing warp streak/blur, dropping bloom strength,
  and `gravityScale -> 0` all take effect live; `warpMax` caps the warp factor.

## Manual checklist

1. Serve the project (e.g. `python -m http.server 5177` from
   `D:\Documents\PROJECTS\DEEP_SPACE_VR`) and open it.
2. Confirm the ship flies **nose-first** in all three views (exterior `1`,
   interior `2`, pilot `C`) - not tail-first.
3. Press `C` to take the controls. Fly 6-DOF: `W/S`, `A/D`, `R/F`, arrows for
   pitch/yaw, `Q/E` for roll. The chase cam should bank with the ship.
4. Build up speed with `W`, then release: the ship keeps its speed (inertia).
5. Press `C` again to leave the controls: the ship keeps advancing on its own.
6. Fly toward the black hole / galaxy and watch the trajectory bend (telemetry
   "pull" value rises as you approach).
7. Press `Z` (dampeners ON): you can still accelerate forward freely, sideways
   drift is cancelled, and releasing thrust glides you to a stop. Press `Z` again
   (OFF): inertia is conserved again. Confirm you are never stuck.
8. Hold `X` (airbrake): the ship brakes hard (linear + rotation).
9. Open `F2`: drag Warp sliders, `Deep Space > gravityScale`, and
   `VR Comfort > warpMax`/`accelerationCap`; confirm effects/feel respond live.

## Deferred intentionally

- Walkable interior locomotion and seated cockpit hand-off (Phase 4).
- WebXR / VR comfort locomotion (Phase 5).
- Autopilot beyond "coast on inertia" when unpiloted.
- Aligning the abstract anchors/walkable volumes to the imported interior.
- Collision (ship-vs-attractor, ship-vs-interior).
