# Universe Visual Roadmap — Toward Realistic & Breathtaking Deep Space

> **Status: PROPOSAL / BACKLOG.** This document captures concrete, code-grounded
> opportunities to push the procedural universe (Phase 07) from "very good" to
> "breathtaking and physically believable." Most of this remains a prioritized
> design backlog, with shipped slices called out inline, written against the current code in
> `src/space/universe/`, `src/space/BlackHole.js`, and `src/rendering/`.
>
> Each part references the exact files/lines it touches (or the files now used by
> an implemented slice), states the visual payoff, the rough effort, and —
> critically — the **VR cost**, because the
> renderer runs in stereo (`src/rendering/XRPostFxPipeline.js`) and every
> fragment-heavy effect costs ~2× in a headset.
>
> **Foundational dependency:** Parts 9–11 (approachable bodies, inside-the-nebula,
> asteroid fields) require the nested scale-level framework specified in
> [universe-scale-architecture.md](universe-scale-architecture.md). Build that
> framework before those parts — it changes the meaning of "position" and "size"
> everywhere.

---

## Table of Contents

**Tier 1 — Refine What Exists**

1. [Current State Summary](#part-0--current-state-summary)
2. [Part 1 — Physically-Based Star Color & Luminosity](#part-1--physically-based-star-color--luminosity)
3. [Part 2 — Galactic-Plane Band in the Backdrop](#part-2--galactic-plane-band-in-the-backdrop)
4. [Part 3 — Volumetric Nebulae (Emission + Absorption)](#part-3--volumetric-nebulae-emission--absorption)
5. [Part 4 — Black Hole: Doppler Beaming & Background Lensing](#part-4--black-hole-doppler-beaming--background-lensing)
6. [Part 5 — Unified 3D Density Field](#part-5--unified-3d-density-field)
7. [Part 6 — Galaxy Dust Lanes & HII Knots](#part-6--galaxy-dust-lanes--hii-knots)
8. [Part 7 — Image-Based Lighting from the Universe](#part-7--image-based-lighting-from-the-universe)
9. [Part 8 — Color Grading Polish](#part-8--color-grading-polish)

**Tier 2 — New Capability & Cinematics**

10. [Part 9 — Approachable Bodies: Stars, Planets & Systems](#part-9--approachable-bodies-stars-planets--systems)
11. [Part 10 — Inside the Nebula: Local Volumetric Fog](#part-10--inside-the-nebula-local-volumetric-fog)
12. [Part 11 — Asteroid Fields, Belts & Rings](#part-11--asteroid-fields-belts--rings)
13. [Part 12 — Relativistic Aberration & Doppler at Speed](#part-12--relativistic-aberration--doppler-at-speed)
14. [Part 13 — Auto-Exposure / Eye Adaptation](#part-13--auto-exposure--eye-adaptation)
15. [Part 14 — Star Anti-Aliasing & Temporal Stabilization](#part-14--star-anti-aliasing--temporal-stabilization)
16. [Part 15 — Lens Flare, Starburst & God Rays](#part-15--lens-flare-starburst--god-rays)
17. [Part 16 — Deep-Field Micro-Galaxies & General Lensing](#part-16--deep-field-micro-galaxies--general-lensing)
18. [Part 17 — A Living, Dynamic Universe](#part-17--a-living-dynamic-universe)
19. [Part 18 — Hierarchical Structure & Vista Direction](#part-18--hierarchical-structure--vista-direction)

**Cross-Cutting**

20. [VR Performance Budget](#vr-performance-budget)
21. [Suggested Sequencing](#suggested-sequencing)

---

## Part 0 — Current State Summary

What already exists and works well (so we don't regress it):

- **`CosmicWeb.js`** — large-scale structure: seeded nodes, nearest-3 filaments,
  voids, forced dense spawn node. All generators bias-sample it.
- **`StarField.js`** — near/mid/background layers, shader points with twinkle,
  diffraction glints on the brightest stars, hero lights for dynamic lighting.
- **`GalaxyField.js`** — spiral/elliptical/irregular galaxies, points + impostor
  sprite LOD swap by distance.
- **`NebulaField.js`** — additive point-sprite nebulae (fbm in fragment),
  star clusters, filament dust.
- **`BlackHole.js`** — ray-marched accretion disk **with gravitational lensing**
  and pulsar jets. This already proves we have raymarching capability.
- **Post-FX** — `DesktopPostFxPipeline.js` (UnrealBloom + ACES + warp + stylize)
  and `XRPostFxPipeline.js` for stereo.
- **`SkyDeepSpace.js`** — gradient dome + 4800 camera-locked backdrop stars.

The gaps below are what stand between this and "breathtaking."

---

## Part 1 — Physically-Based Star Color & Luminosity

**Problem.** `src/space/universe/StarField.js:5` defines a 4-entry hardcoded
palette (`STAR_PALETTE`), and `brightnessSeed` (line 84) is generated
*independently* of color. Real fields read as real because of two correlations
we currently break.

**Proposal.**
- Replace the discrete palette with a **blackbody temperature → RGB** ramp
  (~2000 K deep red → ~30000 K blue-white). Sample a temperature per star, then
  convert to color.
- Drive a **luminosity function**: cool red dwarfs overwhelmingly common and
  faint; hot blue giants rare, intrinsically brighter, larger halo. Couple
  `brightnessSeed` and `gl_PointSize` to the sampled temperature so hot = rare +
  bright + big.
- Keep `temperatureBias`/`saturation` config knobs working as global shifts on
  the ramp.

**Touches.** `StarField.js` (`_temperatureWeights`, `_createLayer`, vertex
shader size term). Add a `blackbody(tempK) -> THREE.Color` helper, likely in
`src/space/universe/rng.js` or a new `starColor.js`.

**Payoff.** High — this is the subconscious cue that sells a starfield.
**Effort.** Low. **VR cost.** None (CPU-side generation + same shader cost).

---

## Part 2 — Galactic-Plane Band in the Backdrop

**Problem.** `src/rendering/SkyDeepSpace.js:82` scatters 4800 backdrop stars
*uniformly* on the dome sphere. Every viewing direction looks statistically
identical — there is no "place."

**Proposal.**
- Concentrate backdrop star density along a great-circle band (the galactic
  plane) with falloff away from it, instead of uniform spherical distribution.
- Add a faint emissive haze ribbon (unresolved-star glow) along the band.
- Cut a **dark dust rift** through the band (density notch) for the
  characteristic Milky Way silhouette.

**Touches.** `SkyDeepSpace.js` (`_createStarfield` distribution + the dome
fragment shader for the haze/rift band). Add a band orientation to
`src/config/deepSpacePreset.js`.

**Payoff.** High — instantly makes every direction feel like a location.
**Effort.** Low–Medium. **VR cost.** Negligible (backdrop is camera-locked, drawn once).

---

## Part 3 — Volumetric Nebulae (Emission + Absorption)

**Problem.** `src/space/universe/NebulaField.js` renders gas as additive point
sprites with fbm in the fragment. They read as flat puffs, and because
everything is `THREE.AdditiveBlending`, **nothing ever occludes** — there is no
depth, no dust, no silhouette.

**Proposal.** Reuse the raymarch technique already proven in
`src/space/BlackHole.js:117`:
- Ray-march a 3D fbm volume with **emission + absorption** (not pure additive),
  so dense dust lanes silhouette against glowing gas — the Pillars-of-Creation
  read that creates real depth.
- Real emission-line palettes: H-alpha red, OIII teal/green, reflection-blue.
- Let embedded bright stars / clusters tint and light the surrounding gas.

**LOD is mandatory (see [VR budget](#vr-performance-budget)):**
- Full raymarch (24–40 steps) only for the nearest 1–2 nebulae.
- Billboard impostors (the pattern `GalaxyField.js` already uses) for the rest.
- Step count scales down with distance; an XR-specific cap halves it in-headset.

**Touches.** `NebulaField.js` (new volumetric material + per-nebula LOD swap,
mirroring the galaxy points/sprite swap in `GalaxyField.js:30`). Possibly a new
`src/space/universe/VolumetricNebula.js`.

**Payoff.** Highest single visual jump. **Effort.** High.
**VR cost.** High — must be LOD-gated and capped.

---

## Part 4 — Black Hole: Doppler Beaming & Background Lensing

**Problem.** `src/space/BlackHole.js` already lenses and ray-marches the disk,
but `getDensity` (line 80) is rotationally symmetric and only the disk is bent —
the background starfield behind it is not.

**Proposal.**
- **Relativistic Doppler beaming**: the disk side rotating *toward* the camera
  should be dramatically brighter/bluer, the receding side dimmer/redder. Add an
  asymmetric brightness/color term keyed to the tangential velocity direction.
  This is the signature Gargantua look and is only a few shader lines.
- **Background lensing**: sample the lensed ray direction against the background
  (warped Einstein-ring halo of stars), not just the disk.

**Touches.** `BlackHole.js` fragment shader (`getDensity`, the disk emission
block around line 143, and the main raymarch loop). Background lensing needs the
starfield/sky reachable as a sampleable source (cubemap — ties into
[Part 7](#part-7--image-based-lighting-from-the-universe)).

**Payoff.** High — turns an already-good black hole into a centerpiece.
**Effort.** Medium (beaming low, background lensing medium).
**VR cost.** Medium (already raymarched; beaming is ~free, lensing adds samples).

---

## Part 5 — Unified 3D Density Field

**Problem.** `src/space/universe/CosmicWeb.js:18` places nodes with
`randomPointInSphere` and connects nearest-3. Stars, gas, and galaxies each
sample the web semi-independently, so their correlation is loose.

**Proposal.** Promote the web to a **single shared 3D scalar density field**
(value/curl noise or a Voronoi distance field) that *all* generators read. Dense
regions then get stars **and** glowing gas **and** more galaxies together; voids
become genuinely empty. That spatial coherence is what makes real sky surveys
look non-random — we're ~70% there with the web today; this is the missing 30%.

**Touches.** `CosmicWeb.js` (`sample` becomes a field query), with
`StarField.js`, `NebulaField.js`, `GalaxyField.js` reading the same field.

**Payoff.** Medium-High (quiet but foundational realism).
**Effort.** Medium-High (touches all generators). **VR cost.** None (CPU-side).

---

## Part 6 — Galaxy Dust Lanes & HII Knots

**Problem.** `src/space/universe/GalaxyField.js:135` (`_galaxyPoint`) builds clean
spiral arms with no dark dust lanes and none of the pink star-forming knots that
trace real arms.

**Proposal.**
- Per-arm darkening bands (dust lanes) along the spiral.
- A scatter of bright magenta/pink points (HII regions) along the arms.
- A brighter, warmer central bulge.

**Touches.** `GalaxyField.js` (`_galaxyPoint`, color assignment in
`_createGalaxy`, and the impostor texture in `src/space/universe/impostors.js`).

**Payoff.** Medium (instant "Hubble photo" read on near galaxies).
**Effort.** Low–Medium. **VR cost.** None (same point cost).

---

## Part 7 — Image-Based Lighting from the Universe

**Problem.** Lighting is point-light based (`UniverseLighting.js` + hero lights).
The ship interior/cockpit doesn't pick up environment color, so it reads
disconnected from the surrounding space.

**Proposal.** Bake a low-res cubemap of the surrounding field (stars + nebulae +
nearest galaxy) and use it as an environment map so the **ship interior**
reflects nebula/star color. Re-bake occasionally (on region change / throttled),
not per frame. This cubemap also feeds [Part 4](#part-4--black-hole-doppler-beaming--background-lensing)'s background lensing.

**Touches.** New capture step in `Universe.js` / `App.js`; ship materials consume
`scene.environment`.

**Payoff.** Medium-High (cohesion between ship and space).
**Effort.** Medium. **VR cost.** Low if re-baked rarely.

---

## Part 8 — Color Grading Polish

**Problem.** `src/rendering/DesktopPostFxPipeline.js` already does UnrealBloom +
ACES tonemapping, which is a strong base — but the palette isn't unified and void
black levels aren't art-directed.

**Proposal.** A subtle filmic LUT / color-grade pass and controlled
(lifted-but-not-washed) black levels in the void, applied consistently across
desktop and XR pipelines.

**Touches.** `DesktopPostFxPipeline.js` + `XRPostFxPipeline.js` (new grade pass
or fold into existing chain), config in `src/config/postFxPresets.js`.

**Payoff.** Medium (unifies the whole look). **Effort.** Low–Medium.
**VR cost.** Low (one full-screen pass).

---

# Tier 2 — New Capability & Cinematics

> Tier 1 refines what's already on screen. Tier 2 adds things the universe
> currently can't do at all: bodies to arrive at, being *inside* phenomena,
> relativistic motion, and a universe with history. These are bigger swings —
> more content and systems, not just shader tweaks.

---

## Part 9 — Approachable Bodies: Stars, Planets & Systems

> **Status: FIRST SYSTEM SLICE IMPLEMENTED.** The System tier exists and is wired
> into the scale stack. Every non-background local star in `StarField.js` (`near`
> and `mid` layers, in both root Universe and Galaxy levels) is an approachable
> System anchor. Entering a star at PRECISION speed creates `SystemContents` with
> an animated `StarBody`, generated `PlanetBody` worlds/gas giants/rings, POIs,
> gravity attractors, floating-origin support, and seed-only deterministic
> regeneration. Background stars remain camera-locked backdrop and are not
> approach targets.

**Problem.** Stars are points (`StarField.js`) and the only bodies you can fly
*to* are black holes, pulsars, and anomalies (`src/space/universe/Landmarks.js`).
The universe is breathtaking at distance but has nothing to arrive at — every
journey ends at a billboard.

**Proposal.**
- **Implemented first slice — stars as real spheres** when approached: corona, surface granulation
  (animated 3D noise), flares, limb darkening. A local star point descends into a
  generated `System` level within a deliberately tiny entry shell
  (`clamp(luminosity×45m, 30m, 90m)`).
- **Implemented first slice — planets & systems**: gas giants with banded atmospheres, ringed planets,
  terrestrial worlds. The first slice is procedural and deterministic from the
  star seed.
- Reuse the LOD swap pattern from `GalaxyField.js:30` (point/impostor → sphere)
  so distant systems stay cheap.

**Touches.** Implemented as `src/space/universe/StarBody.js`,
`PlanetBody.js`, and `SystemContents.js`, wired through `StarField.js`,
`Level.js`, `ScaleStack.js`, `scaleTiers.js`, and `Universe.js` POI/attractor
flows.

**Payoff.** Very High — closes the biggest content gap.
**Effort.** High. **VR cost.** Low–Medium (LOD-gated; only nearest few are spheres).

> **Dependency satisfied for the first slice:** the nested scale-level
> framework now includes System descent. Remaining Part 9 work is richer system
> content: moons, belts, comets, better atmospheres, planet/orbit descent, and
> eventual Planetary / Surface tiers.
>
> **Planet visual pass shipped:** [planet-visual-system-revamp.md](planet-visual-system-revamp.md)
> adds typed planet descriptors, six guaranteed terrestrial archetypes visible in
> the System tier, biome/material variety, stronger terrain readability, and the
> shared deterministic surface model used by render geometry, collision, landing,
> and surface EVA.

---

## Part 10 — Inside the Nebula: Local Volumetric Fog

**Problem.** Nebulae are distant objects you look *at*; flying into one does
nothing. The most uniquely-VR moment available — being enveloped in glowing gas —
is missing.

**Proposal.** When the ship enters a nebula's radius, blend in **local
participating media**: in-scattering fog tinted by the nebula palette, density
driven by the same 3D field as the volume ([Part 3](#part-3--volumetric-nebulae-emission--absorption)),
embedded stars lighting the gas around the cockpit. Fades smoothly with the
existing `fogDensity` machinery as a base.

**Touches.** `NebulaField.js` (proximity test + local fog volume), scene
fog/`UniverseLighting.js`, and the post-FX chain for in-scatter. Coordinate with
`Universe.update()` which already has `shipPosition`.

**Payoff.** Very High — the signature "you are there" VR moment.
**Effort.** Medium–High. **VR cost.** Medium (local volume only when inside; LOD by density).

> ⚠️ **Depends on** [universe-scale-architecture.md](universe-scale-architecture.md).
> "Inside the nebula" is a level/scale context (a `Galaxy`- or `System`-tier
> phenomenon you descend into), so it rides on the transition + local-origin
> machinery rather than a one-off proximity test in today's single space.

---

## Part 11 — Asteroid Fields, Belts & Rings

**Problem.** Nothing whips past the ship. Without near-field objects at speed,
the sense of velocity and scale is muted even with the warp FX.

**Proposal.** Dense instanced particle/mesh volumes — asteroid belts, debris
fields, planetary rings — placed at systems (Part 9) and some filaments. Real
parallax streaming past the cockpit is what makes speed *visceral*. Use GPU
instancing and the floating-origin rebase already in `Universe.rebaseOrigin`.

**Touches.** New `src/space/universe/DebrisField.js`, instanced; hooked into
systems/landmarks and the rebase path in `Universe.js:218`.

**Payoff.** High (speed + scale). **Effort.** Medium.
**VR cost.** Low–Medium (instanced; cull aggressively).

> ⚠️ **Depends on** [universe-scale-architecture.md](universe-scale-architecture.md).
> Belts/rings are **System-** and **Planetary-tier contents** placed around real
> bodies, so they need the level framework and its local origin to sit at the
> right scale.

---

## Part 12 — Relativistic Aberration & Doppler at Speed

**Problem.** Hyperdrive (phase-08, `WarpSpeedShader`) warps the screen but the
star field itself doesn't respond to velocity the way real starlight would.

**Proposal.** Drive two physically-real effects from the speed/heading already
computed for warp:
- **Aberration** — at high speed the star field compresses and bunches toward the
  direction of travel.
- **Doppler shift** — stars blueshift ahead, redshift behind, and dim/brighten
  with beaming.

Reuses motion data you already have; rarely implemented elsewhere, so it reads as
a signature feature. Pairs with the warp distortion already eased in `App._tick`.

**Touches.** `StarField.js` vertex/fragment shaders (velocity uniform + heading),
fed from the same speed source as `RenderPipeline.setWarpSpeedFactor`.

**Current update.** Implemented as a shader-space effect on `StarField`:
`App._updateSpeedFx` derives an eased perceptual beta from the same normalized
hyperdrive `speedFactor` that drives warp, forwards it through
`Universe.setRelativisticState`, and `StarField` applies aberration plus
directional Doppler/beaming per point. The F2 panel now exposes a dedicated
`Relativistic Stars` group (`enabled`, `intensity`, `maxBeta`,
`debugOverrideEnabled`, `debugBeta`) so the effect can be tuned or forced visible
without reaching hyperdrive speed.

**Related fix.** `Warp > debugSpeedFactor` is no longer a permanent floor. It only
overrides speed-driven warp when `Warp > debugOverrideEnabled` is checked, so the
warp effect scales with hyperdrive speed by default.

**Payoff.** High — signature, physically correct, leverages existing hyperdrive.
**Effort.** Medium. **VR cost.** Low (vertex/fragment math on existing points).

---

## Part 13 — Auto-Exposure / Eye Adaptation

**Problem.** `renderer.toneMappingExposure` is static (`App.js:962`). Flying from
a blazing nebula core into a black void keeps the same exposure, which is both
unrealistic and undramatic.

**Proposal.** HDR luminance histogram / average-luminance feedback that eases
exposure over ~0.5–1.5 s — bright scenes settle down, the void slowly reveals
faint detail. Clamp the range so it never crushes or blows out, and keep it
gentle in VR (fast exposure swings can cause discomfort).

**Touches.** `DesktopPostFxPipeline.js` + `XRPostFxPipeline.js` (luminance pass +
eased exposure), `App.js` exposure write, config in `postFxPresets.js`.

**Payoff.** Medium–High (cinematic + realistic). **Effort.** Medium.
**VR cost.** Low (one downsample pass) — but tune easing for comfort.

---

## Part 14 — Star Anti-Aliasing & Temporal Stabilization

**Problem.** Point stars shimmer, crawl, and pop at distance — a genuine fidelity
bug, not just polish. Sub-pixel points flicker as the camera moves, and the
diffraction glints in `StarField.js` aggravate it.

**Proposal.** Stabilize distant stars: enforce a minimum sub-pixel footprint with
energy-preserving dimming (a star that shrinks below a pixel gets fainter, not
flickery), and/or a light temporal accumulation on the star layers. Critical for
VR where shimmer is very noticeable and fatiguing.

**Touches.** `StarField.js` vertex shader (size floor + brightness compensation),
optionally a temporal pass in the post-FX chain.

**Payoff.** Medium–High (removes a constant low-grade distraction).
**Effort.** Low–Medium. **VR cost.** Low.

---

## Part 15 — Lens Flare, Starburst & God Rays

**Problem.** The brightest sources (suns from Part 9, the black hole) read as
bright blobs; there's no camera-lens character or volumetric shafting.

**Proposal.**
- **Anamorphic flare / starburst** on the brightest sources.
- **Volumetric god rays** (radial occlusion blur) from bright stars through
  nebula dust.

**⚠️ VR caveat:** screen-space lens flares fight stereo fusion and can break
immersion. Gate flares to desktop or keep them very subtle in-headset; god rays
are safer in VR than lens dirt.

**Touches.** Post-FX chain (`DesktopPostFxPipeline.js`, optionally
`XRPostFxPipeline.js`), driven by bright-source screen positions from `Universe`.

**Payoff.** Medium (cinematic punch). **Effort.** Medium.
**VR cost.** Medium — desktop-first; gate carefully for XR.

---

## Part 16 — Deep-Field Micro-Galaxies & General Lensing

**Problem.** The backdrop (`SkyDeepSpace.js`) is stars + dome only; the famous
Hubble-deep-field read (thousands of tiny distant galaxies everywhere) is absent.
Lensing only happens at black holes.

**Proposal.**
- **Deep-field micro-galaxies** — scatter thousands of tiny faint colored
  galaxy smudges into the dome, redshift-tinted by apparent distance. Nearly free
  and instantly evokes the deep field.
- **General gravitational lensing** — Einstein rings around the most massive
  galaxies, not just black holes.

**Touches.** `SkyDeepSpace.js` (micro-galaxy layer in the dome), `GalaxyField.js`
+ a lensing pass for massive-galaxy rings (shares the cubemap from [Part 7](#part-7--image-based-lighting-from-the-universe)).

**Payoff.** Micro-galaxies: High-for-the-cost. Lensing: Medium.
**Effort.** Micro-galaxies Low; lensing Medium–High.
**VR cost.** Micro-galaxies negligible (camera-locked dome); lensing Medium.

---

## Part 17 — A Living, Dynamic Universe

**Problem.** `src/space/universe/UniverseEvents.js` fires transient events
(supernova, pulsar sweep, comet, ion storm) but they leave no trace — the
universe has no history or persistent motion.

**Proposal.**
- **Persistent supernova remnant shells** — a supernova leaves a Veil/Crab-style
  expanding filament shell behind.
- **Pulsar lighthouse beams** that physically sweep and illuminate the ship.
- **Comets with correct dual tails** — straight blue ion tail + curved yellow
  dust tail, both anti-sunward from the nearest star.
- **Variable / eclipsing binary stars**; **interacting-galaxy tidal streams**.
- **Audio-reactive coupling** — bloom/event pulses keyed to the audio engine
  (`src/audio/`). Synesthetic rather than realistic, so optional — but striking.

**Touches.** `UniverseEvents.js` (persistent spawns), `Landmarks.js` (pulsar
beams), `GalaxyField.js` (tidal streams), and an `AudioDirector` ↔ visual hook.

**Payoff.** Medium–High (the universe feels alive and remembered).
**Effort.** Medium (per feature; pick à la carte). **VR cost.** Low–Medium per item.

---

## Part 18 — Hierarchical Structure & Vista Direction

**Problem.** Stars, gas, and galaxies are co-located fields sampled from the web,
but there's no nested order (galaxy → cluster → system → star + planets), and
composition at spawn is left to pure RNG.

**Proposal.**
- **Hierarchical structure** — nodes become real systems containing a star,
  planets, and a belt; clusters group systems; the density field
  ([Part 5](#part-5--unified-3d-density-field)) ties tiers together. This is what
  makes a universe feel *authored by physics* rather than scattered.
- **"Vista director"** — curated/seed-tuned guarantees of a strong *composition*
  at spawn (a hero object framed against a nebula), instead of trusting RNG to
  frame well.
- **Named asterisms** — recognizable star patterns for navigation memorability.

**Touches.** `CosmicWeb.js` (hierarchy on top of nodes), `Universe.js`
(generation orchestration + spawn framing), all generators consume the hierarchy.

**Payoff.** Medium–High (systemic believability + reliably great first sight).
**Effort.** High (architectural). **VR cost.** None (generation-time).

---

## VR Performance Budget

The renderer runs in **stereo** (`src/rendering/XRPostFxPipeline.js`), with
floating origin and impostor LOD already in place — the project clearly budgets
carefully. Hard rules for everything above:

- **Fragment-heavy effects cost ~2×** in a headset. Raymarched volumetrics
  (Part 3) and background lensing (Part 4) are the expensive items.
- **Volumetrics must be LOD-gated**: full raymarch only for the nearest 1–2
  nebulae; impostors for the rest; step count scales with distance; an
  XR-specific cap halves steps in-headset.
- **CPU-side generation (Parts 1, 2, 5, 6) is effectively free at runtime** —
  cost is paid once at regeneration.
- Profile any new full-screen pass (Parts 4, 8) against the XR frame budget
  before shipping it on by default.

---

## Suggested Sequencing

Ordered by payoff-per-effort and VR safety. Tier 1 (refine) and Tier 2 (new
capability) are interleaved so quick wins land early and big swings build on the
foundations they need.

**Wave 1 — Cheap, VR-safe, high perceptual gain**

1. **Part 1 — Blackbody stars + luminosity function.** Cheap, VR-free, big
   perceptual gain. Best starting point.
2. **Part 2 — Galactic-plane band.** Cheap, VR-safe, makes every direction a place.
3. **Part 14 — Star anti-aliasing.** Removes a constant low-grade shimmer; small fix.
4. **Part 16 (micro-galaxies) — Deep-field smudges.** Nearly free, instant deep-field read.
5. **Part 6 — Galaxy dust lanes & HII knots.** Low-risk, instant "Hubble" read.

**Wave 2 — Signature features on existing systems**

6. **Part 12 — Relativistic aberration & Doppler.** Leverages hyperdrive; signature, cheap.
7. **Part 4 (beaming) — Black hole Doppler.** Few lines, signature payoff.
8. **Part 13 — Auto-exposure / eye adaptation.** Cinematic; tune easing for VR comfort.

**Wave 3 — Foundations for the big swings**

9. **Part 5 — Unified density field.** Foundational; schedule before Part 3 / Part 18.
10. **Part 7 — IBL** and **Part 4 (background lensing)** together (shared cubemap).
11. **Part 18 — Hierarchical structure & vista direction.** Architectural; unlocks Part 9.
12. **Scale-level framework** —
    [universe-scale-architecture.md](universe-scale-architecture.md). Grow/enrich
    the top-level Universe, then build `LevelManager` + the transition rule.
    **Universe ↔ Galaxy and System descent are now live; this remains the
    prerequisite track for Parts 10–11 and deeper tiers.**

**Wave 4 — Content & the uniquely-VR moments** *(rides on the Wave 3 scale framework)*

13. **Part 3 — Volumetric nebulae.** Highest visual payoff; needs the VR LOD work.
14. **Part 10 — Inside-the-nebula fog.** The signature VR moment; builds on Part 3 + scale levels.
15. **Part 9 — Approachable stars/planets/systems (first slice shipped).** System-tier
    contents are live; richer system ecology and Planetary/Surface tiers remain.
16. **Part 11 — Asteroid fields & rings.** System/Planetary-tier contents; pairs with Part 9.

**Wave 5 — Polish & life**

17. **Part 17 — Living universe** (remnants, beams, comet tails, audio-reactive). À la carte.
18. **Part 15 — Lens flare & god rays.** Desktop-first; gate for XR.
19. **Part 16 (general lensing) — Einstein rings** around massive galaxies.
20. **Part 8 — Color grade.** Final unifying polish.
