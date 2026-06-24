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
```

## Module conventions

- Vanilla JavaScript ES Modules.
- Local imports include `.js` extensions.
- Three.js is loaded through the import map in `index.html` so no build step is required.
- `src/app/` owns app orchestration, lifecycle, input, resize, and browser wiring.
- `src/space/` owns Deep Space environment generation and future deterministic chunks.
- `src/ship/` owns the autonomous ship entity, physics, exterior, interior, and anchors.
- `src/player/` owns player rigs and reference-frame transitions.
- `src/rendering/` owns sky, post FX, shaders, speed lines, and the F2 panel.
- `src/config/` owns presets and tunable defaults.

## Entity decisions

The ship is an autonomous entity, not a camera mode. `Ship.update(dt, commandState)` runs every frame even when the player is not piloting. The player rig currently lives under `Ship.interiorRoot`, which prepares the local ship reference frame required for walking inside a moving vessel.

Future phases should keep this model:

```text
World
  DeepSpaceEnvironment
  ShipRoot
    ShipExterior
    ShipInterior
      PlayerRigLocalToShip
```

## F2 and presets

The F2 panel exists from the start as a desktop development tool. It already reserves groups for:

- Bloom
- Warp
- Retro / Pixel
- ASCII
- Halftone
- Deep Space
- VR Comfort

The current phase applies a subset directly because the full post-processing chain is intentionally deferred to the visual extraction phase. Preset ordering for future work:

1. engine defaults
2. Deep Space preset
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
- The scene contains stars, a colored galaxy, a nebula, a ship blockout, a black hole placeholder, and an anomaly placeholder.
- Press `F2` to open and close the tweak panel.
- Change `Deep Space > starOpacity` and `nebulaOpacity`; the scene updates live.
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
