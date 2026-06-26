# Planet Visual System Revamp - Implementation Spec

> **Status: IMPLEMENTED / FIRST PASS SHIPPED.**
>
> This document records the shipped first pass for making planets varied and
> readable while preserving the landing and EVA foundation. It is written against
> the true-radius quadtree planet stack:
> `src/space/universe/PlanetBody.js`,
> `src/space/universe/PlanetaryContents.js`,
> `src/space/universe/QuadPlanetContents.js`,
> `src/space/universe/CubeSphereQuadTree.js`, and
> `src/space/universe/PlanetSurfaceModel.js`.
>
> **Core shipped invariant:** this is not visual-only. Mesh generation,
> material/biome assignment, ship collision, landing telemetry, and on-foot ground
> following derive from one deterministic planet surface model.

### Shipped Summary

- Added typed, seed-derived planet descriptors in
  `src/space/universe/planetPresets.js`.
- Added `src/space/universe/PlanetSurfaceModel.js`, layered on the deterministic
  coarse height basis and extended with biome/material/color/atmosphere sampling.
- The System tier now guarantees the first six landable terrestrial archetypes
  are visible in every generated system: `temperate`, `ice`, `desert`,
  `volcanic`, `barren`, and `toxic`.
- System-tier planet previews use the same descriptors and surface model as the
  true-radius planet entered on descent, with stronger orbit-scale type colors,
  atmosphere rims, toxic haze, ice contrast, barren crater markings, desert bands,
  and volcanic emissive cracks.
- True-radius quadtree tiles consume full surface samples for height, vertex
  color, roughness/emissive hints, slope shading, and material-readable terrain
  grain.
- Ship collision, landing state, `getSurfaceSample()`, `projectToSurface()`, and
  surface EVA continue to sample the shared CPU surface model.
- `window.__deepSpaceDebug.getPlanetState()` now includes useful planet identity
  and surface telemetry such as `planetType`, `biome`, `material`, `slopeDeg`,
  `altitude`, `clearance`, `maxLodDepth`, and `leafTiles`.

---

## 1. Problem

The current planet pipeline is functional, but the screenshots show that the
surface reads as broad low-contrast color fields:

- Terrain types are hard to distinguish in cockpit and on foot.
- Snow, land, rock, ocean, slope, elevation, and ground detail do not have enough
  visual separation.
- Retro/CRT/post effects further compress the already subtle terrain contrast.
- Planet variety is thin: the active set reads mostly as a blue/white world and
  an orange world.

The goal is to make each planet type immediately recognizable from system view,
orbital descent, low-altitude flight, and surface EVA.

---

## 2. Locked Decisions

| Topic | Decision |
|---|---|
| Art direction | Readable stylized sci-fi realism. Not NASA-perfect realism; strong silhouettes, clear terrain bands, and high contrast are more important. |
| Scope | Planet surface model, materials, biome color, atmosphere tint, and planet variety. Physics/collision must stay aligned with the new surface model. |
| Surface truth | One deterministic CPU surface model feeds render geometry and collision. Do not create shader-only height features that the ship/player cannot stand on. |
| Planet archetypes | Start with 6-8 strong planet types rather than many weak color variants. |
| Implementation style | Procedural, seed-driven presets. Avoid large hand-authored texture dependencies for this pass. |
| Existing tiers | Keep the existing scale stack and true-radius quadtree architecture. Gas giants remain orbit-only unless separately scoped later. |
| First milestone | Make the current landable terrestrial world dramatically more legible in cockpit and on foot, then generalize it into reusable presets. |
| Readability target | Terrain must remain readable with the default retro/CRT effects enabled. |

---

## 3. Non-Goals

- Do not rewrite the scale stack or descent/ascension rules.
- Do not replace the true-radius quadtree planet renderer.
- Do not add gameplay resources, structures, vegetation, weather, fauna, or water
  simulation in this pass.
- Do not build a separate collision mesh by raycasting visual geometry.
- Do not make gas giants landable in this pass.
- Do not add full planet persistence beyond the existing seed-only regeneration.

---

## 4. Required Architecture

### 4.1 Single Source of Surface Truth

Create or extend a shared planet surface model, likely by evolving
`PlanetHeightBasis` into a broader `PlanetSurfaceModel`.

The model must expose deterministic queries like:

```js
surface.heightAt(dir)       // radius in metres from planet centre
surface.landAt(dir)         // coarse terrain/continent data
surface.sampleAt(dir)       // complete biome/material/slope/elevation sample
surface.normalAt(dir)       // finite-difference or analytic normal
surface.visualParams()      // atmosphere and material preset values
```

The same object must be used by:

- `CubeSphereQuadTree._buildTile()` for vertex positions, normals, and vertex
  biome data.
- `QuadPlanetContents.heightAt()`, `getSurfaceSample()`, `collideShip()`, and
  surface EVA ground-follow.
- The system/orbit planet impostor material, so the planet seen from the System
  tier matches the world entered at the Planetary tier.

### 4.2 No Shader-Only Terrain Height

Shader detail is allowed for color, roughness, grain, subtle pebble/rock
patterns, and atmospheric/cloud visuals. It must not create apparent cliffs,
trenches, rocks, or dunes that change perceived walkable height unless the CPU
surface model also includes them.

If a detail affects silhouette, normals strongly, collision, landing, or player
feet, it belongs in the shared surface model.

### 4.3 Determinism Contract

Everything must be seed-derived:

```txt
system seed
  -> planet descriptor
    -> planet type
    -> surface seed
    -> biome/noise/layer parameters
    -> tile samples
```

Re-entering the same planet must produce the same terrain, color identity,
atmosphere, and collision surface.

---

## 5. Planet Archetypes

Implemented as data-driven presets. The names are internal. The shipped System
tier guarantees one visible body for each minimum terrestrial archetype before
adding any extra or gas bodies, so the six-type set is inspectable from orbit
instead of being only probabilistic.

| Type | Read From Orbit | Surface Read | Collision/Height Notes |
|---|---|---|---|
| Temperate | Blue oceans, green/brown land, white poles/clouds | Grassland, rock, snow caps, shallow elevation bands | Balanced relief; oceans flat; mountains moderate. |
| Ice | Pale blue/white crust, dark cracks, sparse rock | Snowfields, blue ice, exposed black rock ridges | Lower relief overall, sharp cracked-color patterns mostly visual unless modeled as ridges. |
| Desert | Ochre/sand planet with darker mesas | Dunes, plateaus, eroded ridges, dry basins | Broad rolling relief plus ridge fields; no oceans. |
| Volcanic | Black crust, ember cracks, red/orange glow | Basalt, ash, lava channels, hot vents | Lava channels mostly visual unless carved into height basis; high contrast night-side glow. |
| Barren Moon | Gray/tan cratered body | Dust, craters, ejecta rays, rocky slopes | Craters must be in CPU height if visibly concave. Strong candidate for crater height layer. |
| Toxic | Green/yellow haze, dark land/oily seas | Acid flats, dark rock, toxic fog tint | Seas can be flat; atmosphere does much of the identity. |
| Oceanic | Mostly water, island chains, bright clouds | Coastlines, archipelagos, wet rock, storms | Land fraction low; ocean stays flat at sea level. |
| Exotic Crystal | Dark surface with cyan/magenta mineral veins | Crystalline ridges, bright mineral seams | Keep geometry conservative; use material/biome contrast for identity. |

Minimum first pass shipped: `temperate`, `ice`, `desert`, `volcanic`, `barren`,
`toxic`.

---

## 6. Surface Model Layers

The current `PlanetHeightBasis` already has coarse land, detail, ridge, and micro
terms. Extend that idea into named layers with per-type parameters.

### 6.1 Coarse Shape

Purpose: continents, broad basins, mountain ranges, polar forms.

Requirements:

- Deterministic from planet seed.
- Stable from orbit to surface.
- Drives both the orbital/system preview and quadtree tiles.
- Exposes normalized values used by biome coloring.

### 6.2 Biome Classification

`sampleAt(dir)` should return enough data for both color and gameplay-safe
surface logic:

```js
{
  height,
  elevation,
  normalizedElevation,
  land,
  moisture,
  temperature,
  slope,
  biome,
  material,
  color,
  roughnessHint
}
```

For the first implementation, `moisture` and `temperature` may be procedural
noise/latitude values rather than simulation.

### 6.3 Relief Features

Add feature layers per archetype:

- Ridge fields for mountains, badlands, ice pressure ridges.
- Crater depressions and raised rims for barren moons.
- Dune-like rolling bands for desert worlds.
- Lava/acid channel masks for volcanic/toxic worlds.

Any relief layer that visibly changes the terrain profile must contribute to
`heightAt(dir)`.

### 6.4 Micro Detail

Micro detail can be split:

- **Physical micro detail:** small height variation included in CPU `heightAt`.
  Keep amplitude modest to avoid rough landing jitter.
- **Visual micro detail:** shader grain/pebbles/color flecks that do not affect
  collision. Good for readability under CRT effects.

---

## 7. Rendering Requirements

### 7.1 Tile Geometry

Update `CubeSphereQuadTree._buildTile()` to consume the richer surface sample:

- Vertex position from `surface.heightAt(dir)`.
- Vertex normal from the same height function.
- Vertex attributes for color and optional material data:
  - `aColor`
  - optional `aBiome`
  - optional `aRoughness`
  - optional `aMaterialMask`

Keep camera-relative tile origins and log depth exactly as documented in
`surface-eva-tier.md`.

### 7.2 Terrain Material

Replace the current mostly color-only tile shader with a more legible material:

- Stronger diffuse contrast between biome bands.
- Slope-darkening or slope-rock tint.
- Elevation-based snow/ice/ash/sand caps depending on archetype.
- Directional sunlight plus ambient fill.
- Subtle high-frequency grain that survives the retro post stack.
- Optional rim/atmospheric haze near horizon.

Do not make the planet one-note. Each preset should use at least three visually
distinct material families, such as:

- lowlands / midlands / highlands
- plains / rock / snow
- basalt / ash / lava
- sand / mesa rock / salt flats

### 7.3 System/Orbit Preview

`PlanetBody.js` currently has small system-level sphere materials. They should
use the same planet descriptor/preset identity as the true-radius level:

- Same planet type.
- Same palette family.
- Same land/sea/ice/crater/lava masks at coarse scale where feasible.
- Same atmosphere tint and ring/cloud decisions.

The preview does not need full quadtree detail, but it must not misrepresent the
world the player enters.

### 7.4 Atmosphere and Clouds

Per-type atmosphere should be driven by the preset:

- Temperate: blue rim, white cloud layer.
- Ice: pale blue, thin haze.
- Desert: dusty amber haze.
- Volcanic: smoky red/orange haze, possible emissive cracks.
- Toxic: green/yellow haze.
- Barren: thin or none.
- Oceanic: saturated blue rim, heavier clouds.

Clouds may remain visual-only. They must not hide all terrain readability.

---

## 8. Collision and Traversal Requirements

### 8.1 Ship Collision

`QuadPlanetContents.collideShip()` must continue sampling the shared surface
model. Acceptance:

- The ship rests at the visible terrain height plus clearance.
- It does not float above mountains or sink into plains.
- Landing state remains stable on representative terrain for each archetype.
- Steep slopes do not produce violent normal flips.

### 8.2 Surface EVA

`SurfaceLocomotion` must sample the same surface model through
`QuadPlanetContents.getSurfaceSample()` / `projectToSurface()`.

Acceptance:

- Feet follow visible terrain.
- Camera/player up follows terrain normal.
- Walking over color/biome transitions does not pop the player height.
- The floating-origin active anchor still works on foot.

### 8.3 Slope and Landing Safety

The revamp should expose slope/elevation metadata so debug tools can find safe
and unsafe landing sites:

- `findLandingSite('plain')` should find low-slope ground.
- `findLandingSite('mountain')` should find higher elevation / higher slope.
- Add or preserve debug telemetry for slope, biome, and surface material.

---

## 9. Data Model

Implemented file:

```txt
src/space/universe/planetPresets.js
```

It exports:

```js
export const PLANET_TYPES = { ... };

export function createPlanetDescriptor({ seed, index, type, starProfile }) {
  // returns kind, type, palette, atmosphere, clouds, rings, surface params
}

export function createPlanetSurfaceModel(descriptor) {
  // returns the shared CPU surface model
}
```

Suggested descriptor shape:

```js
{
  name,
  kind: 'terrestrial' | 'gas',
  type: 'temperate' | 'ice' | 'desert' | 'volcanic' | 'barren' | 'toxic',
  palette: {
    water,
    lowland,
    midland,
    highland,
    snow,
    rock,
    accent,
    emissive
  },
  atmosphere: {
    color,
    density,
    rimStrength
  },
  surface: {
    seaLevel,
    reliefMetres,
    baseFreq,
    ridgeAmplitude,
    craterDensity,
    duneStrength,
    microAmplitude
  },
  clouds: {
    enabled,
    opacity,
    color,
    coverage
  },
  landable,
  hasRings,
  systemRadius,
  childSeed
}
```

Backward compatibility is preserved with `paletteArray` and palette
normalization helpers so legacy gas/hero-sphere paths can still consume
three-color arrays while the new terrestrial path uses typed palette objects.

---

## 10. File-by-File Implementation

### New Files

| File | Purpose |
|---|---|
| `src/space/universe/planetPresets.js` | Planet archetype definitions, guaranteed/minimum type list, descriptor creation, compatibility palette helpers, and `createPlanetSurfaceModel()`. |
| `src/space/universe/PlanetSurfaceModel.js` | Shared CPU surface model layered over `PlanetHeightBasis`; exposes height, land, biome/material, color, normal, slope/elevation, atmosphere/material params. |

### Edited Files

| File | Implemented changes |
|---|---|
| `src/space/universe/planetHeightBasis.js` | Kept as the deterministic coarse/noise base used by `PlanetSurfaceModel`. |
| `src/space/universe/PlanetBody.js` | Replaced the tiny terrestrial palette list with typed descriptors, stronger system-tier preview masks, per-type atmosphere rims, clouds, and orbit-scale identity cues. |
| `src/space/universe/SystemContents.js` | Generates full descriptors, guarantees the first six terrestrial archetypes in every System tier, passes descriptors through descent, and exposes `system.planetTypes` in debug state. |
| `src/space/universe/QuadPlanetContents.js` | Constructs the shared surface model, uses it for height/collision/EVA/debug state, and adds per-type atmosphere plus material-aware terrain shading. |
| `src/space/universe/CubeSphereQuadTree.js` | Requests full surface samples per vertex and writes color/material data while preserving camera-relative precision. |
| `src/space/universe/PlanetaryContents.js` | Keeps the gas giant/orbit-only fallback path compatible with normalized descriptors and legacy palette arrays. |
| `src/config/scaleTiers.js` | Keeps performance/LOD constants global, with slightly deeper/readable default terrain LOD and larger cache. |
| `src/app/App.js` | Existing debug hook now receives richer planet state from `QuadPlanetContents`; no new App hook was needed. |

---

## 11. Build Order

1. **SHIPPED - Descriptor and preset foundation**
   - Add typed planet descriptors.
   - Generate and visibly guarantee at least six terrestrial archetypes in the
     System tier.
   - Keep existing planets functional through compatibility adapters.

2. **SHIPPED - Shared surface model**
   - Extend `PlanetHeightBasis` into a model that returns height + biome/material
     samples.
   - Preserve `heightAt` for current collision callers.

3. **SHIPPED - Quadtree color/material upgrade**
   - Update tile generation to consume `sampleAt`.
   - Improve shader contrast, slope/elevation color, and terrain grain.

4. **SHIPPED - Collision/EVA surface agreement**
   - Confirm ship landing and surface EVA still agree with visible geometry.
   - Add debug readout for planet type, biome, slope, altitude.

5. **SHIPPED - System/orbit preview alignment**
   - Update `PlanetBody` materials so distant planets match their entered
     surface identity.

6. **SHIPPED - Atmosphere/cloud/ring polish**
   - Add per-type atmosphere tints and cloud settings.
   - Keep terrain legible through clouds and post effects.

7. **ONGOING - Preset tuning pass**
   - Visit each archetype in cockpit and on foot.
   - Tune colors for the retro/CRT default and VR comfort preset.

---

## 12. Acceptance Checks

### Visual

- From cockpit at low altitude, terrain classes are distinguishable without
  disabling CRT/post effects.
- From surface EVA, the player can visually read nearby slopes, ridges, plains,
  snow/ice/sand/rock boundaries, and horizon shape.
- From system view, planet type is recognizable before descent.
- Every generated System tier includes the six minimum terrestrial archetypes as
  visible bodies before any optional extras/gas giants.
- No planet archetype reads as only one color family.

### Physics Agreement

- `heightAt(dir)` is the sole authority for visible tile height and collision.
- Ship touchdown matches visible terrain on plains, hills, ridges, and crater
  floors/rims where applicable.
- Surface EVA feet stay on the visible terrain.
- Re-entering a planet gives identical terrain and collision.
- Tile LOD changes do not alter collision height at the same `dir`.

### Performance

- Terrain tile generation remains time-sliced.
- No new full-screen pass is required for the first implementation.
- Shader complexity remains safe for desktop and reasonable for XR; avoid heavy
  fragment raymarching in terrain materials.

### Debug

`window.__deepSpaceDebug.getPlanetState()` should include:

```js
{
  planetType,
  biome,
  material,
  slopeDeg,
  altitude,
  clearance,
  maxLodDepth,
  leafTiles
}
```

Existing landing-site helpers should continue to work.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Visual detail diverges from collision | Require all meaningful height/slope features to live in the shared surface model. |
| Shader gets too expensive in XR | Favor vertex colors, simple material masks, and cheap noise. Avoid raymarching. |
| Presets become palette swaps | Give each type distinct height, biome, atmosphere, cloud, and material rules. |
| Terrain becomes too noisy for landing | Keep physical micro detail amplitude conservative; use visual-only grain for extra readability. |
| Orbit preview lies about the entered planet | Build preview masks from the same descriptor and coarse surface model. |
| Existing save/debug flows break | Keep old descriptor fields or provide adapters during migration. |

---

## 14. Definition of Done

First pass is considered shipped when:

- The active landable planet is visually legible in cockpit and on
  foot.
- Six or more seeded terrestrial archetypes are generated and visibly present in
  the System tier.
- Distant/system planets preview the same identity they reveal on descent.
- Ship collision and surface EVA use the same surface model as the rendered
  quadtree.
- Manual testing confirms no visible mismatch between terrain and contact.
- Debug output exposes planet type, biome/material, slope, altitude, LOD, and
  landing state.

Remaining polish after the first pass:

- More hand-tuned per-type color balancing under every post-FX preset.
- Optional geomorphing/edge polish if deeper readable LOD reveals tile transitions.
- Additional archetypes such as `oceanic` and `exoticCrystal`.
