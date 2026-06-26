# Deep Space VR

Deep Space VR is a no-build Three.js space exploration prototype built for desktop and PCVR. It combines a seeded procedural universe, a walkable ship interior, inertial 6-DOF flight, hyperdrive-scale traversal, and a custom WebXR post-processing path that preserves the project's retro deep-space visual identity in VR.

![Desktop cockpit near black hole](docs/assets/desktop-visual-reference-blackhole-cockpit.png)

## Highlights

- Browser-first ES module app with no bundler or install step.
- Seeded procedural universe with stars, galaxies, nebulae, black holes, pulsars, anomalies, POI markers, and live regeneration controls.
- Walkable ship interior with ship-local movement, piloting, and tethered EVA transitions.
- Autonomous ship simulation with inertia, gravity attractors, dampeners, airbrake, boost, and hyperdrive.
- Desktop post-FX stack plus a custom WebXR render path for bloom, retro pixel treatment, scanlines, color depth, and speed-scaled warp.
- Hyperdrive-responsive star-field aberration and Doppler/beaming, tunable from the F2 `Relativistic Stars` group.
- DualSense / standard gamepad support, WebXR controller support, and runtime debug hooks.
- Live tuning panels: `F2` for post-FX, comfort, XR, and ship tuning, and `F10` for universe generation, presets, import/export, and regeneration.

## Run

This project is served as static files. From the repo root:

```powershell
python -m http.server 5177
```

Then open [http://localhost:5177/](http://localhost:5177/).

## Voice Service

The Phase 09 voice assistant service lives in [services/voice-ai/README.md](/D:/Documents/PROJECTS/DEEP_SPACE_VR/services/voice-ai/README.md).

Quick start from `services/voice-ai`:

```powershell
docker compose up --build
```

Then open [http://localhost:8000/dashboard](http://localhost:8000/dashboard).

Notes:

- There is no `package.json` because Three.js is loaded from a CDN import map in `index.html`.
- First load can take a few seconds because `ship.glb` is large and streams in asynchronously.
- A modern Chromium browser is the safest choice for desktop, Gamepad API, and WebXR support.

## Controls

### On foot and EVA

| Input | Action |
| --- | --- |
| Click canvas | Capture mouse |
| Mouse | Look |
| `W` / `A` / `S` / `D` | Walk / strafe or EVA float |
| `Shift` | Run on foot |
| `R` / `F` | EVA up / down |
| `C` | Contextual interact: take controls, leave controls, exit airlock, re-enter ship |
| `T` | Teleport/toggle inside-outside EVA for testing |
| `V` | Return to the first-person player camera |

### Piloting

| Input | Action |
| --- | --- |
| `C` | Take / leave ship controls |
| `W` / `S` | Thrust forward / reverse |
| `A` / `D` | Strafe left / right |
| `R` / `F` | Lift up / down |
| Arrow keys | Pitch / yaw |
| `Q` / `E` | Roll |
| `Shift` | Boost |
| `Z` | Toggle dampeners |
| `X` | Airbrake |
| `Space` | Toggle hyperdrive |

### Debug and panels

| Input | Action |
| --- | --- |
| `1` | Exterior debug camera |
| `2` | Interior debug camera |
| `F2` | Post-FX / comfort / XR / ship panel |
| `F10` | Universe panel |
| `F3` | Toggle debug markers |
| `F4` | Toggle retro effect |
| `F6` | Toggle ASCII effect |
| `F7` | Toggle halftone effect |
| `P` | Replay ship startup animation |
| `L` | Toggle ship animation loop |
| `H` | Toggle VR HUD |

### Gamepad and VR

- DualSense and standard gamepads are supported on desktop and in VR.
- In VR, XR controllers are used when no gamepad is connected.
- The project targets PCVR and includes a custom WebXR post-FX route validated for Quest 3 streaming according to [docs/phase-06-xr-post-fx-pipeline.md](docs/phase-06-xr-post-fx-pipeline.md).

## Project structure

```text
assets/
  config/          Runtime JSON overrides
  ship/            Ship manifest / design contract
docs/              Phase notes, specs, and design references
src/
  app/             App orchestration and lifecycle
  config/          Default config and presets
  input/           Gamepad and WebXR input adapters
  player/          Walking, piloting, EVA, and camera rig
  postprocessing/  Custom shaders
  rendering/       Desktop and XR render pipelines, panels, HUD helpers
  ship/            Ship entity, physics, controls, model loading, interior
  space/           Procedural universe facade, gravity, and landmarks
  ui/              Diegetic HUD and navigation markers
  xr/              WebXR session and visual FX glue
```

## Configuration and debugging

- Optional startup overrides are loaded from [assets/config/post_processing.json](assets/config/post_processing.json) and [assets/config/universe.json](assets/config/universe.json).
- Runtime presets live in `src/config/`.
- The app exposes `window.__deepSpaceApp` and `window.__deepSpaceDebug` for inspection and scripted validation.

Examples:

```js
window.__deepSpaceDebug.getRenderPipelineState();
window.__deepSpaceDebug.getUniverseState();
window.__deepSpaceDebug.toggleHyperdrive();
window.__deepSpaceDebug.applyUniversePreset('dense_cluster');
```

## Documentation map

- [docs/project-foundation.md](docs/project-foundation.md) - project conventions and source of truth
- [docs/phase-02-ship-design.md](docs/phase-02-ship-design.md) - ship model and hull integration
- [docs/phase-03-ship-physics.md](docs/phase-03-ship-physics.md) - 6-DOF flight and gravity
- [docs/phase-04-ship-interior.md](docs/phase-04-ship-interior.md) - interior walking, piloting, EVA
- [docs/phase-05-vr-comfort.md](docs/phase-05-vr-comfort.md) - WebXR layer and comfort model
- [docs/phase-06-xr-post-fx-pipeline.md](docs/phase-06-xr-post-fx-pipeline.md) - custom XR post-processing path
- [docs/phase-07-procedural-universe.md](docs/phase-07-procedural-universe.md) - procedural universe architecture
- [docs/phase-08-ship-speed-and-hyperdrive.md](docs/phase-08-ship-speed-and-hyperdrive.md) - speed regime and hyperdrive design
- [docs/phase-11-rpg-roadmap.md](docs/phase-11-rpg-roadmap.md) - RPG implementation roadmap and first comms mission slice

## Current caveats

- The imported ship mesh is heavy for VR and may need a decimated or LOD variant for sustained headset performance.
- The interior collision model is an abstract ship-local blockout, not full collision against the authored GLB interior.
- Untethered world-frame EVA, full physical hazards, and a 3D radar/map are still future work.
