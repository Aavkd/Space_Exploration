# Phase 25 — Biomes And Regions (Planet-Gen Depth)

> **Status:** Proposed design — not started. Horizon 5 (The Living World). A
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
> **Last updated:** 2026-06-28.

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
  1. Sample sampleAt(dir) over a fixed geodesic/cube-face lattice
     (coarse, e.g. N×N per cube face) — deterministic sample points.
  2. Label connected components of `land` above sea level -> continents.
  3. Within each continent, segment by dominant biome class -> regions.
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

- [ ] `getRegions()` returns a small, stable set of regions; `regionAt(dir)` is a
      pure function of planet seed and reproduces exactly on re-entry.
- [ ] `regionAt` biome agrees with `sampleAt` biome at the same `dir` (one source
      of truth); region IDs are deterministically ordered and stable.
- [ ] Region computation is independent of tile streaming/LOD — flying the planet
      or changing view never changes region identity.
- [ ] A planet shows two or more visibly distinct biomes/regions whose boundaries
      do not flicker across LOD transitions (fine layer stays zero-mean at the
      coarse band; orbital silhouette unchanged).
- [ ] Instanced ground cover streams and disposes with its tile, is deterministic,
      and never alters `heightAt`/collision.
- [ ] The sea-level water plane renders on ocean worlds with flat sea-level
      collision; non-landable/gas bodies are unaffected.
- [ ] A low-altitude pass across biomes/regions with cover enabled holds the
      documented frame budget; surface EVA still follows visible terrain.
- [ ] `findRegions({biome,kind,minArea})` returns valid placement candidates that
      a seeded offset can resolve to terrain within tolerance (never buried/
      floating) — proven with a placement smoke that reuses the Phase 16 marker
      discipline.
- [ ] Existing landing, surface-EVA, planet-visual, and determinism tests remain
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
| Region lattice resolution | Coarse fixed per-face grid (tune for ~5–15 regions/planet); never tied to render LOD |
| Biome taxonomy | Freeze the existing preset biome set as stable IDs; no new classes this phase |
| Region segmentation | Connected land components → continents; dominant-biome zones → regions |
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

## 10. Debug API (planned)

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

To be completed when implemented. Expected commands:

```powershell
node --experimental-default-type=module --test tests/rpg/*.test.mjs
node --experimental-default-type=module --check <each src/test JavaScript file>
git diff --check
```

- T0–T3: pending (region determinism + `regionAt`/`sampleAt` agreement gate).
- T4–T6: pending owner low-altitude/on-foot + PCVR verification.

---

## 12. Next action

If accepted, the first implementation step is the **region map and its queries**,
not the visual depth. Build `buildRegionMap(planetSeed)` over a fixed lattice of
existing `sampleAt` samples with connected-components labelling, expose
`regionAt`/`getRegions`/`findRegions`, and land the determinism +
`regionAt`↔`sampleAt` agreement tests. Only then add instanced ground cover, the
water plane, and weather descriptors. Do not design Phase 27 city placement until
the region IDs and the placement helper are stable.
