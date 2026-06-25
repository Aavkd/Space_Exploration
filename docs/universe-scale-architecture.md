# Universe Scale Architecture — Nested Scale Levels

> **Status: PROPOSAL / FOUNDATIONAL SPEC.** This document defines how the
> project will handle the enormous range of scales between a 1.65 m player and a
> ~700,000 km star, so that planets and stars feel *properly huge* when
> approached while traversal stays smooth.
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
2. **Build the `LevelManager` + the uniform transition rule** (§4) with just two
   tiers (Universe ↔ Galaxy) to prove the handoff, hysteresis, seed-descent, and
   parent-bake end to end.
3. **Add the System tier** and wire in Part 9 bodies (stars/planets at real radius).
4. **Add Planetary / Surface tiers** for true close-up scale.
5. Layer the visual roadmap parts in as level contents/backdrops.

Prove the **transition handoff on two tiers** before adding more — it is the
riskiest mechanic and everything else repeats it.

---

## 13 — Open Decisions

To lock down before implementation:

- **Number of tiers to ship first** (recommend Universe ↔ Galaxy ↔ System).
- **Per-tier `R_in` / `R_out` / `V_in`** values and how they relate to the
  hyperdrive gear thresholds.
- **Per-level unit meaning / render scale**, and therefore the velocity-rescale
  ratios at each boundary.
- **Backdrop refresh policy** — bake-once vs periodic refresh per tier.
- **How much true-vs-compressed** scaling each tier uses (bodies true radius;
  inter-body gaps compressed by what factor).
- **Persistence** — are visited levels cached, or always regenerated from seed
  (seed-only is simplest and the §5 contract makes it free)?
