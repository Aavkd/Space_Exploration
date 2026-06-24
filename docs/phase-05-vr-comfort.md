# Phase 05 - VR & Comfort Notes

Adds a first WebXR layer on top of the Phase 4 ship-local interior model. The
desktop path remains the development companion: F2 is still a DOM panel for
post-FX and comfort tuning, while the headset gets only a minimal in-world
status panel.

## Done

- **WebXR session support** via `src/xr/XRExperience.js`: `renderer.xr.enabled`,
  `local-floor` reference space, `VRButton`, controller rays, controller grips,
  and session start/end callbacks.
- **Desktop / VR split**: desktop renders through `EffectComposer`
  (Bloom -> Warp -> Retro -> ASCII -> Halftone). In the headset, the stable path
  is direct WebXR rendering because composer-style post-FX can produce a black
  headset frame. The current `XR Visual FX` controls are useful only as
  temporary diagnostics and visual placeholders. They are not the final answer
  for bloom or pixelation. The future no-compromise visual target is documented
  in `docs/phase-06-xr-post-fx-pipeline.md`: desktop visual parity first,
  build/dependencies allowed, required Bloom/Retro Pixel/Color Depth/Scanlines/
  Warp, and no silent fallback to plain direct rendering for that feature.
- **XR controller input** via `src/input/WebXRInput.js`: thumbsticks, trigger
  select, and grips normalized into the same command shape used by the existing
  player and ship controllers.
- **Gamepad in VR**: the browser Gamepad API continues to update during XR
  sessions. A DualSense/standard gamepad keeps the exact desktop mapping in VR;
  XR controller axes are used only when no gamepad is connected.
- **Comfort locomotion**: `vr_safe` uses snap turn at 30 degrees by default,
  optional smooth turn capped by F2, walk speed capped to 1.4 m/s, no run/boost
  in comfort mode, and ship acceleration capped to 18.
- **VR-safe preset**: `POST_FX_PRESETS.vrSafe` is now a movement comfort preset,
  not a visual override. Entering VR no longer applies it automatically.
- **F2 preset controls**: `desktop_default` and `vr_safe` buttons, plus exposed
  VR Comfort controls for rotation mode, snap angle, smooth turn rate, walk
  speed, comfort vignette, acceleration cap, speed-line max opacity, and
  controller spheres, VR user scale, and a dedicated `XR Visual FX` tuning group.
- **VR HUD** via `src/ui/DiegeticStatusPanel.js`: a camera-attached bottom-left
  canvas texture HUD showing display mode, player state, speed, pilot/dampener
  state, active preset, and contextual action. It is hidden on desktop and can
  be toggled with `H`.
- **VR scale / controller markers**: F2 `VR Comfort` exposes
  `controllerSpheresVisible` for the controller grip spheres and pointer rays,
  and `vrUserScale` for headset/controller pose scale. Default `vrUserScale` is
  `0.55` so the player reads smaller relative to the compact ship interior;
  adjust live in VR.

## Controls

| Mode | XR input | Action |
| --- | --- | --- |
| Walking | Left stick | Walk / strafe in the ship-local frame |
| Walking | Right stick | Snap or smooth turn, according to F2 |
| Walking | Trigger / select | Contextual interact |
| Piloting | Left stick | Thrust / strafe |
| Piloting | Right stick | Pitch / yaw |
| Piloting | Left grip / right grip | Lift down / lift up |
| EVA | Left stick | Look-relative float / strafe |
| EVA | Left grip / right grip | Float down / up |

Roll is intentionally disabled for XR controller flight in this phase. Desktop
keyboard and DualSense controls are unchanged, including in VR.

Standard gamepad in VR:

| Mode | Gamepad input | Action |
| --- | --- | --- |
| Walking / EVA | Left stick | Move / strafe |
| Walking / EVA | Right stick | Same as desktop gamepad look |
| Walking / EVA | Triangle | Contextual interact |
| Piloting | L2 / R2 | Reverse / forward thrust |
| Piloting | L1 / R1 | Yaw left / right |
| Piloting | Left stick | Pitch / roll |
| Piloting | Right stick | Same as desktop head/camera look |
| Piloting | D-pad left / right | Strafe left / right |
| Piloting | D-pad up / down | Lift up / down |
| Piloting | Cross / Circle | Boost / airbrake |
| Piloting | Square | Toggle dampeners |

## Debug hooks

`window.__deepSpaceDebug` adds:

- `getDisplayMode()`
- `getVrState()`
- `applyFxPreset(name)`
- `getActivePreset()`
- `getComfortState()`
- `getDiegeticPanelState()`
- `getVrHudState()`
- `toggleVrHud()`

## Manual checklist

1. Serve the project from `D:\Documents\PROJECTS\DEEP_SPACE_VR`:
   `python -m http.server 5177`.
2. Open `http://localhost:5177/` in a WebXR-capable browser.
3. Desktop sanity: walk with `W/S/A/D`, interact with `C`, open `F2`, and apply
   both `desktop_default` and `vr_safe`.
4. Compare presets: `desktop_default` and `vr_safe` should both keep the visual
   identity active. `vr_safe` only tightens movement/acceleration comfort.
5. Enter VR from the WebXR button. Confirm the scene starts in player mode inside
   the ship and the VR HUD is bottom-left rather than floating in the world.
6. Walk inside the ship with either XR left stick or a connected gamepad left
   stick. Confirm `H` toggles the VR HUD and the HUD stays bottom-left in view.
7. Open F2 on desktop and adjust `VR Comfort > vrUserScale` while in VR until
   the ship/player scale feels right. Toggle `controllerSpheresVisible` to hide
   or show the controller grip spheres and pointer rays.
8. Use trigger/select near the cockpit controls to take and leave controls.
9. While piloting with XR controllers, use left stick for thrust/strafe, right
   stick for pitch/yaw, and grips for vertical lift. With gamepad, confirm the
   previous DualSense mapping still applies.
10. Keep experimental XR post-FX disabled for normal VR checks. If any
   composer-style or `realPostFxEnabled` path shows black in the headset, treat
   it as a known failed experiment rather than a value-tuning problem. The
   future implementation target is Phase 06.
11. Use trigger/select at the airlock to exit and re-enter. Confirm the player
   remains in the ship-local reference frame and the ship continues to exist.
12. Exit the XR session. Confirm the previous desktop F2 config is restored and
    the DOM F2 panel still works.

## Comfort issues left open

- The GLB hull is still heavy for VR; a decimated/LOD version is needed before
  performance can be considered final.
- HMD physical room-scale offsets are not capsule-collided against the abstract
  walkable volumes; joystick locomotion is constrained, but leaning can clip.
- No head-upright stabilization while the ship rolls. The view remains physically
  attached to the ship frame.
- Cockpit interaction is contextual select only; no hand-tracked grabbing or
  physical controls yet.
- The comfort vignette is optional and screen-attached. It should be tested on a
  real headset before making it a final default.
