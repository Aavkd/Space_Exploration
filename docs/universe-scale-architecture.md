# Universe Scale Architecture — Nested Scale Levels

> **Status: FOUNDATION + SYSTEM TIER PARTIALLY IMPLEMENTED.** This document defines how the
> project will handle the enormous range of scales between a 1.65 m player and a
> ~700,000 km star, so that planets and stars feel *properly huge* when
> approached while traversal stays smooth.
>
> The **first two slices are built and verified** — a `ScaleStack` level manager
> with the uniform transition rule and reparent/rescale handoff, proving
> **Universe ↔ Galaxy** and **Universe/Galaxy → System** descent end to end
> (§12 steps 2–3). See
> [§14 — Implementation Status](#14--implementation-status) for exactly what
> shipped, which files, and what is still deferred.
>
> It supersedes the earlier "continuous multi-band camera" framing discussed in
> the scale Q&A. The approach here is **nested coordinate frames with discrete
> scale levels** (the technique used by *Megaton Rainfall*, *Spore*, *Boundless*)
> — you travel a level like a map, and when you slow down near an object you
> descend into a lower level with its own contents and scale; travel far enough
> and you ascend back out.
>
> This is a **foundation that Parts 9–11 of
> [universe-visual-roadmap.md](universe-visual-roadmap.md) depend on** (approachable
> stars/planets/systems, inside-the-nebula, asteroid fields). It should be
> designed before any approachable body is built, because it changes the meaning
> of "position" and "size" everywhere.

---

## Table of Contents

1. [The Problem](#1--the-problem)
2. [Core Concept: Nested Scale Levels](#2--core-concept-nested-scale-levels)
3. [The Level Tiers](#3--the-level-tiers)
4. [The Uniform Transition Rule](#4--the-uniform-transition-rule)
5. [The Seed-Descent Contract (Determinism)](#5--the-seed-descent-contract-determinism)
6. [Per-Level Local Scale & Origin](#6--per-level-local-scale--origin)
7. [Backdrop Inheritance (Parent Baking)](#7--backdrop-inheritance-parent-baking)
8. [The Reparent / Rescale Handoff](#8--the-reparent--rescale-handoff)
9. [Mapping onto the Existing Code](#9--mapping-onto-the-existing-code)
10. [Hard Parts & Risks](#10--hard-parts--risks)
11. [Relationship to the Visual Roadmap](#11--relationship-to-the-visual-roadmap)
12. [Sequencing](#12--sequencing)
13. [Open Decisions](#13--open-decisions)
14. [Implementation Status](#14--implementation-status)

---

## 1 — The Problem

The current world uses **1 unit = 1 meter** (`assets/ship/manifest.json`: ship is
34 m, eye height 1.65 m). The current ladder:

| Thing | Size / distance (units = m) |
|---|---|
| Player eye height | 1.65 |
| Ship | 34 long |
| Camera near plane | 0.1 |
| Floating-origin rebase | every **1,000** units (`FLOAT_ORIGIN_THRESHOLD_SQ`) |
| Nebulae | 15,000–60,000 |
| Region radius | 670,000 (670 km) |
| Camera far / sky radius | 1,200,000 (1,200 km) |

Real bodies dwarf this entire world:

- **Earth** radius ≈ 6,371 km = **6,371,000 units** → ~10× the whole current region.
- **The Sun** radius ≈ 696,000 km = **696,000,000 units** → ~**1,000× the region**,
  ~580× `cameraFar`.

A single camera cannot render a 0.1 m cockpit **and** a 700,000 km star in the
same frame — that is a ~10¹⁰:1 dynamic range, beyond even a logarithmic depth
buffer (comfortable to ~10⁷–10⁸). Brute-forcing it with composited multi-band
cameras is possible but fragile.

**Already in place (the hard prerequisites):**
`logarithmicDepthBuffer: true` (`src/app/App.js`), a working **floating origin**
(`App._maybeRebaseOrigin`, `Universe.rebaseOrigin`), and **hierarchical seeded
generation** (`deriveSeed` / `createSeededRandom`). This spec builds directly on
all three.

---

## 2 — Core Concept: Nested Scale Levels

Instead of one continuous space, the universe is a **stack of bounded levels**,
each with its **own local coordinate origin** and its **own unit meaning**. You
are always *inside exactly one active level*; its parent is kept as a cheap
backdrop, and its children are generated on demand when you descend.

Because each level's contents stay within a bounded working range (~10⁵–10⁶
units), float precision and depth precision are never stressed *inside* a level.
The terrifying cross-scale jump happens **only briefly, during a transition**,
where it is hidden behind a blend.

```
   ┌─────────────────────────────────────────────┐
   │  UNIVERSE level  (galaxies, cosmic web)       │  ← travel like a map
   │     ↓ slow down near a galaxy                 │
   │  ┌────────────────────────────────────────┐  │
   │  │  GALAXY level  (stars, nebulae, arms)    │  │
   │  │     ↓ slow down near a star              │  │
   │  │  ┌──────────────────────────────────┐    │  │
   │  │  │  SYSTEM level  (star, planets,    │    │  │
   │  │  │  belts)                           │    │  │
   │  │  │     ↓ approach a planet           │    │  │
   │  │  │  ┌────────────────────────────┐   │    │  │
   │  │  │  │  PLANETARY / SURFACE level  │   │    │  │
   │  │  │  └────────────────────────────┘   │    │  │
   │  │  └──────────────────────────────────┘    │  │
   │  └────────────────────────────────────────┘  │
   └─────────────────────────────────────────────┘
   Ascend by travelling far enough (cross the exit shell).
```

The **same rule** governs every adjacent pair of levels (§4). This uniformity is
what keeps the system from collapsing into a pile of hand-coded special cases.

---

## 3 — The Level Tiers

| Tier | Level | Contains | Anchor / "sun" | Existing code |
|---|---|---|---|---|
| 0 | **Universe** | Cosmic web, galaxies (impostors), large-scale nebulae | — (deep field) | `Universe.js`, `CosmicWeb`, `GalaxyField` |
| 1 | **Galaxy** | Stars, star clusters, nebulae, spiral arms, dust lanes | the galactic core | new `GalaxyLevel`, reuses `StarField`/`NebulaField` |
| 2 | **System** | A star (real radius), planets, belts, comets | the star | new `SystemLevel` + Part 9 bodies |
| 3 | **Planetary / Orbit** | One planet (real radius), moons, rings, ship in orbit | the planet | new `PlanetaryLevel` |
| 4 | **Surface / Cockpit** | Walking, EVA, cockpit at true 1 m scale | local ground frame | existing ship/player rig |

> **Note — the innermost tiers still span ~10⁹:1 internally.** A System level
> holds a 700,000 km star, a 6,000 km planet, a 34 m ship, and a 1.65 m player.
> That is exactly why the nesting continues into **Planetary** and **Surface**
> tiers: the same transition rule keeps each tier's *active working range*
> bounded. Do not try to render star-surface and cockpit in one frame — that's a
> Tier 2 ↔ Tier 4 jump that must pass through Tier 3.

You do **not** have to ship all five at once. The mechanic is identical between
any adjacent pair, so tiers can be added incrementally (start Universe ↔ Galaxy ↔
System, add Planetary/Surface later).

---

## 4 — The Uniform Transition Rule

One rule, applied between every adjacent pair of levels. Four ingredients:

### 4.1 Proximity shell + speed gate (descend)
Descend from a level into a child object's level when **both**:
- the player is within the object's **entry shell** radius `R_in`, **and**
- relative speed is below `V_in` (the "slow enough" gate).

The speed gate maps directly onto the existing **hyperdrive gears**: at
HYPERDRIVE you blast *past* objects (map-level travel); drop to PRECISION near an
object and you sink in. You never accidentally fall into every system you pass.

### 4.2 Hysteresis (ascend)
Ascend back to the parent when the player travels beyond an **exit shell**
`R_out`, where **`R_out` > `R_in`**. The gap between the two radii prevents
flickering at the boundary. (Exit has no speed gate — leaving is always allowed.)

### 4.3 Reparent + rescale (§8)
On transition, the player/ship/camera/audio/gravity are reparented into the new
level's frame, with **velocity and orientation carried across and rescaled** so
motion feels continuous.

### 4.4 Parent bake (§7)
The level being left is collapsed into a cheap **backdrop** (cubemap/impostor sky)
for the entered level, and the object descended-from becomes the new level's
anchor light.

> Descent generates the child level **async, under a brief eased blend** (the
> VR-comfort vignette is ideal cover), so there is no hitch and no nausea-inducing
> hard zoom.

---

## 5 — The Seed-Descent Contract (Determinism)

The galaxy you *enter* must match the one you *saw*, and must be identical every
time you re-enter. This is guaranteed by the existing hierarchical seed system:

```
universeSeed
  └─ galaxySeed   = deriveSeed(universeSeed, `galaxy:${galaxyId}`)
       └─ starSeed = deriveSeed(galaxySeed, `star:${starId}`)
            └─ planetSeed = deriveSeed(starSeed, `planet:${planetId}`)
```

- Every object visible at a level carries the **seed for its child level**.
- Descending instantiates the child level **purely from that seed** — no stored
  state, fully reproducible.
- The parent-level representation of an object (the galaxy impostor's color/type/
  size, the star's spectral class) and the child-level reality **must be derived
  from the same seed** so they agree. Define each object's summary attributes
  (color, size, type) as functions of the seed, used by *both* the impostor and
  the full level.

This reuses `createSeededRandom(deriveSeed(seed, '...'))` exactly as
`Universe.regenerate` already does — the seed hierarchy becomes the load-bearing
descent contract rather than an internal detail.

---

## 6 — Per-Level Local Scale & Origin

Each level normalizes its contents into a comfortable working range and keeps its
**own floating origin**:

- **Local origin per level.** Within a level, the player stays near `(0,0,0)` via
  the existing rebase pattern (`rebaseOrigin`), run in that level's frame. The
  rebase threshold and the level's spatial extent are level-specific.
- **Unit meaning may differ per level.** The render scale of a level is chosen so
  its contents sit in ~10⁴–10⁶ units. A galaxy level might render stars at a
  compressed inter-star spacing; a system level renders bodies at (or near) true
  physical radius so they feel huge. The **reparent step rescales velocity** when
  the unit meaning changes between levels (§8).
- **"True body radius, compressed gaps"** still holds *within* a level: bodies are
  rendered at believable physical size (real horizon curvature), while the empty
  distance between them is compressed for fun traversal.

The three cues that actually make a body read as huge, applied inside whatever
level renders it:
1. **Real horizon curvature** (geometry uses true radius — the #1 cue).
2. **Continuous fractal surface detail** that keeps resolving on approach.
3. **Sky occlusion + atmospheric optical depth** toward the limb.

---

## 7 — Backdrop Inheritance (Parent Baking)

A level is never visually isolated: from a solar system you still see the rest of
the galaxy; from the galaxy you still see the rest of the universe.

- On descent, the parent level is **baked into a backdrop** for the child — a
  low-cost cubemap / impostor sky rendered once (or refreshed rarely), drawn
  camera-locked like the current `SkyDeepSpace` dome.
- The **object descended-from becomes the child level's anchor light** (the
  galaxy core lights the galaxy level; the star lights the system level).
- This is where several roadmap items plug in as the parent-bake:
  [Part 2 (galactic band)](universe-visual-roadmap.md#part-2--galactic-plane-band-in-the-backdrop),
  [Part 16 (deep-field micro-galaxies)](universe-visual-roadmap.md#part-16--deep-field-micro-galaxies--general-lensing),
  and the [Part 7 IBL cubemap](universe-visual-roadmap.md#part-7--image-based-lighting-from-the-universe).

---

## 8 — The Reparent / Rescale Handoff

**This is the highest-risk part of the system — budget most engineering effort
here.** A glitchy handoff breaks immersion instantly.

On every transition, atomically:

1. **Generate** (or reactivate) the target level async, under the blend cover.
2. **Reparent** player rig, ship, camera, `GravityField`, and `AudioDirector`
   into the target level's frame.
3. **Carry orientation** unchanged (the player keeps facing the same way).
4. **Rescale velocity** by the ratio of the two levels' unit meanings, so apparent
   motion is continuous (no sudden stop or lurch).
5. **Position** the player just inside the entry shell on descent / just outside
   the exit shell on ascent, consistent with travel direction.
6. **Cross-fade** parent contents → child contents over the blend, then release
   the parent to its baked backdrop.

Continuity requirements:
- **Physics/gravity** must be continuous across the boundary (no gravity pop).
- **VR comfort**: ease the transition; reuse the existing vr-comfort vignette so a
  rapid scale change does not cause vection sickness.
- **Audio** ducks/cross-fades through the transition rather than cutting.

---

## 9 — Mapping onto the Existing Code

- **`Universe.js` becomes one level provider, not "the world."** Introduce a
  `LevelManager` / `ScaleStack` that owns the active level chain — only the
  current level (+ its immediate parent as backdrop) is fully live; ancestors are
  cheap baked skies.
- **Level types** (`GalaxyLevel`, `SystemLevel`, …) are generators seeded from the
  parent object via `deriveSeed`, each reusing the `rebaseOrigin` pattern locally.
  `StarField` / `NebulaField` / `GalaxyField` are reused as level *contents*.
- **Speed gate** reads the existing hyperdrive level (PRECISION vs HYPERDRIVE) from
  `Ship` / `App._updateSpeedFx`.
- **Floating origin** runs per active level (extend `_maybeRebaseOrigin` to the
  active frame).
- **Reparent step** is new glue in `App` / `LevelManager` touching the player rig,
  `GravityField.setAttractors`, and `AudioDirector`.

---

## 10 — Hard Parts & Risks

- **The reparent/rescale handoff (§8)** — the make-or-break. Carry velocity +
  orientation glitch-free; generate async under cover.
- **Hysteresis tuning** — `R_in`/`R_out`/`V_in` per tier must be tuned so descent
  feels intentional and the boundary never flickers.
- **Two-way determinism** — parent impostor and child reality must agree (shared
  seed-derived attributes, §5), or objects appear to "change" on entry.
- **Async generation hitch** — generating a galaxy/system on entry must not stall
  the frame; generate off the critical path and reveal under the blend.
- **VR comfort** — scale transitions are a known nausea trigger; ease them.
- **Innermost-tier range** — remember a System level still spans ~10⁹:1; do not
  skip the Planetary/Surface tiers thinking nesting solved it (§3 note).

---

## 11 — Relationship to the Visual Roadmap

- **Supersedes** the earlier "continuous multi-band camera" idea: each level
  renders one bounded range + a baked parent backdrop, so the brutal full-range
  composite is gone (only a brief transition blend remains).
- **Gates** roadmap [Part 9 (approachable bodies)](universe-visual-roadmap.md#part-9--approachable-bodies-stars-planets--systems),
  [Part 10 (inside the nebula)](universe-visual-roadmap.md#part-10--inside-the-nebula-local-volumetric-fog),
  and [Part 11 (asteroid fields)](universe-visual-roadmap.md#part-11--asteroid-fields-belts--rings) —
  those become **level contents** once the level framework exists.
- **Consumes** [Part 2](universe-visual-roadmap.md#part-2--galactic-plane-band-in-the-backdrop),
  [Part 7](universe-visual-roadmap.md#part-7--image-based-lighting-from-the-universe), and
  [Part 16](universe-visual-roadmap.md#part-16--deep-field-micro-galaxies--general-lensing)
  as parent-backdrop bakes (§7).

---

## 12 — Sequencing

Agreed order (per the design discussion):

1. **Grow & enrich the top-level Universe first** — larger region, richer cosmic
   web / large-scale structure. Get a convincing *map* before building dives into
   it.
2. **Done — build the `LevelManager` + the uniform transition rule** (§4) with just two
   tiers (Universe ↔ Galaxy) to prove the handoff, hysteresis, seed-descent, and
   parent-bake end to end. **Done** — shipped as `ScaleStack` (§14).
3. **Done — add the System tier** and wire in Part 9 bodies (stars/planets at real radius).
4. **Done — add the Planetary / Orbit tier** (Tier 3): descend from a System into any planet; heroic-radius sphere with curved horizon, procedural heightfield terrain (terrestrial) or cloud-deck (gas); gravity lands the ship on the surface; approach-direction spawn/exit preserved.
5. **Specced — planet surface: streaming flight + EVA.** Decisions locked in [surface-eva-tier.md](surface-eva-tier.md). **Note:** for landable terrestrial worlds this *replaces* the hero-sphere Planetary content (Tier 3) with a **continuous-LOD quadtree planet at true radius** — you fly seamlessly from orbit to surface (LOD resolving = the transition, **no veil**), terrain **streams under the ground-track** so you can fly anywhere over the planet, and EVA becomes an **on-foot control mode** rather than a stack descent. Gas giants keep the hero-sphere cloud deck. Requires true-radius precision (camera-relative tiles) + now-mandatory async generation — see that doc.
5. Layer the visual roadmap parts in as level contents/backdrops.

Prove the **transition handoff on two tiers** before adding more — it is the
riskiest mechanic and everything else repeats it.

---

## 13 — Open Decisions

To lock down before implementation:

- **Number of tiers shipped first:** Universe ↔ Galaxy ↔ System.
- **Per-tier `R_in` / `R_out` / `V_in`** values and how they relate to the
  hyperdrive gear thresholds.
- **Per-level unit meaning / render scale**, and therefore the velocity-rescale
  ratios at each boundary.
- **Backdrop refresh policy** — bake-once vs periodic refresh per tier.
- **How much true-vs-compressed** scaling each tier uses (bodies true radius;
  inter-body gaps compressed by what factor).
- **Persistence** — are visited levels cached, or always regenerated from seed
  (seed-only is simplest and the §5 contract makes it free)?

---

## 14 — Implementation Status

> **Current update:** the Planetary / Orbit tier (Tier 3) is now live on top of
> the Universe ↔ Galaxy ↔ System foundation. Approach any planet in a System at
> PRECISION speed to descend into its own level, where it is rebuilt at a heroic
> curved-horizon radius. Terrestrial worlds have a procedural heightfield surface
> the ship can land on; gas giants are orbit-only (cloud deck, no touchdown).
> Entry spawns the ship on the same side it approached from; exit re-emerges in
> the System on the same side the ship flew away toward. The Surface / EVA tier
> (Tier 4 — walk / EVA at 1 m scale) remains the next additive step.

> **Previously shipped:** Universe ↔ Galaxy (§12 step 2), then the System tier
> and roadmap Part 9 vertical slice (§12 step 3).

### What's built

| Piece | Where | Notes |
|---|---|---|
| Level manager / scale stack | `src/space/scale/ScaleStack.js` | Owns the active level chain; runs the transition state machine + veil blend. |
| Per-level wrapper | `src/space/scale/Level.js` | Wraps a `Universe` as a level's contents; tracks the level centre + descent breadcrumb; exposes descent candidates. |
| Tier config | `src/config/scaleTiers.js` | Shell radii, speed gate, and the seeded galaxy-level config builder. |
| System content provider | `src/space/universe/SystemContents.js` | Renders a generated star system and implements the same surface as `Universe`: `update`, `getPOIs`, `getAttractors`, `rebaseOrigin`. |
| Approachable star body | `src/space/universe/StarBody.js` | Animated star sphere with corona, surface granulation, flares, hero light, POI, and attractor. |
| Planet bodies | `src/space/universe/PlanetBody.js` | Terrestrial worlds, gas giants, rings, orbit pivots, POIs, and attractors. |
| Star anchors | `src/space/universe/StarField.js` | Every non-background local star (`near` + `mid`) becomes a System descent anchor; camera-locked background stars remain backdrop only. |
| POI / navigation balance | `src/space/Universe.js` | Nearest star systems appear in POIs, but stars are capped so nearby structures remain visible. |
| App integration | `src/app/App.js` | `this.environment` follows the active level; rebase/gravity/nav routed through it; `SCALE` telemetry line; debug hooks. |
| Planetary content provider | `src/space/universe/PlanetaryContents.js` | Tier 3 level: heroic-radius planet, procedural heightfield (terrestrial) or gas cloud deck, atmosphere, moons, rings, sun disc, backdrop, `collideShip` / `getLandingState`, `gravityReach`. |
| Planet descent descriptor | `src/space/universe/PlanetBody.js` | `getDescentDescriptor(parentSeed)` — carries kind, palette, rings, systemRadius, landable flag, and childSeed so the Planetary level matches the impostor. |
| System → planet candidates | `src/space/universe/SystemContents.js` | `getDescentCandidates` returns planet entry shells; entry radius derived from in-system planet radius. |
| `planetHeroRadius` | `src/config/scaleTiers.js` | Maps in-system planet radius to heroic Planetary-level radius; drives both the mesh and the collision query. |
| Approach-direction handoff | `src/space/scale/ScaleStack.js` | `approachDir` captured at descent; used by `createPlanetaryLevel` for entry spawn. Ascent re-emerges along the exit direction (ship offset from level centre). |

### How each §-mechanic landed

- **§4.1 Proximity shell + speed gate (descend).** Descend fires when the ship is
  inside an object's entry shell *and* `hyperdriveLevel < 0.2` (PRECISION).
  Candidate shells the ship starts inside are blocked until individually exited,
  preventing spawn-time capture while still allowing newly approached stars
  inside overlapping galaxy shells to trigger.
- **§4.2 Hysteresis (ascend).** Ascend fires when the ship passes the level's exit
  shell (`R_out` = 130 km for Galaxy, 150 km for System). On ascent the ship is dropped
  `1.25 × R_in` outside the entry shell so it does not immediately re-descend.
- **§4.4 / §7 Parent bake (first cut).** On descend the parent level's group is
  removed from the scene (a cheap dormant backdrop) while the shared `SkyDeepSpace`
  dome stays as the universal sky. The parent's **frame is frozen** (it is not
  rebased while dormant) so the stored breadcrumb restores the ship to where it
  descended from on ascent. *Not yet a real cubemap/IBL bake (§7).*
- **§5 Seed-descent contract.** Each galaxy carries `deriveSeed(parentSeed,
  'galaxy:<name>')`; each approachable star carries
  `deriveSeed(parentSeed, 'system:<starName>')`. Galaxy and System levels are
  generated from those seeds, so re-entry is deterministic.
- **§6 Per-level origin.** Floating-origin rebase runs in the **active level's
  frame only** (`ScaleStack.rebaseOrigin`); the level centre is shifted in lockstep
  so the exit-shell test stays correct with the ship pinned near (0,0,0).
- **§8 Reparent / rescale handoff.** On transition the ship is repositioned, its
  velocity is carried across (rescaled by the unit ratio — currently 1, so motion
  is continuous), gravity is rebuilt from the entered level's attractors, and the
  swap is hidden behind an eased veil that peaks black at the content swap.
  System descent drops the ship at a scenic standoff from the generated star.
  Planetary descent spawns the ship on the same side it approached the planet
  from (`approachDir` captured at the moment of descend); ascent re-emerges in
  the System on the same side the ship was flying toward at the exit boundary
  (ship offset from the departed level's centre). Both directions are consistent
  with the outward velocity that earned the ascent, so no gravity-reversal snap.

### Decisions locked for this slice (§13)

- **Tiers shipped:** Universe (0), Galaxy (1), System (2), Planetary (3). System
  descent can happen directly from root Universe stars or from stars inside a
  Galaxy level. Planetary descent from any planet inside a System level.
- **Gate / shells:** `V_in` = spool < 0.2; galaxy `R_in` = `clamp(radius×3, 30k,
  120k)`, `R_out` = 130k. System `R_in` = `clamp(luminosity×45m, 30m, 90m)`,
  `R_out` = 150k. Planet `R_in` = `clamp(radius×6, 2.5k, 14k)`, `R_out` =
  `heroRadius × 2.2` (tight, so ascent feels quick once you pull clear).
- **Planetary hero radius:** terrestrial `clamp(systemRadius×70, 90k, 240k)`;
  gas giant `clamp(systemRadius×55, 180k, 420k)`. Stays in the proven ~10⁵
  band; inside the widened gravity reach so the planet actually pulls the ship down.
- **Gravity reach:** widened to `regionRadius × 1.15` inside a Planetary level
  (the default 70k reach is far smaller than the theatre).
- **Unit meaning:** shipped tiers use `unitScale = 1` (no velocity rescale yet — the path
  exists and is exercised, just with ratio 1).
- **Backdrop:** bake-once-by-hiding (no refresh); shared sky dome persists.
- **Persistence:** seed-only — descended levels are disposed on ascent and
  regenerated from seed on re-entry.
- **HUD / POIs:** `Universe.getPOIs()` includes nearest star systems but caps them
  so nearby structures (nodes, galaxies, landmarks, nebulae) remain visible in
  navigation.

### Still deferred / known risks

- **Planet surface — streaming flight + EVA** — **Decisions locked; build spec at
  [surface-eva-tier.md](surface-eva-tier.md).** For landable terrestrial worlds the
  hero-sphere Planetary content is **replaced** by a **continuous-LOD quadtree planet
  at true radius**: fly seamlessly orbit→surface (no veil — LOD *is* the transition),
  terrain streams under the ship's ground-track so you can fly the whole planet at low
  altitude, then walk on it at true 1 m scale (EVA as an on-foot control mode). The
  shared height basis (`surfaceRadiusAt`, `_fbm`/`_noiseSeed`/`_noiseOffset`) becomes
  the quadtree's coarse term so orbit shape == surface shape. Gas giants keep the
  hero sphere (cloud deck, orbit-only). Pulls true-radius precision (camera-relative
  tiles) and async tile streaming (§10) into scope.
- **System depth/content** — stars and planets exist, but belts, moons, comets,
  and richer system ecology are still future work (planet descent is now live).
- **True backdrop bake / IBL** (§7) — currently just hides the parent group.
- **Async generation** (§10) — Galaxy and System children are generated
  **synchronously** under the veil. Acceptable hitch for now; move off the
  critical path later.
- **VR-comfort blend** — the veil is a desktop DOM overlay; the in-headset vignette
  cover is not wired.

### Debug surface

`window.__deepSpaceDebug.{getScaleState, descendNearest, ascendLevel,
resetToRootLevel}`; the telemetry HUD shows a `SCALE <level> (tier N)` line, and
the same state is mirrored into `#deep-space-debug-state` for headless checks.
