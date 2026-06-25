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

---

## 1 — Per-frame O(N) over all star anchors

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
