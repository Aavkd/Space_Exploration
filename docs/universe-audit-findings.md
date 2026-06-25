# Universe Audit — Concrete Code Findings

> **Status: AUDIT / BACKLOG.** Five code-grounded issues found in the shipped
> scale-stack + System-tier slice and the star field, during a state-of-the-universe
> audit (2026-06-25). Each is a real correctness, performance, or
> design-contract gap in code that already runs — distinct from the broader
> "not yet built" backlog in
> [universe-visual-roadmap.md](universe-visual-roadmap.md). Listed roughly by
> impact.
>
> Companion to [universe-scale-architecture.md](universe-scale-architecture.md)
> (§5 determinism, §6 scale, §7 backdrop bake) and roadmap
> [Part 14 (star AA)](universe-visual-roadmap.md#part-14--star-anti-aliasing--temporal-stabilization).

---

## Table of Contents

1. [Per-frame O(N) over all star anchors](#1--per-frame-on-over-all-star-anchors)
2. [Planets are not lit by their own star](#2--planets-are-not-lit-by-their-own-star)
3. [System backdrop discards the parent level](#3--system-backdrop-discards-the-parent-level)
4. [Star anti-aliasing floor worsens shimmer](#4--star-anti-aliasing-floor-worsens-shimmer)
5. [Impostor-vs-reality radius mismatch](#5--impostor-vs-reality-radius-mismatch)
6. [Entered galaxies all look the same](#6--entered-galaxies-all-look-the-same)
7. [System sky is not coherent with its galaxy](#7--system-sky-is-not-coherent-with-its-galaxy)

**Cross-cutting**

- [Root-cause note — architecture §7 (Backdrop Inheritance) is unimplemented](#root-cause-note--architecture-7-backdrop-inheritance-is-unimplemented)

---

## 1 — Per-frame O(N) over all star anchors

> **Status: FIXED (2026-06-25).** `getSystemPOIs` now runs allocation-free in
> squared distance: world positions are computed component-wise (no `Vector3`
> clone), a squared-distance shortlist gate rejects before any allocation, and
> the single `sqrt` is deferred to the small returned set. Verified live against
> the root universe (**64,900** anchors) — results stay sorted ascending with no
> `_distanceSq` leak. The per-anchor `_systemAnchorPosition` clone is gone.

**Severity:** Performance (scales with star count; worst inside Galaxy tier).

**Where.**
- `src/space/universe/StarField.js:145` — every non-background star (`near` +
  `mid` layers) is pushed into `this.systemAnchors`, each holding a cloned
  `THREE.Color` and `THREE.Vector3`.
- `src/space/universe/StarField.js:46` — `getSystemPOIs` iterates **all** anchors,
  computing a `distanceTo` (a `sqrt`) per anchor.
- `src/space/Universe.js:43` — `Universe.update` calls `this.getPOIs(shipPosition, 16)`
  **every frame**, which calls `getSystemPOIs` (plus sorts the structure list).

**Problem.** In the Galaxy-tier config (`src/config/scaleTiers.js:81`)
`nearCount = 9,800` and `midCount = 32,000`, so `systemAnchors` holds
**~41,800** objects. Every rendered frame walks the entire array doing ~41,800
`distanceTo` calls (square roots), on top of building and sorting the structure
POI list. This is pure per-frame CPU overhead that grows linearly with the star
budget, and it runs even when the navigation HUD does not need a fresh list that
frame.

**Suggested fix.**
- Spatial-index the anchors (reuse `SpatialIndex` already in `Universe.js:8`) so
  nearest-system queries are bounded, **or**
- Throttle the POI rebuild (every N frames / on ship-moved-far), **or**
- Use squared distance and skip the `sqrt` until the final shortlist.

---

## 2 — Planets are not lit by their own star

**Severity:** Correctness / immersion (visible the moment you orbit a planet).

**Where.**
- `src/space/universe/PlanetBody.js:160` (gas) and `:219` (terrestrial) — the
  fragment shaders hardcode a light direction:
  `max(dot(normalize(vNormal), normalize(vec3(-0.5, 0.4, 0.8))), 0.0)`.
- `src/space/universe/PlanetBody.js:88` — the cloud layer uses
  `MeshPhongMaterial`, which **is** lit by the real star `PointLight` added in
  `src/space/universe/SystemContents.js:23-24`.

**Problem.** A planet's lit hemisphere points at a fixed world direction instead
of at the star at the centre of the system. As the planet orbits
(`PlanetBody.update`), its day side stays glued to `(-0.5, 0.4, 0.8)` rather than
tracking the sun. Worse, the cloud shell *is* correctly lit by the star, so
clouds and surface disagree about where "day" is on the same planet.

**Suggested fix.** Pass the star's world position (or the planet→star direction)
into the gas/terrestrial materials as a uniform and light against it, matching
the `PointLight` the clouds already use. Update the uniform in `PlanetBody.update`
(or derive it in-shader from a uniform star position).

---

## 3 — System backdrop discards the parent level

**Severity:** Design-contract violation (scale-architecture §7).

**Where.** `src/space/universe/SystemContents.js:165` (`_createBackdrop`) builds
2,600 random points on a shell as the system's sky.

**Problem.** `universe-scale-architecture.md` §7 states: *"from a solar system you
still see the rest of the galaxy."* On descent into a System, the surrounding
galaxy is removed (the parent group is hidden by `ScaleStack`) and replaced with a
**generic random star field** that bears no relation to the galaxy just left. The
"baked parent backdrop" promise (§7, §4.4) is unmet — there is no inheritance of
the parent's appearance, so the view is disconnected from where you descended
from. (The scale doc's Status section already flags "true backdrop bake / IBL"
as deferred; this entry records the concrete spot where the placeholder lives.)

**Suggested fix.** Bake the parent level into a cubemap / impostor sky on descent
(the real §7 work, shared with roadmap
[Part 7 IBL](universe-visual-roadmap.md#part-7--image-based-lighting-from-the-universe)),
or — as a cheaper interim — seed `_createBackdrop` from the parent galaxy's
descriptor (palette, core direction, plane orientation) so the system sky at
least resembles the galaxy it sits inside.

---

## 4 — Star anti-aliasing floor worsens shimmer

**Severity:** Fidelity (the exact problem roadmap Part 14 set out to fix).

**Where.** `src/space/universe/StarField.js:206`:
```glsl
gl_PointSize = clamp(px, 1.8, 30.0);
```

**Problem.** Roadmap
[Part 14](universe-visual-roadmap.md#part-14--star-anti-aliasing--temporal-stabilization)
asks for **energy-preserving dimming**: a star whose footprint shrinks below a
pixel should get *fainter*, not be floored to a fixed size. The current hard
`1.8`px floor does the opposite — distant sub-pixel stars are all forced to the
same ~2px dot and continue to twinkle (`vAlpha` in `StarField.js:193`), which
produces exactly the crawl/flicker Part 14 was meant to remove. The diffraction
glints (`vSpike`) aggravate it further.

**Suggested fix.** When the computed `px` falls below the floor, fade brightness
by the area ratio (`(px/floor)^2`) instead of clamping size up — so a star that
would be sub-pixel dims smoothly toward zero rather than shimmering at a fixed
footprint. Optionally damp `twinkle` amplitude for the smallest stars.

---

## 5 — Impostor-vs-reality radius mismatch

> **Status: FIXED (2026-06-25).** Both sizes now derive from one luminosity-keyed
> function in `starColor.js`: `starBodyRadius(luminosity)` is the canonical
> System-tier render radius, and the impostor/POI `systemRadius` is
> `starImpostorRadius = starBodyRadius × 0.145`. `StarField` (anchors + hero
> lights) and `SystemContents` (the entered `StarBody`) both call these with the
> same seed-carried luminosity, so the seen and entered sizes are proportional.
> Verified live: impostor radius equals `starBodyRadius(lum) × 0.145` to <0.5u
> across the sampled stars.

**Severity:** Minor determinism gap (scale-architecture §5).

**Where.**
- `src/space/universe/StarField.js:154` — the anchor's `systemRadius` is
  `lerp(850, 2100, …)`, used for the POI radius and (via `Level.js`) the entry
  shell.
- `src/space/universe/SystemContents.js:114` — the actual `StarBody` radius on
  entry is `clamp(randomRange(6200, 9000) + luminosity*2500, 5600, 14500)`.

**Problem.** The size you "saw" (the anchor/impostor's `systemRadius`,
850–2,100) has no derived relationship to the size you "enter" (the StarBody,
5,600–14,500). The scale doc's §5 contract — *the parent-level representation and
the child-level reality must be derived from the same seed so they agree* — is
only half-honored: color and temperature carry across via the seed, but size does
not. The object effectively "changes size" on entry. Low impact today (the entry
shell is generous and the swap is veiled), but it undercuts the determinism
guarantee the architecture leans on.

**Suggested fix.** Derive both the impostor `systemRadius` and the `StarBody`
radius from the same seed-derived function of luminosity/temperature, so the seen
and entered sizes are consistent (and proportional, even if the entered scale is
compressed for the current diorama-scale System tier).

---

## 6 — Entered galaxies all look the same

> **Status: FIXED (2026-06-25).** All four contributing causes addressed, plus
> three follow-on visual-match issues found during live testing:
>
> **6a** galaxy descent now spawns at a scenic standoff above the disk plane
> (`Level.js` `createGalaxyLevel` sets `entryPosition = (0, 0.42R, 0.52R)`,
> ~0.67×`regionRadius` out) instead of `(0,0,0)`.
>
> **6b** `buildGalaxyConfig` (`scaleTiers.js`) is now descriptor-aware via
> `galaxyTypeProfile` — star `temperatureBias`/`saturation`/`brightness` and
> nebula/HII/gas counts vary by type (elliptical → red, gas-poor; irregular →
> blue, gas-rich; spiral → mixed).
>
> **6c** interior opacity/brightness lifted (0.26→0.52, 0.78→1.18) and a new
> `particleScale` (1.5) enlarges the disk/HII footprint so the structure reads
> as the defining feature of the level.
>
> **6d** `galaxyPalette` (`GalaxyField.js`) widens hue/sat spread (±0.08→±0.22)
> and leans hard into type tints (amber ellipticals, teal/pink irregulars,
> blue/gold spirals). The seed-descent contract (§5) is preserved: the widened
> palette is still seeded from the descriptor's rng, so the impostor seen and
> the interior entered share one palette.
>
> **Follow-on — stars not in arms/clouds:** the ~90k `StarField` near/mid stars
> were placed by the cosmic-web sampler (spherical scatter), disconnected from
> the `GalaxyInteriorField` structure. Fixed by extracting the shared disk/arm
> distribution into `galaxyShape.js` (`sampleGalaxyDiskPoint`) and using it in
> both `GalaxyInteriorField._sampleDiskPoint` and `StarField._createLayer` when
> `config.global.parentGalaxy` is present. Near stars arm-bias (`preferArms =
> true`), mid stars fill the broad disk. Verified: mean |Y| ≈1700 vs mean XZ
> radius ≈47000 (28:1 flat disk) for a 6-arm spiral.
>
> **Follow-on — gas color mismatch:** `GalaxyInteriorField._createGasClouds` was
> shifting the palette toward hardcoded `#3fd6ff`/`#ff6f9f`, making the entered
> gas a different color from the impostor. Fixed by using the descriptor's own
> `palette.inner`/`palette.outer` directly for gas tint (`GalaxyInteriorField.js`).
>
> **Follow-on — elliptical blown out to white:** dense Gaussian bulge stars
> summed under additive blending to white, obliterating the red tint. Fixed by
> reducing in-galaxy star brightness (×0.42 base, ×0.58 for elliptical profile)
> and bloom (≤0.36) in `buildGalaxyConfig`, and pulling star render colors 64%
> toward the galaxy palette by radius (`GALAXY_STAR_TINT = 0.64` in
> `StarField.js`). Raw blackbody color is preserved for system anchors/lighting.

**Severity:** Perceptual / design — entered galaxies feel interchangeable
regardless of the impostor you approached. **Not** a determinism bug.

**Investigation (live, 2026-06-25).** Driving real descents into a spiral and an
elliptical galaxy and inspecting the generated interiors confirms the §5
seed-descent contract is **intact**: a spiral impostor (6 arms, inner `#8790fe`)
generates a 6-arm spiral interior with the same palette; an elliptical impostor
(inner `#bebfe9`) generates an elliptical interior with the same palette; and
each interior's seed equals the impostor's descriptor seed. The data is
faithfully differentiated. The sameness is perceptual: the differences aren't
visible from where you arrive, and aren't carried by the elements that dominate
the view. Four contributing causes, in impact order:

### 6a — Descent spawns at the galaxy's dead centre

**Where.** `src/space/scale/Level.js:141` (`createGalaxyLevel`) sets no
`entryPosition`, so the reparent in `src/space/scale/ScaleStack.js:230` drops the
ship at `(0,0,0)` — the galaxy core, in the disk plane. *Verified live:
`galaxySpawnPos = {0,0,0}`.*

**Problem.** From dead centre, embedded in a uniform haze, a spiral and an
elliptical are indistinguishable — there is no vantage to read the structure.
Contrast System descent (`Level.js:159` `createSystemLevel`), which spawns at a
scenic standoff via `entryPosition`. **Biggest single contributor.**

**Suggested fix.** Give galaxy descent a standoff `entryPosition` (~0.5–0.7 ×
`regionRadius` out, ideally along the disk normal, facing the core) so the
galaxy's shape is the first thing seen on arrival.

### 6b — Star/nebula recipe is identical for every galaxy

**Where.** `src/config/scaleTiers.js:69` (`buildGalaxyConfig`) hardcodes the same
star/nebula configuration for every galaxy, ignoring `descriptor.type` and
`descriptor.palette`. *Verified live:* every galaxy level gets
`nearCount 9800 / mid 32000 / bg 48000`, `brightness 1.05`,
`temperatureBias 0.64`, `14 nebulae / 24 clusters`.

**Problem.** The ~90,000 stars are the dominant visual mass and follow the same
blackbody temperature distribution in every galaxy, so an "old red elliptical"
has the same young-blue starfield as a spiral. Only the seed-driven scatter
differs, which reads as "the same kind of place, rearranged."

**Suggested fix.** Make `buildGalaxyConfig` descriptor-aware: vary star
`temperatureBias`/brightness and nebula/HII counts by type (elliptical → redder,
older, gas-poor; irregular → clumpy, blue, gas-rich; spiral → arms + HII), and
seed the star/nebula palette from `descriptor.palette`. This is what makes the
*dominant* visual differ per galaxy.

### 6c — The galaxy-identity layer is too faint to read

**Where.** `src/space/universe/GalaxyInteriorField.js` (config from
`scaleTiers.js:118`). *Verified live:* interior `opacity ≈ 0.24`,
`brightness ≈ 0.70`, with small particles.

**Problem.** The interior field (arms, disk, dust, core) is the element that
actually carries type/palette, but at this faintness it is a subtle haze easily
drowned by the bright starfield — and unreadable from the centre (6a).

**Suggested fix.** Lift the interior opacity/brightness/particle size so the
structure reads as the defining feature of the level (pairs with 6a giving it a
vantage).

### 6d — Palette barely varies between galaxies

**Where.** `src/space/universe/GalaxyField.js:253` (`galaxyPalette`).

**Problem.** Every galaxy derives from the same `colorInner`/`colorOuter` with
only ±0.08 hue jitter; type tints are mild. Even the colours that *do* carry into
the interior are all "bluish core, gold rim," so galaxies don't read as
chromatically distinct.

**Suggested fix.** Widen the hue/saturation spread in `galaxyPalette` and lean
harder into type-based tinting (e.g. distinctly red/old ellipticals, teal/pink
irregulars).

---

## 7 — System sky is not coherent with its galaxy

**Severity:** Design-contract / immersion — a star system entered from inside a
galaxy has the same sky as one entered from open intergalactic space. Violates
scale-architecture §7 ("from a solar system you still see the rest of the
galaxy"); the specific, galaxy-coherence case of [finding #3](#3--system-backdrop-discards-the-parent-level).

**Investigation (live, 2026-06-25).** Descending root → galaxy → system and
inspecting each level shows the parent galaxy's identity *exists at descent time*
but is never propagated into the system:

- The active Galaxy level carries its descriptor:
  `environment.config.global.parentGalaxy = { type: 'spiral', inner: '#d59afe', armCount: 6 }`.
- The system candidate keys are
  `id, kind, position, radius, color, temperatureK, luminosity, entryRadius, childSeed`
  — **no galaxy field**. `createSystemCandidate` (`src/space/scale/Level.js:107`)
  forwards only star attributes, and the resulting `SystemContents.anchor`
  likewise has no galaxy context (`systemKnowsItsGalaxy: false`).
- A root-universe system reports `parentGalaxy: null`, so "inside a galaxy" vs
  "intergalactic" *is* distinguishable at the source — but both currently render
  the same sky.

**Where.**
- `src/space/scale/Level.js:107` (`createSystemCandidate`) — drops the parent
  galaxy descriptor. System descent also never receives `baseConfig`, unlike
  galaxy descent (`createChildLevel`, `Level.js:195`).
- `src/space/universe/SystemContents.js:165` (`_createBackdrop`) — builds 2,600
  uniformly-random points with a fixed blue/gold split (`PointsMaterial`),
  identical regardless of context: no galaxy palette, no galactic band, no
  orientation, no core glow.

**Problem (two gaps).**

1. **Plumbing.** The galaxy descriptor isn't passed down. At
   `ScaleStack._performDescend`, the parent level (`this.active`, before the push)
   holds `universe.config.global.parentGalaxy`; it needs to flow into
   `createSystemCandidate` → `createSystemLevel` → `SystemContents` (only set when
   the parent is a Galaxy level, left null for root-universe systems).
2. **Rendering.** `_createBackdrop` must consume that descriptor when present:
   tint backdrop stars with `palette.inner/outer`; concentrate density along a
   **galactic band** with a faint emissive haze ribbon (a distant analog of
   `GalaxyInteriorField`) plus a soft core glow toward galactic centre; orient the
   band from a **seed-derived** direction so re-entry is identical (§5). When
   `parentGalaxy` is null, keep a sparse intergalactic field (optionally with
   faint distant-galaxy smudges) so the two contexts read differently.

**Suggested fix.** Two tiers of solution:
- **Cheap, coherent (recommended now):** reconstruct the backdrop from the
  descriptor (palette / type / seed-derived orientation) — deterministic,
  low-cost, consistent with how 6a/6b already work.
- **Full §7 (later):** bake the actual parent galaxy level into a cubemap /
  impostor sky, shared with roadmap
  [Part 7 IBL](universe-visual-roadmap.md#part-7--image-based-lighting-from-the-universe).

---

## Root-cause note — architecture §7 (Backdrop Inheritance) is unimplemented

Findings **#3** and **#7** are not independent bugs — they are two symptoms of a
single unimplemented mechanic: **scale-architecture §7 (Backdrop Inheritance /
Parent Baking).** Recording it here as a first-class entry so the through-line is
explicit rather than implied.

**Status.** §7 is *declared deferred* by the architecture doc itself — this is a
known, self-reported gap, not a regression or an undocumented omission. Its §14
status section states the parent bake is only a "first cut": *"On descend the
parent level's group is removed from the scene … Not yet a real cubemap/IBL bake
(§7),"* and lists *"True backdrop bake / IBL (§7) — currently just hides the
parent group"* under deferred work. So what exists today is **hide-the-group**,
not inheritance.

**Symptoms it produces.**
- **#3** — descending into a System replaces the parent with a generic random
  field instead of inheriting it.
- **#7** — that field is also galaxy-agnostic, so a system inside a spiral looks
  like one in open space.
- The Galaxy tier shares the same hide-the-group bake, but reads acceptably today
  because `GalaxyInteriorField` + the standoff spawn (audit 6a) give the galaxy
  level its own self-contained look; the missing inheritance is most visible at
  the System tier.

**Do not conflate §7 with roadmap Part 7.** They share a *mechanism* (a cubemap
bake of the surrounding field) but are different features:
- **scale-architecture §7 — Backdrop Inheritance**: what the *child level's sky
  looks like* (the parent baked into the backdrop you see). Fixes #3 / #7.
- **roadmap [Part 7 — IBL](universe-visual-roadmap.md#part-7--image-based-lighting-from-the-universe)**:
  how the *ship interior is lit/reflected* (materials consume `scene.environment`).
  Does **not** fix #3 / #7 on its own.

A real §7 bake would *produce* the cubemap that Part 7 then *consumes*, so the
dependency runs §7 → Part 7, not the reverse.

**Two resolution tiers (also noted in #7).**
1. **Cheap / recommended now:** plumb the parent descriptor down and reconstruct
   the child backdrop procedurally from it (palette / type / seed-oriented band).
   No cubemap; deterministic; fixes #3 and #7 without touching Part 7.
2. **Full §7 bake (later):** render the parent level to a cubemap and draw it as
   the child sky — more faithful, more expensive, and the version that also
   unlocks Part 7's IBL for free.

---

## Relationship to the roadmap

- **#4** is a partial-regression against roadmap
  [Part 14](universe-visual-roadmap.md#part-14--star-anti-aliasing--temporal-stabilization) —
  the floor is in place but the energy-preserving half is missing.
- **#3** is the concrete placeholder for the deferred §7 parent-bake in
  [universe-scale-architecture.md](universe-scale-architecture.md).
- **#2** becomes relevant precisely because the System-tier slice (roadmap
  [Part 9](universe-visual-roadmap.md#part-9--approachable-bodies-stars-planets--systems))
  now lets you reach planets at all.
- **#1** and **#5** are internal-quality issues introduced by the new
  System-anchor wiring in `StarField.js`.
- **#6** is a follow-through on the §5 seed-descent contract: the contract holds,
  but the *presentation* of the descended galaxy (spawn vantage, descriptor-aware
  content, legibility) does not yet let the player perceive the differentiation
  the seed already produces. Relates to roadmap
  [Part 18 (hierarchical structure & vista direction)](universe-visual-roadmap.md#part-18--hierarchical-structure--vista-direction)
  for the "framed hero composition on arrival" idea.
- **#7** is the galaxy-coherence case of **#3** and the concrete §7 backdrop-bake
  gap for the System tier: the parent galaxy's identity exists at descent but is
  neither propagated nor rendered. Full resolution shares the cubemap with
  roadmap [Part 7 (IBL)](universe-visual-roadmap.md#part-7--image-based-lighting-from-the-universe).
