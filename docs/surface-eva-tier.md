# Planet Surface — Streaming Flight + EVA (Tier 3 rework / Tier 4) — Implementation Spec

> **Status: §12 PHASES 1–5 SHIPPED; PHASES 1–2 BROWSER VERIFIED; PHASE 4 SCRIPTED BROWSER SMOKE VERIFIED.**
> True-radius planet is rendering and confirmed in-browser. Observed: R = 9,126,466 m,
> ALT 1577.8 km, gravity pull 5.81 m/s², SECTOR telemetry reads "terrestrial world
> (true radius)". Camera-relative precision holds — no float swim at altitude.
> Tile faceting visible at high-altitude coarse LOD (expected; geomorph is §12 phase 6
> polish). Jitter isolation test (Node.js): camera-relative static error ≤ 3 µm at 2 m
> altitude vs 185 mm naive absolute.
> Phase 3 ships a time-sliced tile queue, bounded LRU cache, and streaming
> telemetry. Phase 4 ships quadtree-sampled ship contact: radial gravity rests the
> hull at clearance over the shared terrain height field, `LANDED` waits for settled
> contact, and `ALT` reports height above solid terrain. Scripted browser smoke:
> deterministic plain + mountainside touchdown both reached `LANDED`, and an outward
> impulse lifted off cleanly. Phase 5 adds on-foot surface EVA, player-anchor
> rebasing, `C` disembark/board prompts, and the `T` inside/outside EVA test toggle.
>
> Agent-facing build spec for low-altitude **streaming flight over true-scale
> planetary terrain** plus **on-foot EVA**, for the nested scale stack
> ([universe-scale-architecture.md](universe-scale-architecture.md)).
>
> **This supersedes the hero-sphere stand-in** used by the shipped Planetary tier
> (Tier 3) for **landable terrestrial worlds.** The locked direction (see §9) is a
> **continuous-LOD quadtree planet**, rendered at true radius, that you fly from
> orbit down to the surface with **no veil and no cross-fade** — the LOD resolving
> *is* the seamless transition — and then **walk on** at true 1 m scale. Terrain
> **streams under the ship's ground-track**, so you can fly anywhere over the whole
> planet at low altitude and see real terrain below.
>
> Where this spec and the architecture doc disagree on the planet's representation,
> **this spec wins.** Gas giants are unchanged (hero-sphere cloud deck, orbit-only).
>
> **Visual/biome pass shipped:** [planet-visual-system-revamp.md](planet-visual-system-revamp.md)
> adds typed planet descriptors, six guaranteed terrestrial archetypes in the
> System tier, and a shared surface model for render geometry, collision, landing,
> and surface EVA sampling.

---

## Table of Contents

1. [What changes, and what is preserved](#1--what-changes-and-what-is-preserved)
2. [The seam this builds on](#2--the-seam-this-builds-on)
3. [The core: a continuous-LOD quadtree planet](#3--the-core-a-continuous-lod-quadtree-planet)
4. [Precision: rendering a true-radius planet](#4--precision-rendering-a-true-radius-planet)
5. [Streaming: tiles under the ground-track](#5--streaming-tiles-under-the-ground-track)
6. [Seamless orbit→surface (no veil)](#6--seamless-orbitsurface-no-veil)
7. [Gravity, collision & the floating-origin anchor](#7--gravity-collision--the-floating-origin-anchor)
8. [On foot: disembark, walk, re-board](#8--on-foot-disembark-walk-re-board)
9. [Locked decisions](#9--locked-decisions)
10. [File-by-file change list](#10--file-by-file-change-list)
11. [Risks & mitigations](#11--risks--mitigations)
12. [Build order & acceptance checks](#12--build-order--acceptance-checks)
13. [Debug surface & telemetry](#13--debug-surface--telemetry)
14. [Deferred](#14--deferred)

---

## 1 — What changes, and what is preserved

**Preserved (do not touch):**

- Tiers 0–2 (Universe / Galaxy / System) and their **veil-swap** transitions.
- The **System → Planet descent stays veiled** (Tier 2 → 3 boundary unchanged):
  you still drop into a planet's own level from the System. What changes is *what
  that level renders* for landable terrestrial worlds.
- **Gas giants** keep the existing hero-sphere cloud deck (`PlanetaryContents`,
  `canLand: false`), orbit-only. No quadtree, no surface.
- The **shared height basis** — `_fbm`, `_noiseSeed`, `_noiseOffset`
  (`PlanetaryContents.js:577`) — is reused as the quadtree's *low-frequency* layer,
  so the shape you see from orbit is the shape you land on (the §5 determinism
  contract of the architecture doc).
- The **player system** (`PlayerRig`, `PlayerController`, `RelativeLocomotion`) and
  the in-space **tethered EVA** (still ship-frame; see
  [phase-04-ship-interior.md](phase-04-ship-interior.md)).

**Changed / new:**

- For **landable terrestrial worlds**, the Planetary level's content provider is
  replaced by a **continuous-LOD quadtree planet at true radius** (§3). The hero
  sphere is gone for these worlds (it was always a "heroic, compressed" placeholder
  for true radius — now in scope).
- The previous draft's **veil-free cross-fade between two meshes is obsolete** — the
  quadtree's LOD is inherently seamless (§6). The `blend` transition kind is **not**
  built; the planet level needs no two-group cross-fade.
- New: **camera-relative tile rendering** (§4), **async tile streaming** (§5), and
  **on-foot mode** on the high-detail tiles (§8).

> **Framing:** "Tier 4 Surface/EVA" is no longer a separate stack level. The planet
> becomes one continuous level you traverse from orbit to ground; **EVA is a
> control mode** (player detaches from the ship and walks) rather than a descent.

---

## 2 — The seam this builds on

| Hook | File | Role now |
|---|---|---|
| `_fbm`, `_noiseSeed`, `_noiseOffset` | `PlanetaryContents.js:55,577` | **Low-frequency layer** of every quadtree tile's height. Identical placement of continents/mountains from orbit to surface. |
| `surfaceRadiusAt(dir)` | `PlanetaryContents.js:114` | Becomes the **coarse term** of the quadtree height function `heightAt(dir)`; the quadtree adds higher octaves for near tiles. Keep the "mesh and collision share one function" discipline. |
| `getLandingState(shipPos)` | `PlanetaryContents.js:157` | Stays the `{ landed, altitude, … }` readout; drives the disembark prompt and telemetry. |
| `collideShip(ship, dt)` | `PlanetaryContents.js:129` | Reworked to rest the ship on the quadtree surface (sample `heightAt`, not the mesh). |
| `gravityReach` | `PlanetaryContents.js:90` | Quadtree planet supplies its own (radial field, §7). |
| `getDescentCandidates() → []` | `Level.js:106` | Stays `[]` — there is no further stack descent; on-foot is a control mode, not a level push. |
| veil swap | `ScaleStack.js:199`,`:306` | Untouched for Tiers 0–2 and the System→Planet entry. **Not used inside the planet.** |
| floating-origin | `App.js:388` | Anchor switches ship→player on foot (§7). |
| log depth buffer | `App.js` (`logarithmicDepthBuffer: true`) | Already on — load-bearing for true-radius depth precision (§4). |

---

## 3 — The core: a continuous-LOD quadtree planet

New provider `src/space/universe/QuadPlanetContents.js` (sibling of
`PlanetaryContents`, same Universe-compatible surface: `update` / `getPOIs` /
`getAttractors` / `rebaseOrigin` / `getCounts` / `getCurrentNode` /
`setRuntimeConfig` / `setVisualGlow` / `setRelativisticState`, plus `collideShip` /
`getLandingState` / `gravityReach`). Used for **landable terrestrial** planets;
`createPlanetaryLevel` (`Level.js:210`) dispatches to it instead of
`PlanetaryContents` when `descriptor.landable && kind === 'terrestrial'`.

### 3.1 The sphere

- **Cube-sphere quadtree**: 6 root face-quads, each an independent quadtree. A quad
  subdivides into 4 children when its **screen-space error** exceeds a threshold
  (distance- and altitude-driven), and merges when below it. This is the standard,
  simplest-to-map planet LOD; an icosphere-quadtree is an acceptable alternative but
  cube-sphere keeps tile UV/neighbour math trivial.
- **True radius** `R_true = planetTrueRadius(kind, descriptor.systemRadius)` (new in
  `scaleTiers.js`, §10). A few × 10⁶ m for terrestrial worlds — large enough that
  the horizon sits at a realistic distance and the ground is locally flat, **and**
  curvature reads correctly from altitude. Need not be astronomically real; must be
  **consistent** (deterministic re-entry).

### 3.2 The height function

```
heightAt(dir) =                                  // dir = unit vector from planet centre
      surfaceRadiusAt(dir)                        // SHARED coarse term  (PlanetaryContents)
        ·  (R_true / radius_hero_equiv)           // re-expressed at true radius
    + fineOctaves(dir, lod)                        // high-freq detail, faded in by LOD depth
```

- `fineOctaves` adds rocks/ridges/dunes only on **near (deep-LOD) tiles**, scaled to
  true metres, **zero-mean at the coarse band** so they never shift the continent
  shape. Distant tiles use only the coarse term, so the orbital silhouette is stable.
- Same function drives **mesh vertices, ship collision, and on-foot collision** — no
  raycasting the mesh.
- Per-tile detail seeded `deriveSeed(planetSeed, 'tile:<face>:<lod>:<x>:<y>')` so
  every tile is reproducible and identical on re-entry.

### 3.3 Tile mesh

- Fixed grid per tile (e.g. `33×33` verts), positions on the sphere via the cube→sphere
  map + `heightAt`. **Skirts** (downward edge rings) hide cracks between adjacent LOD
  levels; alternatively edge-stitch to the coarser neighbour. Skirts are simpler —
  start there.
- Vertex normals from the height field (analytic or finite-difference); shade with the
  parent's `sunDir`/`sunColor` (reuse the Tier-3 terrain shader as the per-tile
  material, fed tile-local data).
- Vertex-colour biome/altitude bands as today (`PlanetaryContents._createTerrain`),
  extended with the fine-LOD colour detail.

---

## 4 — Precision: rendering a true-radius planet

A planet at `R_true ≈ 6×10⁶ m` is far beyond float32 vertex/matrix precision. **CPU
math in JS is float64**, so altitude, gravity, and collision are computed safely in
planet-centred coordinates. The precision problem is **purely on the GPU** (vertex
attributes + model matrices are float32). Solve it the standard way:

- **Camera-relative tile origins.** Each tile stores its vertices **relative to the
  tile's own centre** (small numbers). Each frame the tile's `position` is set to
  `tileCentre − cameraWorldPosition` (computed in float64, result is small), so what
  reaches the GPU is always near the origin. Never upload absolute planet-scale
  coordinates.
- **Authoritative state in planet-centred float64.** Track the ship/player position
  relative to the planet centre as the source of truth (`THREE.Vector3` is float64).
  Derive altitude = `|pos| − heightAt(dir)` from that.
- **Logarithmic depth buffer** is already enabled (`App.js`) — keep it; it is what
  makes a 0.1 m near plane and a multi-thousand-km horizon coexist.
- The existing **floating-origin rebase** still runs to keep the *active traversal
  entity* near the scene origin (§7); the planet centre is simply a large float64
  offset, never rendered directly.

> This is the one place the project leaves its "bounded ~10⁵–10⁶ working range per
> level" comfort zone. The mitigation above is the well-understood planet-renderer
> pattern; budget real engineering and verification here.

---

## 5 — Streaming: tiles under the ground-track

This is what makes "fly anywhere over the whole planet" work, and it is why the
long-deferred **async generation** (architecture doc §10) is now **mandatory** — the
project currently generates levels synchronously under the veil, which would hitch
badly during continuous flight.

- **LOD selection each frame** from the camera/ship position: walk the quadtree,
  subdivide quads whose projected error exceeds the threshold, merge those below.
  Only quads near the ground-track reach deep LOD; the far hemisphere stays coarse.
- **Generation queue, time-sliced.** Requested tiles go on a queue; generate at most
  `N` tiles per frame (budget by ms, not count) so the frame never stalls. Show the
  parent (coarser) tile until the child is ready, then swap — never pop a hole.
  Web Workers are an optimization; a time-sliced main-thread queue is the baseline
  spec (heightfield gen for a 33×33 tile is cheap; the cost is *many* tiles).
- **Tile cache + budget.** Keep a bounded pool of generated tiles (LRU); dispose
  geometry when merged out and beyond the cache. Reuse geometry buffers where
  possible to avoid GC churn.
- **Determinism unaffected:** tiles are pure functions of seed + face/lod/coords, so
  streaming order never changes what a tile contains.

---

## 6 — Seamless orbit→surface (no veil)

The transition you asked for is **native to the LOD system** — there is no veil and
no two-mesh cross-fade:

- **Descent:** fly down from orbit; quads beneath the ship subdivide continuously, so
  terrain detail *resolves smoothly in the air*. Atmosphere (reuse the Tier-3
  atmosphere shader, re-pointed) thickens near the ground and hides the far field. By
  the time the ship touches down it is resting on full 1 m detail — **landing is not a
  separate step.**
- **Ascent:** climb out; deep tiles merge back to coarse, the whole planet and its
  **curvature come into view as you gain altitude** — the "leaving a planet" cue,
  delivered by the true-radius sphere itself, not a compressed stand-in.
- **No control-frame swap inside the planet.** Unlike the previous draft, there is no
  `H_swap`, no `blend` kind, no double-group bookkeeping: one level, one frame, the
  ship flies continuously from orbit to ground. The only mode change is **on foot**
  (§8), which is a player-rig reparent, not a scale transition.
- The **System → Planet entry** (Tier 2 → 3) keeps its existing veil — that boundary
  is a genuine scale jump and is fine to cover. Seamlessness is only required *within*
  the planet, which is exactly what the quadtree provides.

---

## 7 — Gravity, collision & the floating-origin anchor

### 7.1 Gravity is a real radial field

At true radius the planet centre is a well-conditioned attractor in float64:
direction = `normalize(pos − centre)`, magnitude ≈ surface gravity (~8.5 m/s²,
`PlanetaryContents.js:185`), tapering with altitude if desired. No "uniform field"
hack is needed (that was a workaround for the flat-patch model, now obsolete).
`getAttractors()` returns this single planet attractor; `gravityReach` covers from
the orbital standoff down to the surface.

### 7.2 Collision samples the height function

`collideShip` (ship) and the on-foot ground-follow both sample `heightAt(dir)` at the
body's lat/long in float64 — same shared-function discipline as Tier 3. Rest-on-
contact logic carries over from `PlanetaryContents.collideShip` (`:129`): cancel the
inward radial component, keep outward thrust free, skid-friction so it settles.

### 7.3 Floating-origin anchor switches ship → player

Today `_maybeRebaseOrigin` (`App.js:388`) pins the **ship** to the scene origin and
the player rides inside it (`ship.interiorRoot`, `App.js:147`). On foot the **player**
travels and the ship is parked. Generalize the rebase to pin the **active traversal
entity** — ship while piloting, player rig while walking — shifting everything else
(including the parked ship and the planet-centre offset) by the same float64 vector.
Tile origins are camera-relative (§4), so they follow for free.

---

## 8 — On foot: disembark, walk, re-board

Reuse `PlayerController` / `PlayerRig`; **do not** fork the player system. The
in-space tethered `EVA` state is untouched.

- **New surface walking mode** — a `PLAYER_STATE.SURFACE` (or `WALKING`
  parameterized for a planet). Add `src/player/SurfaceLocomotion.js`:
  - Heading basis on the **local tangent plane** (up = `normalize(pos − centre)`),
    look-relative, same input map as deck walking (`WALK_KEYS`).
  - **Ground-follow**: settle feet to `heightAt(dir)` (the planet analog of the deck
    pseudo-gravity, `RelativeLocomotion.js:155`); slope limit instead of walkable
    rectangles.
- **Rig reparent:** on disembark, move `playerRig.object3D` from `ship.interiorRoot`
  into the planet level group at the airlock's world pose; reverse on re-board.
  `PlayerRig.getCameraWorldPose` (`:90`) already does local→world from whatever the
  rig is parented under — only the parent and the "up" convention change.
- **UX:** disembark is gated on `getLandingState().landed === true`. At the airlock:
  *"Press C / Triangle — step out onto the surface"*; near the parked hull on foot:
  *"Press C / Triangle — board the ship."* The **same `Ship`** is the parked prop —
  walk to the real hull and climb back in.
- **Telemetry:** extend the `SURFACE / LANDED` HUD block (`App.js:798–814`) with an
  `ON FOOT` indicator and surface-relative altitude.

---

## 9 — Locked decisions

| Topic | Decision |
|---|---|
| **Flight scope** | **Streaming global flight.** Fly anywhere over the whole planet at low altitude over true-scale terrain. |
| **Planet model** | **Continuous-LOD cube-sphere quadtree at true radius**, for landable terrestrial worlds. **Replaces** the hero-sphere `PlanetaryContents` for those worlds. |
| **Transition** | **Seamless via LOD — no veil, no cross-fade.** Detail resolves on descent, coarsens on ascent. The obsolete `blend` cross-fade from the prior draft is **not** built. |
| **System → Planet entry** | Keeps the existing **veil** (Tier 2 → 3 unchanged). |
| **Gas giants** | Unchanged: hero-sphere cloud deck, orbit-only, no surface. |
| **Curvature / feel** | True-radius sphere → locally flat underfoot, real curvature from altitude (native, not faked). |
| **Scope of EVA** | **Surface walking only.** In-space tethered EVA unchanged. |
| **EVA as mode** | On-foot is a **player-rig reparent / control mode**, not a stack-level descent. |
| **Precision** | Camera-relative tile origins + float64 CPU state + log depth (§4). |
| **Streaming** | Time-sliced async tile queue + bounded LRU cache; async is now mandatory. |
| **Determinism** | Tiles are pure functions of `deriveSeed(planetSeed, 'tile:…')` over the shared `_fbm` basis; re-entry reproducible, orbit shape == surface shape. |
| **Persistence** | Seed-only; tiles disposed when merged/evicted, regenerated on demand. |
| **Gravity** | Real radial field at surface-gravity magnitude (float64). |
| **Traversal anchor** | Floating origin pins the active entity — ship piloting, player on foot. |
| **VR comfort cover** | Deferred — desktop-first (matches the current transition stack). |

---

## 10 — File-by-file change list

**New — shipped (§12 phases 1–4)**

| File | Purpose |
|---|---|
| `src/space/universe/QuadPlanetContents.js` | ✅ Continuous-LOD quadtree planet: cube-sphere quadtree, `heightAt` (coarse only — fine octaves deferred), tile mesh + skirts, per-tile material (logdepth), radial gravity, `collideShip`, `getLandingState`, `gravityReach`, terrain-normal contact damping, landing-site debug helpers, Universe-compatible surface. `runJitterTest()` for precision verification. |
| `src/space/universe/CubeSphereQuadTree.js` | ✅ 6-face cube-sphere quadtree: `update(cameraLocal)` → subdivide/merge by distance proxy; streams tile mesh generation through `TileStreamer`; `_buildTile()` → camera-relative vertices + skirts; `getStats()`. |
| `src/space/universe/planetHeightBasis.js` | ✅ `PlanetHeightBasis`: shared coarse height function (same `_fbm`/`_noiseSeed`/`_noiseOffset` derivation as `PlanetaryContents`) lifted into one module so orbit shape == surface shape. |
| `src/space/universe/TileStreamer.js` | ✅ Time-sliced generation queue + bounded LRU tile cache + geometry disposal (§12 phase 3). Stable face/depth/x/y tile keys preserve deterministic repeated passes. |

**New — shipped (§12 phase 5)**

| File | Purpose |
|---|---|
| `src/player/SurfaceLocomotion.js` | ✅ On-foot walker on the tangent plane: look-relative heading, `heightAt` ground-follow, slope limit, and surface debug step state (§12 phase 5). |

**Edited — shipped (§12 phases 1–4)**

| File | Change |
|---|---|
| `src/config/scaleTiers.js` | ✅ Added `planetTrueRadius()`, `USE_QUAD_PLANET` flag, `QUAD_PLANET` config (tile res, error threshold, capped skirts, metre-based relief, LOD limits, streaming ms budget, cache tile budget). |
| `src/space/scale/Level.js` | ✅ `createPlanetaryLevel` dispatches landable-terrestrial → `createQuadPlanetLevel()` (→ `QuadPlanetContents`); gas → `PlanetaryContents`. |
| `src/app/App.js` | ✅ `camera.far` respects `environment.cameraFar` (true-radius planet needs ~24 Mm far plane). Debug hooks: `getPlanetState`, `runPlanetJitterTest`, `teleportAltitude`, `teleportLatLon`, `findLandingSite`, `teleportLandingSite`. `_teleportShipAltitude()` helper. Planet state mirrored into DOM debug element. |

**Edited — shipped (§12 phase 5)**

| File | Change |
|---|---|
| `src/space/scale/ScaleStack.js` | No change needed (System→Planet stays veiled; no `blend` kind). |
| `src/app/App.js` | ✅ `_maybeRebaseOrigin` anchors on active entity (§7.3); `KeyT` inside/outside EVA toggle; disembark/board debug hooks; `ON FOOT` + active-anchor telemetry. |
| `src/player/PlayerController.js` | ✅ `PLAYER_STATE.SURFACE`, landed disembark/board transitions, `teleportEvaToggle()`, and surface prompt/debug state. |
| `src/player/PlayerRig.js` | ✅ Surface reference frame: camera/body up follows sampled terrain normal while ship-local walking and tethered EVA keep their original up convention. |
| `src/space/universe/QuadPlanetContents.js` | ✅ Public surface sampling/projection helpers expose the shared `heightAt` terrain to on-foot locomotion without mesh raycasts. |
| `src/space/universe/PlanetaryContents.js` | Keep for gas giants; no change needed (shared height basis is now in `planetHeightBasis.js`). |
| `docs/universe-scale-architecture.md` | ✅ Updated §14 to reflect shipped quadtree files and precision foundation. |

---

## 11 — Risks & mitigations

- **True-radius rendering precision (§4)** — make-or-break. *Mitigate:* camera-relative
  tile origins, float64 authoritative state, log depth; verify with a flat-horizon
  jitter test at altitude and on the ground.
- **Async streaming hitches (§5)** — generating tiles mid-flight stalls frames.
  *Mitigate:* ms-budgeted queue, show coarse parent until child ready, cap deep-LOD
  fan-out, reuse buffers. Profile a fast low-altitude pass.
- **LOD cracks / popping** — gaps or visible swaps between levels. *Mitigate:* skirts
  first; tune error threshold + add geomorph (vertex morph between levels) if popping
  is objectionable.
- **Coarse↔fine registration** — fine octaves shifting the continent shape so orbit ≠
  surface. *Mitigate:* fine octaves zero-mean at the coarse band; assert
  `heightAt(dir)` near tile boundaries matches across LOD levels.
- **Gravity/collision at altitude vs ground** — consistent rest-on-contact across the
  whole range. *Mitigate:* one `heightAt`-based collision path for ship and player;
  carry over the proven Tier-3 radial rest logic.
- **Scope creep** — this is a planet engine. *Mitigate:* ship the phases in §12 in
  order; each is independently valuable and verifiable. Do **not** start on-foot (8)
  before flight (3–7) is solid.

---

## 12 — Build order & acceptance checks

Each phase is shippable and verifiable on its own.

1. ✅ **SHIPPED — browser verified.** Static quadtree planet + dynamic LOD + skirts.
   Confirmed in-browser: R = 9,126,466 m, ALT 1577.8 km, gravity 5.81 m/s², SECTOR
   telemetry "terrestrial world (true radius)". No float swim. Tile faceting visible
   at coarse LOD high altitude — expected without geomorph (§6 polish). Jitter
   isolation: camera-relative static error ≤ 3 µm at 2 m altitude.
2. ✅ **SHIPPED (with phase 1)** — Dynamic LOD and skirts implemented in the same pass.
   LOD subdivides/merges by camera distance each frame. Skirts hide edge cracks.
   Visual: tile edges read as faceted geometry at high altitude; geomorph blending
   deferred to §6 polish (does not affect precision or correctness).
3. ✅ **SHIPPED — code/browser smoke verified.** Streaming + async budget. Tile queue,
   LRU cache, ms budget. Parents remain visible until every replacement child tile
   is ready, so the renderer can temporarily show coarser terrain but should not
   expose holes. `getPlanetState()` reports `queueLength`, `cacheSize`,
   `cacheLimit`, `budgetMs`, `totalBuilt`, `generatedLastFrame`, `cacheHits`,
   `cacheMisses`, and `evictions`. *Accept still to profile manually:* a fast
   low-altitude pass over varied terrain holds frame rate; no holes; deterministic
   tiles on a repeated pass.
4. ✅ **SHIPPED — scripted browser smoke verified; pending full manual flight pass.** Ship landing on the quadtree.
   `collideShip` samples `heightAt(dir)` from the shared quadtree terrain basis,
   rests the hull at `SHIP_CLEARANCE`, cancels into-ground contact velocity, damps
   surface tangent drift, and only reports `LANDED` once contact speed is settled.
   `ALT` is now terrain-relative while `clearance` remains available in debug state.
   Debug acceptance helpers: `teleportLandingSite('mountain', m)`,
   `teleportLandingSite('plain', m)`, and `teleportLatLon(lat, lon, m)`.
   *Scripted accept:* plain slope ≈0.12° and mountainside slope ≈6.12° both
   settled to `LANDED`, `ALT` stayed terrain-relative at hull clearance, and an
   outward impulse lifted the ship back to non-contact.
5. ✅ **SHIPPED — syntax smoke verified; pending full manual planet pass.** On foot
   (EVA). `SurfaceLocomotion`, disembark/board, rig reparent, active-anchor switch,
   and `T` inside/outside EVA testing shortcut. *Accept:* walk on detailed ground
   under the ship, terrain-follow over slopes, camera up = surface up, no jitter
   across a rebase on foot, re-board and fly away.
6. **Polish & determinism.** Re-enter a planet → identical terrain. Atmosphere/biome
   tuning, geomorph if needed, instanced surface detail (rocks). Tune `R_true`, LOD
   thresholds, budgets for feel.

---

## 13 — Debug surface & telemetry

Extend `window.__deepSpaceDebug` (`App.js:1290+`):

- `getPlanetState()` — `R_true`, sub-ship lat/long, current max LOD depth, live tile
  count, generation-queue length, cache occupancy/limit, ms budget, generated tiles
  this frame, total built tiles, cache hits/misses/evictions, ship altitude
  (float64).
- `disembark()` / `boardShip()` / `teleportEvaToggle()` — force the on-foot or
  ship-frame EVA transitions. Keyboard `T` calls the same toggle in player mode.
- `teleportAltitude(m)` / `teleportLatLon(lat, lon, m)` — jump the ship for fast
  LOD / streaming verification.
- `findLandingSite(kind)` / `teleportLandingSite(kind, m)` — deterministic plain
  and mountainside test points for quadtree landing acceptance.
- `getSurfaceEvaState()` / `forceRebaseActiveAnchor()` — inspect surface feet
  altitude/slope/up vectors and force the player-anchor rebase acceptance check.
- Mirror tile count + max LOD + active anchor + player state into
  `#deep-space-debug-state` for headless checks.
- Telemetry HUD: `ON FOOT` + surface-relative altitude added to the existing
  `SURFACE / LANDED` block.

---

## 14 — Deferred

- **World-frame in-space EVA** (untether the existing ship-frame float) — separate
  effort; this slice is surface-only.
- **Gas-giant cloud-deck flythrough / true gas LOD** — gas worlds stay hero-sphere
  orbit-only.
- **VR-headset comfort** for low-altitude flight and on-foot (desktop-first now).
- **Real cubemap/IBL parent bake** for the surface/atmosphere sky (reuse the shared
  sky dome for now, per architecture §7).
- **Vegetation, water simulation, weather, structures, fauna, resource interaction.**
- **Web Worker tile generation** (baseline is a time-sliced main-thread queue;
  Workers are a later optimization).
- **Multiple landable bodies streaming at once / moons with surfaces** — one active
  planet at a time this slice.
