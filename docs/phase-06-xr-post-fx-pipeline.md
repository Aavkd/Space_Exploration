# Phase 06 - XR Post-FX Pipeline Spec

> **Status: IMPLEMENTED (custom WebXR route).** Validated on Quest 3: VR shows
> the desktop deep-space identity (real bloom, retro pixel, color depth,
> scanlines, warp) with no black frames, no single-eye black frame, and smooth
> presentation. The remaining item is an optimization caveat (brief unrendered
> view edge on fast head turns) tracked under
> [Known Caveats & Next Optimizations](#known-caveats--next-optimizations).
>
> The rest of this document keeps the original spec for context; see the
> [Implementation Status](#implementation-status) section for what was actually
> built and why it diverges from the spec's "library first" preference.

This phase was a future implementation target. It is documented in detail
because the visual identity is a product priority, not a comfort-mode
nice-to-have.

## Implementation Status

### Route chosen: custom WebXR pipeline (not the library)

The spec named `pmndrs/postprocessing` as the "Required First Route." At
implementation time that route was **not viable**: pmndrs/postprocessing has no
shipped WebXR support (tracked in their open research issue #677, opened Jan
2025; their v7 `RenderPipeline` needs structural changes before VR works).
Adopting it would have meant shipping a bundler *and* patching unreleased XR
code with no guarantee of parity.

So the spec's **"Alternative: Custom WebXR Render Pipeline"** was implemented
instead. It needs no build step (the project keeps its import-map / CDN setup),
carries no dependency risk, and is fully under our control. This decision was
confirmed with the project owner before implementation. Revisit the library
route only if pmndrs/postprocessing ships and Quest-validates WebXR support.

### How the custom pipeline works

The hard part of WebXR post-processing is that, while presenting,
`renderer.render(scene, anyCamera)` always swaps in the XR `ArrayCamera` and
renders each eye into its own `camera.viewport` inside whatever render target is
bound. The earlier prototype fought this by toggling `renderer.xr.enabled`
mid-frame and compositing to the canvas (`setRenderTarget(null)`), which
presents black in a real headset. The implemented pipeline never does either.

Per frame, while presenting (`XRPostFxPipeline.render`):

1. Capture the XR framebuffer target = `renderer.getRenderTarget()` *first*
   (this is the `isXRRenderTarget` target the WebXRManager bound before our
   animation-frame callback — NOT `null`).
2. Bind an offscreen `sceneRT` (sized to the XR framebuffer) and
   `renderer.render(scene, camera)`. The ArrayCamera fills both eye viewports of
   `sceneRT` in one pass. No `xr.enabled` toggle.
3. Run a bright-pass + separable gaussian whose stride doubles each iteration
   (a full-res approximation of UnrealBloom's mip pyramid) into offscreen bloom
   targets, with a gain that keeps the wide halo hot.
4. Bind the captured XR framebuffer target and render the **composite** quad:
   Bloom + Warp + Retro/Pixel + Color Depth + Scanlines + Vignette + Noise, in
   one shader, into each eye's viewport.

Every pass uses a clip-space passthrough quad (the vertex shader ignores the
camera, so the ArrayCamera projection is irrelevant and only the viewport
matters). `mesh.onBeforeRender` fires once per eye and feeds each eye its UV
sub-rect of the side-by-side textures. Intermediate targets stay linear and the
composite shader omits any colorspace conversion exactly like the desktop
`Retro16BitShader`, so the VR image matches the desktop look by construction.

### Architecture

```text
src/rendering/
  RenderPipeline.js          facade: one render() entrypoint, picks the backend
  DesktopPostFxPipeline.js   migrated EffectComposer chain (desktop only)
  XRPostFxPipeline.js        the custom WebXR post-FX path (the VR feature)
```

`App` calls one stable entrypoint each frame:

```javascript
this.renderPipeline.render({ scene, camera, dt });
```

The facade renders the desktop composer when not presenting, the custom XR
pipeline when presenting (`vr_postfx`), and only falls to a plain XR render
(`vr_direct`) if XR post-FX is *explicitly* disabled — never as a silent
fallback. The old `PostProcessing.js` was removed; the
`XRVisualEffects.renderXrPostFx` prototype is hard-disabled.

### Desktop preview (validate the VR shader without a headset)

The XR pipeline can run single-camera on the desktop canvas, so the exact VR
combined shader can be A/B'd against the desktop composer with no headset:

- F2 -> `XR Post FX` -> `previewOnDesktop`, or
- console: `__deepSpaceDebug.setXrPreviewOnDesktop(true)`.

This is how parity was verified during implementation and is the fastest way to
iterate on the look.

### F2 controls / presets

Single visual language with desktop: the XR pipeline reads the shared `bloom`,
`warp`, and `retro` config groups, so `vr_visual_default` matches `desktop`
bloom/retro values by construction. XR-only knobs:

- `bloom.xrStrengthScale`, `bloom.xrRadiusScale` (relative nudge, 1 = parity).
- `XR Post FX` group: `enabled`, `previewOnDesktop`, `backend` (`custom` /
  `library`-unavailable), `quality` (`low`/`medium`/`high` -> bloom blur
  iterations), `performanceBudgetMs`, `failHardOnError`, `foveation`,
  `sceneSamples`.

Presets: `desktop_default`, `vr_visual_default` (full identity in VR),
`vr_comfort` (movement comfort only, visuals untouched), `vr_performance_low`
(future optimization tier). `vr_safe` is kept as an alias of `vr_comfort`.

### Debug hooks

- `__deepSpaceDebug.getRenderPipelineState()`
- `__deepSpaceDebug.getXrPostFxState()`
- `__deepSpaceDebug.setXrPostFxBackend(name)`
- `__deepSpaceDebug.setXrPostFxEnabled(enabled)`
- `__deepSpaceDebug.setXrPreviewOnDesktop(enabled)`

### Known Caveats & Next Optimizations

- **Brief unrendered view edge on fast head turns.** On a significant, fast head
  rotation the headset briefly shows the edge of frame before the new content is
  composited. Cause: the composite is a flat fullscreen quad written at a single
  depth, so the runtime's reprojection / timewarp has no scene depth to
  reproject against and cannot fill newly-exposed edges; any per-frame cost that
  drops below native refresh widens the window. It is smooth in normal use.
  Optimization directions, in rough priority:
  1. Keep frame time under the headset refresh budget (`performanceBudgetMs`)
     so reprojection rarely engages: lower `quality`, lower bloom blur
     iterations, or render at a modest `framebufferScaleFactor`.
  2. Write scene depth into the XR framebuffer alongside the composite so the
     runtime can reproject correctly (depth-aware composite).
  3. Capture/composite a small FOV margin beyond the eye viewport so a turn
     reveals already-rendered pixels.
- **Full-res bloom chain.** The separable blur runs at full XR-framebuffer
  resolution because the ArrayCamera fixes per-eye viewports (no cheap
  downscaled mips). This is the largest per-frame cost and the first thing to
  optimize after parity (`quality` already scales the iteration count).
- **ASCII / Halftone** are intentionally not in the VR pipeline yet (per spec);
  they remain desktop-only.

## Locked Product Decisions

These decisions are locked by product direction and should not be reopened by a
future implementation agent unless explicitly requested.

- Visual parity with desktop is the first goal. Optimize only after the target
  look exists in VR.
- A build step and npm dependencies are allowed.
- Quest 3 performance is important, but the first milestone is visual
  correctness, not a premature FPS target.
- Non-negotiable VR effects for the first implementation:
  - Bloom
  - Retro Pixel
  - Color depth
  - Scanlines
  - Warp
- No fallback to plain direct rendering for the target feature. If XR post-FX
  fails, it should fail visibly during development so the issue is fixed instead
  of hidden.
- ASCII and Halftone are not part of the first no-compromise VR parity target.
  They may be restored later after the required stack is stable.

## Feature Goal

The VR headset must preserve the desktop Deep Space visual identity with no
major artistic concession:

- real bloom from bright emissive pixels;
- real retro/pixel sampling of the rendered image;
- color depth, contrast, saturation, exposure, scanlines, vignette, and noise
  behaving close to the desktop `Retro16BitShader`;
- warp/speed visuals matching the desktop identity first, with comfort tuning
  handled later as explicit reductions if needed;
- F2-driven live tuning from the desktop companion while the headset is active.

Overlays, additive scene halos, lower XR framebuffer resolution, or
material-only tricks may help debugging, but they are not accepted as the
feature implementation for bloom, pixelation, color depth, scanlines, or warp.

## Visual Target

Official desktop reference:

![Desktop visual reference](./assets/desktop-visual-reference-blackhole-cockpit.png)

This image is the visual target for the first VR parity pass. Do not interpret
"retro pixel bloom" loosely; match this look.

Required visual qualities:

- The black hole/accretion disk blooms heavily before the final retro pass. It
  should read as a hot white/orange mass with a wide soft glow, then be
  pixelated and scanlined by the final image treatment.
- Pixelation is global and samples the rendered scene. It affects the nebulae,
  bloom, cockpit silhouette, stars, and galaxy particles. It is not an overlay
  grid.
- Color depth is visibly reduced. Deep blues, blacks, oranges, and magentas are
  quantized/posterized in the final image.
- Scanlines are fine, consistent, and full-frame.
- Blacks stay very deep. Do not brighten the VR render just to make headset
  visibility easier during the parity phase.
- The cockpit remains a dark lower-frame silhouette with only subtle blue panel
  detail.
- The galaxy/particle field on the right stays crisp as small blocky luminous
  particles, not smooth blurred sprites.
- The final image should feel like a low-resolution digital sensor looking into
  an overexposed cosmic event.

Required pass intent:

```text
Scene Render -> Bloom -> Warp -> Retro Pixel / Color Depth / Scanlines
```

This ordering matters. In particular, bloom must happen before the final retro
pixel/color-depth treatment so the glow itself gets pixelated like the desktop
reference.

Scene/camera validation in VR will be performed manually by the project owner.
The implementation agent should provide the controls and pipeline needed for
that comparison, not invent a different target scene.

## Current Findings

The current desktop pipeline uses `EffectComposer`:

```text
RenderPass -> UnrealBloomPass -> Warp -> Retro -> ASCII -> Halftone
```

That pipeline is valid for desktop, but it is not a safe WebXR headset path in
this project. Enabling a composer-style headset path can produce a full black
frame in the headset.

The later `realPostFxEnabled` prototype is also not a final solution. It tried
to render each XR eye into custom render targets during the active WebXR frame,
temporarily toggling `renderer.xr.enabled`, then drawing a composite plane back
to the XR camera. This repeats the same core mistake as the composer path:
manual render-target and XR framebuffer state manipulation inside
`WebXRManager`'s presentation loop. It may compile and work in a desktop smoke
test, but in a Quest headset it can still present black.

Treat that prototype as an experiment to remove or replace, not as a foundation.

## Technical Direction

The future implementation must use one of these two real approaches.

### Required First Route: XR-Aware Postprocessing Library

Adopt a maintained post-processing pipeline that is designed around combined
effects and can be validated in WebXR on Quest 3. Since a build step and npm
dependencies are allowed, the implementation should not be constrained by the
current import-map-only setup.

Recommended investigation target:

- `pmndrs/postprocessing`, because it combines effects more efficiently than
  traditional multi-pass chaining and has community precedent for WebXR usage.

Implementation requirements:

- Add a real build step and package manifest if needed.
- Replace the current desktop-only `src/rendering/PostProcessing.js` with a
  rendering facade that owns two backends:
  - desktop backend: current composer behavior or a migrated equivalent;
  - XR backend: library-supported effect composer/effect pipeline.
- Start with the minimum effect stack in VR:
  1. render scene;
  2. bloom/luminance;
  3. retro pixel/color-depth shader;
  4. scanlines/vignette/noise;
  5. warp.
- Do not include ASCII or Halftone in the first Quest 3 parity milestone.
- First prove Bloom + Retro Pixel + Color Depth + Scanlines + Warp in Quest 3
  without black frames, then optimize.

### Alternative: Custom WebXR Render Pipeline

Write a low-level XR render path instead of using Three's normal
`WebXRManager` presentation path for post-FX.

This is more expensive and should only be chosen if the library route cannot
reach parity after a focused Quest 3 spike.

Implementation requirements:

- Own the XR session render loop, view iteration, framebuffers, viewports, and
  projection matrices explicitly.
- Render each `XRView` into controlled eye render targets.
- Run one combined post-FX shader per eye.
- Submit the result to the XR base layer without toggling `renderer.xr.enabled`
  mid-frame.
- Keep this code isolated from desktop rendering so normal desktop iteration
  remains simple.

This route should be treated as rendering-engine work, not a small feature.

## Non-Goals

- Do not keep `EffectComposer` as a headset path unless a verified XR-aware
  backend proves it safe on Quest 3.
- Do not claim a camera-attached overlay is pixelation. It can add scanlines or
  texture, but it cannot sample the rendered image.
- Do not use `renderer.xr.enabled = false/true` inside a WebXR frame to capture
  eye textures.
- Do not rely on `framebufferScaleFactor` as the artistic pixel effect. It can
  support performance or coarse resolution, but it is not equivalent to the
  desktop retro shader.
- Do not accept a VR-safe preset that disables the visual identity. Comfort
  tuning may reduce intensity later, but the first parity target must match the
  desktop experience before optimization.

## Proposed Architecture

Create a renderer-facing facade:

```text
src/rendering/
  RenderPipeline.js
  DesktopPostFxPipeline.js
  XRPostFxPipeline.js
  effects/
    RetroPixelEffect.js
    DeepSpaceBloomEffect.js
    WarpEffect.js
```

`App` should call one stable render entrypoint:

```javascript
renderPipeline.render({
    scene,
    camera,
    renderer,
    dt,
    displayMode,
    config,
    shipSpeed
});
```

The facade decides the backend:

- `desktop`: current desktop post-FX path;
- `vr_direct`: direct XR render for unrelated locomotion/debug work only;
- `vr_postfx`: required XR-aware post-FX pipeline for the visual feature.

For the no-compromise feature branch, `vr_postfx` is the required target. The
`vr_direct` backend may remain useful for unrelated VR locomotion debugging, but
it must not be treated as an acceptable fallback for the visual feature.

The debug state must expose:

- active backend;
- post-FX support status;
- XR render target size, if any;
- effect timings if available;
- last XR post-FX hard error.

## F2 / Preset Contract

Keep one visual language across desktop and VR. The controls may be implemented
by different backends, but names and intent should stay aligned.

Required groups:

- `Bloom`
  - `enabled`
  - `strength`
  - `radius`
  - `threshold`
  - `xrStrengthScale`
  - `xrRadiusScale`
- `Retro / Pixel`
  - `enabled`
  - `pixelSize`
  - `colorDepth`
  - `contrast`
  - `saturation`
  - `scanlineIntensity`
  - `noiseIntensity`
  - `vignetteStrength`
  - `vignetteIntensity`
  - `brightness`
  - `exposure`
- `Warp`
  - keep the desktop identity as the baseline;
  - implement the closest comfortable XR equivalent only after proving the
    desktop-style warp can run without black frames;
  - if comfort changes are needed, expose them as separate tunable reductions,
    not as silent defaults.
- `XR Post FX`
  - `enabled`
  - `backend`: `library`, `custom`
  - `quality`: `low`, `medium`, `high`
  - `performanceBudgetMs`
  - `failHardOnError`

Preset policy:

- `desktop_default`: full visual identity.
- `vr_visual_default`: full desktop visual identity in Quest 3.
- `vr_comfort`: movement comfort only; it should not remove the visual identity.
- `vr_performance_low`: future optimization preset only, after visual parity is
  proven.

## Acceptance Criteria

Testing must happen on an actual Quest 3 or equivalent standalone headset.
Desktop smoke tests are not enough.

Pass conditions:

1. Enter VR with XR post-FX enabled: no black frame, no single-eye black frame,
   no frozen frame.
2. Bloom visibly affects bright scene pixels, especially ship emissives,
   galaxy core, anomaly, black hole disk, and cockpit lights.
3. Pixelation visibly samples the rendered scene like desktop Retro/Pixel,
   not merely an overlay grid.
4. F2 controls update the headset view live where WebXR permits it.
5. If the XR post-FX backend fails during this feature work, the failure is
   visible and actionable. Do not silently fall back to direct rendering.
6. `desktop_default` and `vr_visual_default` read as the same art direction
   within a quick A/B comparison, with Bloom, Retro Pixel, Color Depth,
   Scanlines, and Warp all recognizable.
7. The VR output is judged against
   `docs/assets/desktop-visual-reference-blackhole-cockpit.png`. The project
   owner validates the actual scene/camera comparison in the headset.
8. Performance is measured after parity is reached. If framerate is
   insufficient, optimize implementation and quality tier before removing core
   effects.

## Implementation Plan For Future Agent

1. Remove or hard-disable the current `realPostFxEnabled` experiment from
   `src/xr/XRVisualEffects.js`.
2. Keep direct WebXR rendering only as a separate debug mode for non-visual VR
   work, not as a fallback for this feature.
3. Create `RenderPipeline.js` facade and move the current desktop composer
   behind `DesktopPostFxPipeline`.
4. Prototype `XRPostFxPipeline` with Bloom + Retro Pixel + Color Depth +
   Scanlines.
5. Add Warp as the next required effect, then test the full required stack on
   Quest 3.
6. Add debug hooks:
   - `getRenderPipelineState()`
   - `getXrPostFxState()`
   - `setXrPostFxBackend(name)`
   - `setXrPostFxEnabled(enabled)`
7. Add F2 `XR Post FX` backend/quality/fail-hard controls.
8. Once Quest 3 proves stable, migrate remaining visual effects.
9. Update phase docs and presets to make `vr_visual_default` the visual target.

## Reference Notes

- Three.js `WebXRManager.getCamera()` returns an `ArrayCamera` during XR, with
  separate cameras for each XR view.
- Three.js `ArrayCamera` uses per-camera viewport data, which is central to VR
  rendering.
- Three/examples `EffectComposer` should be treated as desktop-only until proven
  otherwise in this project.
- The Three.js forum has historical warnings that `EffectComposer` is not a
  supported default WebXR path because traditional multi-pass post-processing is
  expensive and fragile in XR.

Useful references:

- https://threejs.org/docs/pages/WebXRManager.html
- https://threejs.org/docs/pages/ArrayCamera.html
- https://discourse.threejs.org/t/is-it-possible-to-use-threejs-postprocessing-in-web-vr/36333
- https://github.com/pmndrs/postprocessing
