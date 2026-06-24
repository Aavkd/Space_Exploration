# Phase 08 — Ship Speed, Handling & Hyperdrive

Implementation spec for adapting ship speed/handling to the **expanded universe**
(commit `d959d43 "expanded the Universe (Big Bang)"`). Written so an implementing
agent can act on it directly. The source logic is extracted from the original
Racing flight model (`Racing/js/core/plane.js`) and reconciled with the cleaner
6-DOF model already present here (`src/ship/ShipPhysics.js`).

> Companion reading: `Racing/docs/deep-space-extraction-reference.md` (the original
> extraction plan) and `docs/phase-07-procedural-universe.md` (what the expansion
> added).

---

## 1. Why this is needed — scale outran the ship

The "Big Bang" commit grew the world ~6× but the ship was never re-tuned.

| Quantity | Before | After expansion | Source |
|---|---|---|---|
| `cameraFar` / `skyRadius` | 200,000 | **1,200,000** | `src/config/deepSpacePreset.js` |
| Cosmic-web `regionRadius` | n/a | **500,000** (POIs scattered to ±~490k → up to ~1,000,000 apart) | `src/config/universePresets.js`, `src/space/universe/CosmicWeb.js` |
| Ship `maxLinearSpeed` | — | **2,200 m/s** (unchanged) | `src/ship/ShipPhysics.js:21` |
| `forwardForce` | — | **42 m/s²** (×2.2 boost, unchanged) | `src/ship/ShipPhysics.js:9` |
| Warp saturation point | — | **600 m/s** = 27% of top speed (unchanged) | `src/app/App.js:238` |

**Symptoms today:**

- Reaching a mid-distance POI (~400k units) takes **~3 min** at top speed; a full
  ~1,000,000-unit traverse takes **~7.5 min**.
- Warp pins to full at 600 m/s, so across 600→2200 m/s (most of the usable range)
  the screen looks identical — **no dynamic range, no sense of "going fast".**
- The GLB hull already declares a `hyperdrive_fx` material group
  (`src/ship/ShipModelGLB.js:32`, `FX_SPRITE_MATERIAL_PATTERN`) that is currently
  never driven — a visual hook waiting for this feature.

---

## 2. Source logic in Racing (`plane.js`) — what we are extracting

Racing achieves a huge dynamic range with two layered mechanisms:

### 2.1 Thrust multiplier + space-transition (the "two regimes")
- `thrustMultiplier = 100` (Deep Space) scales `MAX_THRUST/HOVER/REVERSE`
  (`plane.js:212-258`).
- `spaceTransitionFactor` (0→1) interpolates between **atmosphere** (drag on,
  bounded ~700 km/h, precise) and **space** (drag off, **unbounded inertial =
  hyperdrive**) (`plane.js:103-155`, `_applyPhysics` `plane.js:366-489`).
- Toggle key `O` (flight mode), airbrake `B` (×0.95/frame), hover `X`, reverse `L2`.

### 2.2 FX that track the speed regime
- Speed-line thresholds and width/bloom scale by **`multiplier^0.7`** so the effect
  stays calibrated as top speed grows (`plane.js:233-238`). The `^0.7` exponent
  matches Racing's observed drag-bounded top-speed ratios.
- Speed lines = **2,000-quad shader mesh**, box `40×20×1000`, CPU-accumulated
  `travelDistance` to kill float jitter, stretch ∝ `speedFactor · log(multiplier)`,
  opacity rolled back above 2000 / 24000 km/h (`plane.js:958-1176`).
- Extreme-speed cues: FOV boost up to **+90°** and warp `distortion` up to **1.0**
  between **10,000–100,000 km/h** (`plane.js:1184-1221`).

### 2.3 What NOT to copy from Racing
The Racing model is an aircraft with lift/drag/terrain-collision/hover, plus the
confusing `atmosphereMode` naming. We keep our **inertial 6-DOF** model and our
already-separated **dampeners vs airbrake**. We extract only the *regime + FX*
ideas, not the aero code.

---

## 3. Current DEEP_SPACE_VR baseline — keep vs change

**Keep (already better than Racing — do not regress):**
- `ShipPhysics` is genuine inertial 6-DOF; dampeners (`KeyZ`) vs airbrake (`KeyX`)
  already separated, exactly as the extraction doc recommended
  (`src/ship/ShipPhysics.js:8-28`, `95-143`).
- Ship simulates every frame whether piloted or not; coasts on inertia + gravity
  when unpiloted (`src/app/App.js:210-218`).
- Warp shader is a faithful port of Racing's; `speedFactor` + `distortion` are
  plumbed to **both** desktop and the custom XR pipeline
  (`RenderPipeline.setWarpSpeedFactor`, `DesktopPostFxPipeline:97`,
  `XRPostFxPipeline:130`, `uWarpDistortion` at `XRPostFxPipeline:563`).
- F2 `vrComfort` knobs exist: `warpMax`, `speedLinesMaxOpacity`, `accelerationCap`.

**Change / add:**
1. No high-speed regime — only a flat 2.2× boost. → add **Hyperdrive gear**.
2. Warp/speed-lines thresholds hardcoded (`/600`, `/450`). → add **regime-scaled
   recalibration**.
3. Speed lines are a thin 180-segment `LineSegments`, 80-unit scroll wrap, no
   speed-driven stretch (`src/rendering/SpeedLines.js`). → **port Racing's quad
   mesh**.
4. No FOV boost, no high-speed distortion ramp; `hyperdrive_fx` sprites unused.
   → add **capped FOV (desktop) + capped distortion (desktop & VR)** and drive the
   sprites.

---

## 4. Decided design

Confirmed with the project owner:

- **Two discrete gears, Racing-style**, with a tactile **spool-up** on engage and
  clear **HUD state**.
- **Unbounded inertial** hyperdrive (true zero-drag; speed keeps building while
  thrusting; arrest only via dampeners/airbrake). A high *safety* clamp guards the
  integrator but is not a design speed limit.
- **FOV + distortion cued everywhere, capped.** See §4.4 for the WebXR reality
  (headset FOV cannot be force-widened, so VR gets capped distortion + cues).

### 4.1 The two gears

| | PRECISION (default) | HYPERDRIVE |
|---|---|---|
| Use case | Docking, EVA proximity, fine framing | Crossing the expanded universe |
| `forwardForce` | 42 m/s² | scaled by `HYPER_MULT` (≈120) → ~5,040 m/s² at full spool |
| `accelerationCap` (VR comfort) | 45 | eased up to `HYPER_ACCEL_CAP` (≈6,000) by spool |
| Top speed | clamp **active** at `maxLinearSpeed` (2,200) | clamp **lifted** → high safety guard only (`HYPER_SAFETY_CLAMP` ≈ 250,000) |
| Auto-damping | none (inertial) | none (inertial) |
| Angular authority | full (`pitch/yaw/roll Accel`) | reduced by spool (×`(1 − 0.5·spool)`) for control + comfort |
| Strafe / vertical | unchanged | unchanged (hyperdrive is forward-travel; keep lateral nudges precise) |
| `boostMultiplier` (Shift) | 2.2 sprint, retained | inert or minor (hyperdrive already fast) |
| Dampeners / airbrake | work as today | **still work** — primary way to arrest |

`HYPER_MULT ≈ 120` → reaching ~50,000 m/s from rest in ~10 s, ~30,000 m/s in ~6 s.
At 50,000 m/s a ~500k region core is ~10 s away; the FX have lots of headroom.
All numbers are **starting values to tune**, not hard requirements.

### 4.2 Spool transition (the "feel of it being enabled")

- `ShipControls` owns the **intent** toggle `hyperdriveEngaged` (latched, like
  `pilotActive` / `dampeners`).
- `Ship` owns the eased **`hyperdriveLevel` ∈ [0,1]**, advanced each frame toward
  `engaged ? 1 : 0`:
  - engage time-constant ~0.9 s, disengage ~0.5 s:
    `level += (target − level) · (1 − exp(−dt / tau))`.
  - apply `smoothstep(level)` where it scales forces/FX for a nicer ease.
- Everything hyperdrive-scaled multiplies by this level, so thrust **ramps in**
  rather than snapping — that is the tactile spool.
- `hyperdrive_fx` sprites become visible at `level > ~0.05`; engine glow / bloom
  scales with `level` (reuse `Ship.setEngineFxVisible` / emissive scaling).
- Optional: a one-shot rumble pulse + brief warp `speedFactor` kick at engage for
  punch (`input.gamepad.pulse(...)`).

### 4.3 FX recalibration (the `multiplier^0.7` idea, adapted for unbounded)

The exact Racing thresholds assume a fixed top speed; ours is unbounded, so we
**blend reference speeds by spool level** instead of dividing by a fixed max.

- **Warp `speedFactor`** (replaces `App.js:238` `ship.speed / 600`):
  - `warpRef = lerp(WARP_REF_PRECISION, WARP_REF_HYPER, smoothstep(level))`
  - `WARP_REF_PRECISION ≈ 1500` (full near precision top of 2200, not at 600).
  - `WARP_REF_HYPER ≈ 600 · HYPER_MULT^0.7 ≈ 18,000` (with `HYPER_MULT=120`,
    `120^0.7 ≈ 30.3`).
  - `speedFactor = clamp(ship.speed / warpRef, 0, 1)`, then keep the existing
    `min(speedFactor, vrComfort.warpMax)` ceiling.
- **Speed-line thresholds** scale the same way: `minSpeed`/`maxSpeed` lerp from
  precision values (~200 / ~1800 m/s) to hyperdrive values (×`HYPER_MULT^0.7`).
  Stretch ∝ `speedFactor` and `log(effectiveMult)` (Racing `plane.js:1077`).
- **FOV / distortion** use **absolute m/s thresholds** (Racing used absolute km/h):
  - `fovStart ≈ 8,000 m/s`, `fovMax ≈ 60,000 m/s` →
    `fovFactor = clamp((speed − fovStart)/(fovMax − fovStart), 0, 1)`.

### 4.4 Extreme-speed cues per platform (capped)

| Cue | Desktop / chase cam | VR (WebXR) |
|---|---|---|
| **FOV widen** | `warpFovBoost = fovFactor · FOV_BOOST_MAX_DESKTOP` (cap **+40°**, configurable). Apply to `camera.fov` in chase/free cam, then `updateProjectionMatrix()`. | **Not applicable** — in an active XR session the per-eye projection (and thus FOV) is supplied by the device via `renderer.xr`; setting `camera.fov` has no effect. Documented constraint, not a TODO. |
| **Radial distortion** | `targetDistortion = fovFactor · WARP_DISTORT_MAX_DESKTOP` (≈0.6), eased. Driven via new `RenderPipeline.setWarpDistortion` → `warpPass.uniforms.distortion`. | `targetDistortion = fovFactor · WARP_DISTORT_MAX_VR` (≈**0.25**, conservative), via `XRPostFxPipeline` `uWarpDistortion`. |
| **Speed lines + ship FX + bloom** | yes | yes — these carry the speed read in VR in place of FOV widen. |

> ⚠️ **VR comfort note.** The owner chose "FOV+distortion everywhere (capped)",
> which is more aggressive than this project's prior VR-comfort stance (see
> `docs/phase-05-vr-comfort.md` and the custom XR pipeline route). Honor the choice
> but: (a) keep the VR distortion cap small and **tied to a `vrComfort` knob**
> (`warpDistortionMaxVR`, default 0.25), (b) allow it to be dialed to 0 (→ diegetic
> only) without code changes, (c) prefer optical-flow-reducing cues (vignette,
> stable horizon) over center zoom. This is reversible by config.

---

## 5. File-by-file change list

1. **`src/ship/ShipPhysics.js`** — add hyperdrive params to `DEFAULTS`
   (`hyperForwardMult`, `hyperAccelCap`, `hyperSafetyClamp`, `hyperAngularScale`).
   In `integrate()`, read `cmd.hyperdrive` (the eased level 0..1) and:
   - scale linear accel: `forwardForce · lerp(1, hyperForwardMult, level)`;
   - scale `accelerationCap` by level (so VR-comfort cap eases up, not snaps);
   - select clamp: `level < ε ? maxLinearSpeed : hyperSafetyClamp`;
   - scale angular accel by `(1 − 0.5·level)`.
   Expose `getEffectiveThrustMultiplier()` for FX. Keep ShipPhysics free of DOM/UI.

2. **`src/ship/ShipControls.js`** — add latched toggle `hyperdriveEngaged`
   (keyboard e.g. `KeyH` or `Space`; gamepad `r3` (right-stick click) — free in
   `GamepadInput` `BUTTON_INDEX`; VR: a controller button via `WebXRInput`).
   Add to `handleToggleKey`, `getCommand` (emit `hyperdrive: this.hyperdriveEngaged`
   as raw intent; eased level computed in Ship), and `getState`.

3. **`src/ship/Ship.js`** — own `hyperdriveLevel`; ease it toward intent each
   `update()`; inject eased level into the command before `physics.integrate`;
   expose `getHyperdriveLevel()`. Drive `hyperdrive_fx` sprite visibility +
   engine glow by level. Pass effective multiplier to `speedLines`.

4. **`src/rendering/SpeedLines.js`** — **port Racing's quad-mesh speed lines**
   (`plane.js:958-1176`): 4 verts/line, `aOffset/aEnd/aSide` attributes,
   CPU-accumulated `travelDistance` (anti-jitter), stretch ∝ `speedFactor·log(mult)`,
   opacity falloff at extreme speed, additive, `depthWrite:false`, parented to the
   exterior root. Keep `setMaxOpacity` and add `setSpeedThresholds(min,max)` +
   `setMultiplier(m)`. (The current 180-segment version is acceptable as an interim
   but does not deliver the hyperdrive read.)

5. **`src/rendering/RenderPipeline.js` + `DesktopPostFxPipeline.js` +
   `XRPostFxPipeline.js`** — add `setWarpDistortion(value)` mirroring
   `setWarpSpeedFactor`: desktop sets `warpPass.uniforms.distortion`, XR sets
   `this.warp.distortion` (already wired to `uWarpDistortion`). Lerp toward target
   for smoothness.

6. **`src/app/App.js`** (`_tick`, ~line 235) — replace the fixed `/600`:
   - compute `warpRef` from `ship.getHyperdriveLevel()` (§4.3) and set warp factor;
   - compute `fovFactor` (§4.3) and: on desktop apply capped `warpFovBoost` to the
     active camera in `_updatePilotChaseCamera` / `_updateDebugCamera`; call
     `setWarpDistortion` with desktop-vs-VR cap based on `xrActive`;
   - recalibrate `speedLines` thresholds/multiplier;
   - handle the hyperdrive toggle in `_handleGamepadButtons` and the keydown path;
   - feed hyperdrive state into telemetry + diegetic HUD.

7. **`src/config/*` + F2 panel** — add `hyperdrive` block (`enabled`, `hyperMult`,
   `safetyClamp`, spool times) and new `vrComfort` knobs (`fovBoostMaxDesktop`,
   `warpDistortionMaxDesktop`, `warpDistortionMaxVR`). Surface in
   `PostProcessingPanel` / `UniversePanel` so they are tunable live like the
   existing warp/comfort sliders.

8. **`src/ui/DiegeticStatusPanel.js` + telemetry HUD** — add a drive-state line:
   `DRIVE PRECISION` / `DRIVE HYPERDRIVE ⟳ 42%` (spooling) / `DRIVE HYPERDRIVE`.
   The panel already renders `MODE`/`PILOT`/`DAMP` (`DiegeticStatusPanel.js:98-101`)
   — follow that pattern.

---

## 6. Acceptance gates (test in browser, like prior phases)

- Toggle hyperdrive on/off; confirm **spool ramp** (thrust + FX rise over ~1 s, not
  instant) and HUD shows PRECISION → SPOOLING% → HYPERDRIVE.
- In precision, top speed still clamps at ~2,200 m/s and warp is **not** pinned
  during normal flight.
- In hyperdrive, speed builds past 2,200 m/s with no auto-stop; **dampeners and
  airbrake arrest it**; releasing thrust coasts (inertial).
- Cross from origin toward a far POI (use the nav HUD): reaching a ~400–500k POI
  takes **~10–17 s** in hyperdrive (vs ~3 min before).
- Speed lines **stretch and intensify** with speed and stay calibrated in both
  gears (no instant saturation, no jitter at high speed).
- Desktop: FOV widens (≤ +40°) and distortion ramps at very high speed, both
  capped; recovers smoothly on slow-down.
- VR: distortion ramps but stays ≤ `warpDistortionMaxVR`; no FOV change; speed
  lines + ship FX carry the read; setting `warpDistortionMaxVR = 0` yields a clean
  diegetic-only look with no code change.
- `hyperdrive_fx` sprites + engine glow track `hyperdriveLevel`.
- Unpiloted ship still coasts/gets bent by gravity (no regression of `App.js:210`).

---

## 7. Risks / open items

- **Unbounded speed × float precision:** at very high cruise, single-precision
  world coordinates degrade. The `HYPER_SAFETY_CLAMP` mitigates runaway; consider a
  later "origin rebase" (floating origin) if cruise distances cause jitter — out of
  scope here, note it.
- **Gravity at speed:** `GravityField.maxDistance = 70,000`, `maxAcceleration = 160`
  (`src/space/GravityField.js`). At hyperdrive speeds you blow past attractors in a
  frame or two, so slingshots barely register — acceptable, but if "gravity wells
  while cruising" is wanted later, raise `maxDistance` and/or add a speed-aware
  pull. Don't change it for this phase without a request.
- **Collision/POI flyby:** nothing stops you flying through a black hole at 50 km/s.
  Lethal/heat/tidal radii exist in `Landmarks.js` userData but aren't enforced on
  the ship yet — flag for a future "hazard" pass, not this one.
- **VR comfort:** see §4.4 warning. Keep caps conservative and config-driven.
- **Input collisions:** verify the chosen hyperdrive key/button doesn't clash with
  existing binds (`KeyC` pilot, `KeyZ` dampeners, `KeyX` airbrake, `ShiftLeft`
  boost; gamepad `triangle` interact, `square` dampeners, `circle` airbrake,
  `cross` boost, `l1/r1` yaw, `l2/r2` throttle). `r3`/`options` are free.

---

## 8. Quick reference — key source locations

- Racing flight model: `Racing/js/core/plane.js`
  (regime `103-258`, physics `366-489`, speed lines `958-1176`, FOV/distortion
  `1184-1221`).
- Racing warp shader: `Racing/js/postprocessing/WarpSpeedShader.js`.
- Current ship physics: `src/ship/ShipPhysics.js`.
- Current controls: `src/ship/ShipControls.js`.
- Current speed lines: `src/rendering/SpeedLines.js`.
- Warp wiring: `src/app/App.js:235-240`; `src/rendering/RenderPipeline.js:64`;
  `src/rendering/DesktopPostFxPipeline.js:97`; `src/rendering/XRPostFxPipeline.js:130`.
- Universe scale: `src/config/deepSpacePreset.js`, `src/config/universePresets.js`,
  `src/space/universe/CosmicWeb.js`.
- HUD: `src/ui/DiegeticStatusPanel.js`, `src/ui/UniverseNavigation.js`.
- Unused FX hook: `src/ship/ShipModelGLB.js:32` (`hyperdrive_fx`).
