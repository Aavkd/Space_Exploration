# Phase 25 — Biomes And Regions (Planet-Gen Depth)

> **Status:** **PARTIAL / VISUAL ACCEPTANCE FAILED.** The deterministic region,
> placement, weather, cover-streaming, and water contracts are implemented and
> automated tests pass. The actual normal-control landed view was rejected on
> 2026-07-01: terrain, water, cover, materials, and scale composition still do
> not meet the visual target. Phase 25 is not complete and must not be presented
> as T4-approved. Horizon 5 (The Living World). A
> standalone exploration/visual upgrade that *also* produces the placement
> substrate Phase 27 cities and surface content sit on.
> **Dependencies:** the shipped true-radius quadtree planet stack and shared
> surface model — `QuadPlanetContents`, `CubeSphereQuadTree`/`TileStreamer`
> (`surface-eva-tier.md`), `PlanetSurfaceModel.sampleAt`/`planetPresets.js`
> (`planet-visual-system-revamp.md`), and the `planetHeightBasis` determinism
> contract. No dependency on the Phase 23 substrate.
> **Enables:** Phase 16-style POI placement on a real region basis, Phase 26 NPC
> surface venues, and Phase 27 procedural cities.
> **Source design:** `rpg-design-vision.md` §3.3 (planet population),
> `rpg-future-development-roadmap.md` (Phase 25).
> **Last updated:** 2026-07-01.

---

## 0. Rejected attempts and current live failure (2026-07-01)

Owner review of the live build rejected the current planet rendering. This is
not a polish problem: the screenshots show broken terrain representation and an
art direction substantially worse than the intended Phase 25 result.

Evidence reviewed:

- [`assets/phase-25-live-player-failure-2026-07-01.png`](assets/phase-25-live-player-failure-2026-07-01.png)
  — latest normal-control landed view after the replacement implementation.
- `codex-clipboard-a4cbb24c-9aa9-481b-a1ec-c4df8441b99a.png` — true-radius
  temperate planet viewed from the cockpit near the surface.
- `codex-clipboard-2c101e73-6603-4b1b-bf8d-0eb179739358.png` — close surface view
  of the generated ground cover.
- Owner report: temperate planets remain visibly misshapen in the System-scale
  view after the attempted scale isolation. This report is not represented by a
  third screenshot but is an explicit failed acceptance result.

### Latest live-build evidence

![Rejected Phase 25 landed player view](assets/phase-25-live-player-failure-2026-07-01.png)

The latest screenshot is authoritative over the isolated browser harness. It
shows the real game at Tier 3, player walking, ship landed, and normal UI active.
The geometry is no longer the original missing-face prototype, but the result is
still visually unacceptable:

| Area | Current live result | Severity |
|---|---|---|
| Terrain hierarchy | The foreground is a vast, almost flat lime plane followed by one broad dark ridge. There are no readable plains-to-foothills-to-ranges transitions, valleys, erosion, or useful landing-scale formations. | Critical |
| Material/biome read | Temperate terrain is effectively two flat colors: luminous yellow-green ground and near-black ridges. Soil, grass, rock, moisture, slope, and regional transitions do not read as distinct materials. | Critical |
| Ground cover | Cover technically streams and instances, but at player distance it reads as sparse black needles/spikes with repetitive silhouettes and arbitrary distribution. It does not read as vegetation or grounded rock. | Critical |
| Water/horizon | The blue surface forms a huge opaque horizontal band/slab across the middle distance. Its shoreline, depth, reflection, and atmospheric relationship are unclear, so it reads as a rendering layer rather than water. | Critical |
| Lighting and depth | Terrain and cover have weak contact shading, scale cues, and distance separation. The dark ridge collapses into a silhouette while the foreground remains uniformly bright. | High |
| Planetary sky composition | Large overlapping star/moon discs dominate the surface sky and weaken scale credibility. This may originate in parent-system projection rather than the region model, but it is part of the failed landed experience. | High |
| Exploration value | The visible world offers no landmark, route, terrain pocket, biome identity, or compelling destination. Stable region IDs do not yet correspond to regions the player can visually recognize. | Critical |

**Owner verdict:** still ugly; Phase 25 visual acceptance failed.

### Observed critical failures

| Area | Observed result | Severity |
|---|---|---|
| Planetary silhouette | The true-radius terrain reads as a thin, jagged diagonal sheet/ribbon rather than a coherent spherical horizon. Large grey voids are visible below it. | Critical |
| Surface continuity | The visible edge contains repeated triangular teeth, abrupt gaps/steps, and likely skirt or LOD-boundary exposure. The surface does not read as watertight. | Critical |
| System-scale planet shape | Temperate planets are reported as no longer round. Phase-25 deformation leaked into, or otherwise failed to remain isolated from, the System-scale representation. | Critical |
| Terrain form | Relief appears as noisy, uniformly corrugated displacement. There are no legible geological hierarchies such as plains → foothills → ranges or broad valley/canyon systems. | Critical |
| Tessellation | Large individual terrain triangles and their color boundaries are plainly visible at walking distance. The ground reads as a low-poly debug mesh. | Critical |
| Ground cover | Cover is represented by black cones with visibly repeated primitive silhouettes. It resembles debug collision markers, not grass, rocks, ice, or biome-specific debris. | Critical |
| Cover placement | Cones are evenly and arbitrarily scattered, with poor scale variation and no convincing clustering, orientation, grounding, or relationship to terrain/material. | High |
| Lighting/material response | Cover is effectively unlit black against dark terrain. Terrain colors form hard polygonal patches rather than continuous material transitions. | High |
| Biome readability | The temperate surface is mostly dark green/black noise; biome boundaries, landforms, soil, rock, vegetation, and distance cues are not visually distinguishable. | High |
| Exploration value | Neither screenshot presents a navigable landmark, readable route, safe landing pocket, canyon floor, or region identity. The result does not satisfy the requested terrain variety. | Critical |

### Historical acceptance verdict

- **Rejected:** Phase 25 is not implemented.
- **Rejected:** ground cover must not ship in its current cone-placeholder form.
- **Rejected:** regional relief/canyon work has not produced readable or
  believable terrain.
- **Rejected:** System-scale and Planet-scale shape isolation is not proven.
- **Blocked:** region/placement APIs cannot be accepted while the underlying
  visual and physical terrain representation is visibly broken.
- **Do not continue to Phase 26/27** from this state.

### Technical replacement attempt (not visually accepted)

The replacement keeps region aggregation separate from rendered geometry and
does not add terrain displacement. It fixes cube-face winding, returns terrain
to front-face rendering, bounds the old 120 m skirt drops to 0.5-20 m, replaces
black cones with lit biome-specific instancing, removes unstable planet-scale
hash grain, adds flat sea-level water, and includes a repeatable browser harness.

The following gates are failed or pending:

1. **Failed:** owner normal-control landed/on-foot review shown above.
2. **Pending:** System, orbital, and low-altitude comparison captures.
3. **Pending:** re-entry comparison on target hardware.
4. **Blocked:** sustained PCVR comfort/performance pass until desktop visuals
   meet the baseline.

The original required-recovery list is retained below as historical context:

1. Restore a round, unchanged System-scale planet silhouette and prove the
   System preview does not consume true-radius metre displacement.
2. Restore a watertight, coherent true-radius surface with no exposed
   skirts/voids and verify LOD transitions from orbit to ground.
3. Establish a terrain-only visual benchmark with no cover enabled: broad plains,
   readable ranges, valleys/canyons, stable normals, and continuous materials.
4. Do not re-enable cover until terrain passes. Replace generic cones with a
   deliberate biome asset/shape language and validate lighting, grounding,
   density, and scale in close-up.
5. Capture before/after screenshots at System, orbital, low-altitude, landed, and
   on-foot distances. Owner visual approval is a gate, not a follow-up.

The current experimental output is useful only as a failure record. Its visual
choices and scale coupling are not approved design decisions.

---

## 1. What already ships, and what this phase actually adds

Two things the vision calls "biomes" already exist and must **not** be rebuilt:

- **Per-point biome classification.** `PlanetSurfaceModel.sampleAt(dir)` already
  returns `{ height, elevation, normalizedElevation, land, moisture,
  temperature, slope, biome, material, color, roughnessHint }`, deterministic
  from the planet seed, and is the single source of truth for render geometry,
  collision, landing, and surface EVA (`planet-visual-system-revamp.md`).
- **Planet archetypes.** Six guaranteed terrestrial types (`temperate`, `ice`,
  `desert`, `volcanic`, `barren`, `toxic`) with typed palettes and atmospheres.

So Phase 25 is **not** "add biomes." Classification is a *point* query; the
vision asks for **continents and regions** the player and the simulation can
reason about, and for surfaces with enough **depth** to be worth standing in.
This phase adds exactly two things on top of the shipped foundation:

1. **A region/continent aggregation layer** — turn the per-point biome field
   into a small set of stable, queryable, named **regions** (connected landmass +
   biome zones) with IDs, so POIs, settlements, and faction presence can be
   *placed on a region* instead of a bare coordinate. This is the genuinely
   missing structure and the prerequisite for Phase 27 cities.
2. **Biome depth** — instanced ground cover, a sea-level water plane, and weather
   *hooks*, built on the existing `sampleAt` within the existing tile/streaming
   budget, so biomes read as places rather than colour bands.

The shipped "what you see is what you touch, reproducibly" invariant is preserved
throughout: nothing here introduces shader-only height or non-deterministic
terrain.

---

## 2. The region/continent layer (centerpiece)

Regions are a **deterministic, low-resolution aggregation of the existing coarse
biome field** — computed once per planet from seed, independent of which tiles
have streamed in. The player can fly the whole planet without changing them, and
re-entry reproduces them exactly.

### 2.1 How regions are computed (deterministic, streaming-independent)

```text
buildRegionMap(planetSeed) ->                       // pure, cached per planet
  1. Sample `sampleAt(dir)` over a fixed 12×24 spherical latitude/longitude
     lattice — coarse deterministic points unrelated to render tiles.
  2. Label connected components of `land` above sea level -> continents.
  3. Within each continent, aggregate cells by stable biome class -> regions.
  4. Emit stable region records with derived attributes.
```

- The lattice resolution is fixed config, **not** the render LOD — region
  identity never depends on camera path or tile streaming.
- Connected-components labelling over a fixed sample set is deterministic, so the
  region map is a pure function of the planet seed (same discipline as the height
  basis). It is cached; it is **not persisted** (seed-only regeneration, matching
  the planet stack's locked persistence decision).

### 2.2 Region record and queries

```text
Region {
  id,                 // stable: `region:<planetSeed>:<n>`
  kind,               // 'continent' | 'sea' | 'ice_cap' | 'region'
  parentContinentId,  // null for top-level continents/seas
  dominantBiome,      // a stable biome id from the preset taxonomy
  biomeMix,           // { biomeId: fraction }
  centroidDir,        // unit vector to region centroid (for markers/placement)
  bounds,             // angular extent / bounding cap
  areaFraction,       // share of planet surface
  meanElevation, meanSlope
}
```

Public queries (added to `QuadPlanetContents` / the surface model):

```text
regionAt(dir) -> regionId
getRegions() -> Region[]
getRegion(regionId) -> Region
findRegions({ biome?, kind?, minArea? }) -> Region[]      // placement helper
```

`regionAt` must agree with `sampleAt`'s biome at the same `dir` (one source of
truth). Placement systems (Phase 16 POIs, Phase 27 cities, faction stamping) take
a `regionId` + a seeded offset within its bounds rather than a raw coordinate, so
content lands on coherent ground and survives re-entry.

---

## 3. Biome depth

Built on `sampleAt`, inside the existing time-sliced tile pipeline and LRU cache.
None of this introduces a new precision regime or a full-screen pass.

- **Instanced ground cover.** Per-biome scatter (grass tufts, rocks, ice shards,
  dunes' debris) instanced on deep-LOD tiles only, seeded
  `deriveSeed(planetSeed, 'cover:<face>:<lod>:<x>:<y>')` so it is reproducible and
  streams/disposes with its tile. Cover is **visual-only** — it never changes
  `heightAt`/collision (locked rule from `planet-visual-system-revamp.md §4.2`).
- **Water plane.** A sea-level surface for worlds with oceans (temperate/oceanic/
  toxic), rendered as a shaded plane/shell at `seaLevel`; flat collision at sea
  level (no buoyancy/hydrology). Toxic/volcanic variants reuse the same plane with
  preset tint/emissive.
- **Weather hooks, not weather.** A per-region/biome weather *descriptor*
  (clear/dust/snow/storm) exposed for later use and optional cheap visual
  particles near the player. No simulation, no gameplay effect this phase.
- **Richer per-biome feel** within budget: improved colour/material separation
  and cover density per biome, extending the existing terrain material.

---

## 4. Stable IDs and contracts

- **Biome IDs:** reuse the existing preset taxonomy (`planetPresets.js` /
  `PlanetSurfaceModel`); Phase 25 fixes them as stable IDs but does not invent a
  new classification.
- **Region IDs:** `region:<planetSeed>:<n>`, assigned in a deterministic order
  (e.g. descending area) so the same seed yields the same IDs.
- **Cover/weather:** seeded per tile/region; no global identity needed.
- The region map and all queries are **pure functions of the planet seed**;
  re-entry is byte-identical. This is asserted, not assumed.

---

## 5. Saved-state contract

**No save-envelope version bump.** Regions, ground cover, water, and weather
descriptors are all seed-derived and regenerated on demand (the planet stack's
locked seed-only persistence). Nothing here writes player/ship/RPG/simulation
state.

The only persistence touchpoint is forward-looking: when Phase 16/27 place
content, they will store a `regionId` reference. Phase 25 guarantees those IDs
are stable across runs so later phases can persist them safely; it does not add
the persistence itself.

---

## 6. Acceptance criteria

- [x] `getRegions()` returns a small, stable set of regions; `regionAt(dir)` is a
      pure function of planet seed and reproduces exactly on re-entry.
- [x] `regionAt` biome agrees with `sampleAt` biome at the same `dir` (one source
      of truth); region IDs are deterministically ordered and stable.
- [x] Region computation is independent of tile streaming/LOD — flying the planet
      or changing view never changes region identity.
- [ ] A planet shows two or more visibly distinct biomes/regions whose boundaries
      do not flicker across LOD transitions (fine layer stays zero-mean at the
      coarse band; orbital silhouette unchanged).
- [ ] Instanced ground cover streams and disposes with its tile, is deterministic,
      and never alters `heightAt`/collision. The mechanical contract passes, but
      the live cover still reads as rejected black spikes.
- [ ] The sea-level water plane renders on ocean worlds with flat sea-level
      collision; non-landable/gas bodies are unaffected. The layer exists, but
      its live horizon/shoreline presentation is rejected.
- [ ] A low-altitude pass across biomes/regions with cover enabled holds the
      documented frame budget; surface EVA still follows visible terrain.
      Isolated harness timing is insufficient evidence for the normal game path.
- [x] `findRegions({biome,kind,minArea})` returns valid placement candidates that
      a seeded offset can resolve to terrain within tolerance (never buried/
      floating) — proven with a placement smoke that reuses the Phase 16 marker
      discipline.
- [x] Existing landing, surface-EVA, planet-visual, and determinism tests remain
      green.

---

## 7. Explicit exclusions

- **Full hydrology** (rivers, lakes, flow, buoyancy, tides) and **climate/weather
  simulation.** Water is a flat plane; weather is a descriptor + optional visual.
- **Fauna, vegetation simulation, growth, or harvestable resources.** Ground
  cover is decorative instancing only.
- **Destructible or persistent terrain changes.** Surfaces stay seed-only.
- **New planet archetypes** beyond the shipped six (oceanic/exotic remain backlog
  from `planet-visual-system-revamp.md §14`), unless one is trivially enabled.
- **Gas giants.** Unchanged: hero-sphere, orbit-only.
- **Content placement itself.** Phase 25 provides the region substrate and the
  placement helper; actually placing outposts/cities/factions is Phase 16/26/27.
- **Simulation coupling.** Regions are geography; faction control over a region is
  a Phase 23/26 concern that consumes these IDs, not part of this phase.

---

## 8. Decision gates

| Decision | Recommended default |
|---|---|
| Region lattice resolution | Fixed 12×24 spherical grid; never tied to render LOD |
| Biome taxonomy | Freeze the existing preset biome set as stable IDs; no new classes this phase |
| Region segmentation | Connected land components → continents; per-continent biome aggregates → regions |
| Ground-cover budget | Instanced, deep-LOD-only, per-biome density cap inside the existing tile ms budget |
| Water | Flat sea-level plane + flat collision; no hydrology |
| Weather | Descriptor + optional near-player particles; no simulation |
| Persistence | Seed-only; no envelope bump |

---

## 9. Test ladder mapping

| Level | Phase 25 coverage |
|---|---|
| T0 Static | `node --check` on touched `src/`+`tests/`; `git diff --check` |
| T1 Domain | Region map determinism (same seed → same IDs/attributes), `regionAt` vs `sampleAt` agreement, connected-components correctness on fixtures, `findRegions` filters |
| T2 Persistence | No envelope bump; assert region IDs are stable across regenerate/reset so later phases can reference them |
| T3 Integration | Region queries ↔ surface model agreement; placement smoke resolves a region to in-tolerance terrain; cover never changes collision height at a fixed `dir` |
| T4 Browser | Descend and traverse ≥2 biomes/regions; confirm cover/water render, no boundary flicker, frame budget held |
| T5 Manual | Fly a full low-altitude pass across regions; land in a `findRegions` candidate; re-enter and confirm identical regions/terrain |
| T6 XR/device | Sustained low-altitude + on-foot pass with cover enabled holds comfort/perf on PCVR |

Randomized tests print their seed on failure; determinism tests re-run the same
seed twice and diff.

---

## 10. Debug API

```js
window.__deepSpaceDebug.regions.getRegions()
window.__deepSpaceDebug.regions.regionAt(lat, lon)
window.__deepSpaceDebug.regions.find({ biome: 'temperate', minArea: 0.05 })
window.__deepSpaceDebug.regions.teleportToRegion(regionId)        // placement/verification
window.__deepSpaceDebug.regions.getCoverState()                   // instanced count, budget, cache
window.__deepSpaceDebug.regions.toggleCover(false)
window.__deepSpaceDebug.regions.toggleWater(false)
window.__deepSpaceDebug.regions.getWeather(regionId)
```

`getPlanetState()` gains `regionId` and `regionBiome` alongside the existing
`biome`/`material`/`slopeDeg` fields.

---

## 11. Verification record

The original prototype and the later replacement both failed owner visual
review on 2026-07-01. Automated systems checks remain useful but do not override
the live normal-control screenshot:

```powershell
node --experimental-default-type=module --test tests/rpg/*.test.mjs tests/space/*.test.mjs tests/ship/*.test.mjs
node --experimental-default-type=module --check <each src/test JavaScript file>
git diff --check
```

- T0: all touched JavaScript passed syntax checks; `git diff --check` passed.
- T1-T3: 6 Phase 25 domain tests and the full 154-test RPG/space/ship suite
  passed. No save-envelope version changed.
- T4 isolated diagnostic: `tests/browser/phase-25-harness.html` ran without new
  console errors, reached LOD 17 with 459 leaves and 328 cover instances, and
  measured 8.82 ms average frame time. This harness did not reproduce or catch
  the unacceptable composition of the real landed game.
- T4/T5 actual game: **failed.** The owner-provided landed/on-foot screenshot
  shows flat lime terrain, black ridge bands, spike-like cover, slab-like water,
  weak material/depth cues, and no recognizable region identity.
- T6: blocked until the desktop normal-control visual baseline passes.

---

## 12. Next action

Treat the domain substrate as implemented but freeze Phase 26/27 dependencies
until the visual surface passes. The next visual recovery must:

1. Validate the normal game path with cover and water disabled.
2. Establish readable terrain hierarchy and continuous biome materials.
3. Fix the water/shoreline/horizon layer and landed parent-system sky scale.
4. Reintroduce cover only after terrain and water pass, with recognizable,
   grounded biome silhouettes and non-uniform clustering.
5. Capture System, orbital, low-altitude, landed, and on-foot evidence from the
   actual game before changing this status.
