# Phase 02 - Ship Design Notes

## Done

- Added `docs/ship-design.md` as the ship design contract.
- Added `src/ship/ShipInterior.js` with dimensions, zones, required anchors, anchor validation, and debug markers.
- Added `src/ship/ShipModel.js` with a procedural blockout: cockpit, circulation area, observation windows, airlock, reactor bay, aft engine block, side pods, and four visible thrusters.
- Updated `src/ship/Ship.js` so the ship keeps autonomous movement while using the procedural model and exposing anchor APIs.
- Updated `src/player/PlayerRig.js` to spawn from `interiorSpawn` and use a human-scale debug marker.
- Added debug camera modes: `1` exterior follow/orbit offset and `2` interior ship-local camera.
- Added `assets/ship/manifest.json` with parts, roles, dimensions, zones, anchors, and VR constraints.

## Update - imported GLB ship (active variant)

The procedural blockout is kept but is no longer the ship shown by default. The
active ship is now an imported model (`ship.glb`, a Star Citizen hull converted
from `.ctm` via Blender). The blockout is retained as the design contract and as
a selectable fallback: `new Ship({ variant: 'procedural' })`.

### Changed

- Added `src/ship/ShipModelGLB.js`. Loads `./ship.glb` via `GLTFLoader`,
  normalizes it to the 34 m design length, recenters it on the ship root, and
  returns the same model bundle shape as the procedural builder. The anchor/zone
  frame from `ShipInterior.js` is reused unchanged, so the debug cameras and
  anchor validation keep working while the heavy mesh streams in asynchronously.
- `src/ship/Ship.js` is now variant-aware (`SHIP_VARIANTS = ['glb','procedural']`,
  default `glb`) and exposes `ready` (resolves when the GLB finishes loading).
- Materials: authored materials/textures are preserved. A dark hull material is
  only applied as a fallback when a GLB ships with no materials (e.g. a mesh-only
  `.ctm` conversion). All ship materials are forced `DoubleSide`.
- Environment lighting: `App._setupEnvironmentLighting()` builds a
  `RoomEnvironment` PMREM and assigns `scene.environment`, so PBR/metal materials
  reflect something instead of rendering near-black. Tuned per material via
  `envMapIntensity`.
- Glass: the cockpit canopy is made transparent by cloning its material on the
  canopy meshes (matched by mesh name, e.g. `Cockpit_Cupola_Glass`). The shared
  `Architectural Glass` material stays opaque on the props that also use it
  (freezer, oven, shower door, engine body).
- Animation: the GLB ships one clip, `Spaceship_Start_Sequence` (TRS + morph
  weights + a skin). An `AnimationMixer` is built on load, advanced every frame
  in `Ship.update()`, and the startup sequence auto-plays once (clamped at end).
- FX sprites: the engine flame (`Fire_Mat.*`) and RCS jet (`RCS_Thruster.001`,
  `Hyperdrive_FX`) sprite cards are authored opaque/blend and looked like flat
  patches on the hull while idle, so they are hidden by default and can be
  toggled back on.
- F2 panel: new `Ship` group with `envMapIntensity` and `glassOpacity` sliders,
  both saved/loaded with the JSON preset. Defaults live in
  `config/postFxPresets.js` under `ship`.

### Controls / debug

- `P` replay the start sequence, `L` toggle looping it.
- `window.__deepSpaceDebug.toggleEngineFx()` /
  `window.__deepSpaceDebug.setEngineFxVisible(true)` show the hidden FX sprites.

### Model stats / caveats

- ~1.5M triangles, 337 nodes, 61 materials, 83 textures, ~140 MB file.
- Every material is `DoubleSide` and there is no LOD. This is fine for desktop
  but heavy for the Phase 5 VR pass; a decimated/LOD variant will be needed.
- The GLB has its own detailed interior, but the anchors are still the abstract
  blockout frame and are not yet aligned to the imported interior (Phase 4).

## Manual checklist

1. Run `python -m http.server 5177` from `D:\Documents\PROJECTS\DEEP_SPACE_VR`.
2. Open `http://localhost:5177/`.
3. Verify the Deep Space scene still appears with bloom/post FX and the ship visible near the origin.
4. Press `1`, use arrow keys and `Q/E`, and inspect the exterior silhouette, side pods, airlock door, and aft thrusters.
5. Press `2`, use arrow keys and `Q/E`, and inspect the cockpit, corridor, windows, airlock, and reactor bay from inside.
6. Open DevTools and run `window.__deepSpaceDebug.validateShipAnchors()`; expected `ok: true`.
7. Run `window.__deepSpaceDebug.getShipAnchorNames()` and verify the six required anchors exist.
8. Compare the player wire capsule to the corridor/cockpit scale; it should read as human scale.
9. Press `F2` and verify the tweak panel still opens after the ship changes.

### GLB ship checklist

1. Hard-refresh (the `ship.glb` is ~140 MB; the ship appears a few seconds after load).
2. Confirm the imported hull is visible, lit (not a black silhouette), and shows its textures.
3. Confirm the cockpit canopy is transparent and reveals the interior; other props stay opaque.
4. Confirm the startup sequence plays once on load; press `P` to replay, `L` to loop.
5. Confirm there are no flat gray/brown sprite patches on the hull (engine/RCS FX hidden).
6. Open `F2` -> `Ship` and drag `envMapIntensity` and `glassOpacity`; both update live.
7. Optional: `window.__deepSpaceDebug.toggleEngineFx()` shows the hidden FX sprites.

## Deferred intentionally

- GLB authoring/export pipeline (the active model was imported, not produced here).
- Engine/RCS FX as proper additive flames driven by thrust (currently hidden).
- LOD / decimated mesh for VR performance.
- Aligning anchors and walkable volumes to the imported interior.
- Real collision/locomotion inside the ship.
- Door animation and airlock state machine.
- Physical ship controls and seated pilot mode.
- VR controller interactions and WebXR comfort pass.
