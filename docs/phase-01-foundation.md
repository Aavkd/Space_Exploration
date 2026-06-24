# Phase 01 - Foundation Notes

## Done

- Created the standalone `DEEP_SPACE_VR` project structure.
- Added a no-build `index.html` using an import map for Three.js.
- Added a minimal Three.js app with a deep black scene, fog, sky dome, stars, landmark galaxy, nebula, shader black hole, shader spatial anomaly, speed lines, and ship blockout.
- Added an autonomous `Ship` entity with `ShipRoot`, `ShipExterior`, and `ShipInterior`.
- Added a `PlayerRigLocalToShip` under the ship interior to prepare ship-local locomotion.
- Added the full desktop post-processing chain: `RenderPass`, `UnrealBloomPass`, `WarpSpeedShader`, `Retro16BitShader`, `ASCIIShader`, and `HalftoneShader`.
- Extracted `Retro16BitShader` into its own module.
- Added `fillASCII.png` loading for the ASCII pass.
- Replaced square `PointsMaterial` nebula particles with soft shader sprites using radial alpha and procedural breakup so the cloud reads as volumetric instead of blocky.
- Added an F2 tweak panel with live groups for Bloom, Warp, Retro/Pixel, ASCII, Halftone, Deep Space, and VR Comfort.
- Added preset JSON loading from `assets/config/post_processing.json`, plus browser import/export in F2.
- Added dev toggles: `F4` Retro, `F6` ASCII, `F7` Halftone.
- Resize updates all post FX `resolution` uniforms: Warp, Retro/Pixel, ASCII, and Halftone.
- Added runtime config hooks for star and nebula opacity.

## Manual checklist

1. Run `python -m http.server 5177` from `D:\Documents\PROJECTS\DEEP_SPACE_VR`.
2. Open `http://localhost:5177/`.
3. Verify that Deep Space appears immediately: black void, stars, landmark galaxy, nebula, ship, black hole, anomaly, and speed lines.
4. Press `F2` and verify the panel opens.
5. Verify the groups: Bloom, Warp, Retro / Pixel, ASCII, Halftone, Deep Space, VR Comfort.
6. Change Bloom `strength`, `radius`, and `threshold` live.
7. Change Retro/Pixel `pixelSize`, `colorDepth`, `scanlineIntensity`, and `exposure` live.
8. Press `F6`, verify ASCII toggles on, then change `zoom`, `fillColor`, and `backgroundColor`.
9. Press `F7`, verify Halftone toggles on, then change `dotSize` and `scale`.
10. Change Warp `debugSpeedFactor`, `blurStrength`, `streakIntensity`, and `distortion`.
11. Press `F4` and verify Retro/Pixel toggles.
12. Export a JSON preset, import it back, and confirm values are applied.
13. Resize the browser window and verify the shader passes remain aligned.
14. Watch for visible performance limits: black hole raymarch plus Bloom/ASCII/Halftone together can be heavy on low-end GPUs.

## Deferred intentionally

- Deterministic chunk streaming beyond the first seeded foundation scene.
- Full ship physics and cockpit controls.
- WebXR session support.
