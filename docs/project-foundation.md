# Deep Space VR Project Foundation

## Source of truth

This project is founded from the Racing Deep Space documents:

- `D:\Documents\PROJECTS\Racing\docs\deep-space-extraction-reference.md`
- `D:\Documents\PROJECTS\Racing\docs\deep-space-fx-inventory.md`

Racing is treated as a laboratory, not as an architecture to copy wholesale. The first foundation keeps the Deep Space identity: black void, galaxies, nebulae, black hole/anomaly placeholders, huge scale, runtime visual tweaking, and a ship that exists independently from the player.

## Current structure

```text
assets/
  config/
docs/
src/
  app/
  config/
  player/
  rendering/
  ship/
  space/
    universe/
  ui/
```

## Module conventions

- Vanilla JavaScript ES Modules.
- Local imports include `.js` extensions.
- Three.js is loaded through the import map in `index.html` so no build step is required.
- `src/app/` owns app orchestration, lifecycle, input, resize, and browser wiring.
- `src/space/` owns the procedural universe facade, seeded environment
  generation, landmarks, gravity attractor data, and future deterministic
  universe hooks.
- `src/space/universe/` owns the Phase 7 subsystem generators: cosmic web,
  spatial index, stars, galaxies, landmarks, nebulae, dynamic lighting, events,
  and impostors.
- `src/ship/` owns the autonomous ship entity, physics, exterior, interior, and anchors.
- `src/player/` owns player rigs and reference-frame transitions.
- `src/rendering/` owns sky, post FX, shaders, speed lines, the F2 post-FX
  panel, and the F10 universe panel.
- `src/ui/` owns desktop/VR UI surfaces such as diegetic status and universe
  navigation markers.
- `src/config/` owns presets and tunable defaults.

## Entity decisions

The ship is an autonomous entity, not a camera mode. `Ship.update(dt, commandState)` runs every frame even when the player is not piloting. The player rig currently lives under `Ship.interiorRoot`, which prepares the local ship reference frame required for walking inside a moving vessel.

Future phases should keep this model:

```text
World
  Universe
    CosmicWeb
    StarField / GalaxyField / Landmarks / NebulaField
    UniverseLighting / UniverseEvents
  ShipRoot
    ShipExterior
    ShipInterior
      PlayerRigLocalToShip
```

## F2, F10, and presets

The F2 panel is now the post-FX / comfort / ship development tool. It owns:

- Bloom
- Warp
- Relativistic Stars
- Retro / Pixel
- ASCII
- Halftone
- VR Comfort
- XR Post FX
- Ship

Warp is speed-driven by default. `Warp > debugSpeedFactor` only forces a fixed
warp amount when `Warp > debugOverrideEnabled` is checked; otherwise the warp
factor comes from ship speed and hyperdrive spool. `Relativistic Stars` controls
the star-field aberration/Doppler shader: `enabled`, `intensity`, and `maxBeta`
scale the live hyperdrive-driven effect, while `debugOverrideEnabled` +
`debugBeta` force a visible beta for tuning.

The F10 panel owns the procedural universe. It exposes:

- Global seed, region, density, fog, and gravity scale
- Stars
- Galaxies
- Black holes / pulsars / anomalies
- Nebulae / clusters / dust
- Dynamic lighting
- Rare events
- Universe tools: random seed, Regen, JSON import/export, presets, counters

Preset ordering:

1. engine defaults
2. post-FX or Universe preset
3. user/dev preset
4. runtime overrides

## How to run

From `D:\Documents\PROJECTS\DEEP_SPACE_VR`:

```powershell
python -m http.server 5177
```

Then open:

```text
http://localhost:5177/
```

## Browser validation

- The page loads without a build step.
- A non-empty Three.js scene is visible.
- The scene contains the Phase 7 procedural universe: full-sphere star layers,
  galaxies, nebulae, clusters, dust, black holes, pulsars, anomalies, and POI
  navigation markers.
- Press `F2` to open and close the tweak panel.
- Press `F10` to open and close the Universe panel.
- Change a LIVE universe control such as star brightness; the scene updates
  live. Change a REGEN control such as seed or object counts, then press
  `Regen`.
- Use arrow keys for debug camera movement.
- Confirm the folder structure listed above exists.

## Next phase notes

The desktop implementation can keep the full FX inventory: EffectComposer,
Bloom, WarpSpeedShader, Retro16BitShader, ASCIIShader, HalftoneShader,
F4/F6/F7 toggles, preset import, resolution updates, and speed lines.

The next VR visual implementation target is narrower and stricter: Bloom, Retro
Pixel, Color Depth, Scanlines, and Warp must reach desktop visual parity first.
ASCII and Halftone are deferred for VR until that required stack works on Quest
3.

## Future visual priority

The VR visual identity is a no-compromise feature. Temporary overlay-based
substitutes are not enough for bloom or pixelation. The future implementation
target is documented in:

- `D:\Documents\PROJECTS\DEEP_SPACE_VR\docs\phase-06-xr-post-fx-pipeline.md`

That phase should be treated as rendering architecture work: prove an XR-aware
post-FX backend on Quest 3 before migrating the full desktop visual stack.

The first VR parity target is the desktop reference image:

- `D:\Documents\PROJECTS\DEEP_SPACE_VR\docs\assets\desktop-visual-reference-blackhole-cockpit.png`
