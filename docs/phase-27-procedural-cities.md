# Phase 27 — Procedural Settlements And Cities

> **Status:** Proposed design — not started. Horizon 5 (The Living World). The
> container Phase 28 fills with life. Generates one settlement deterministically,
> with layout and character driven by civ tier, controlling faction, and biome,
> placed on a Phase 25 region.
> **Dependencies:** Phase 25 regions (`regionAt`/`findRegions`, placement
> substrate) + the shipped surface model (`QuadPlanetContents` `heightAt`/
> `getSurfaceSample`/`projectToSurface`, `SurfaceLocomotion`), Phase 16 POI marker
> discipline, Phase 26 embodiment + reused interior shell, Phase 23 substrate/LOD,
> Phase 15/26 NPC contract, `registries.js` factions + civ tiers.
> **Enables:** Phase 28 NPC life simulation, Phase 29 authored faction-hub content.
> **Source design:** `rpg-design-vision.md` §3.3 (planet population, settlement
> types), `worldbuilding.md` (faction aesthetics, tier fluidity),
> `rpg-future-development-roadmap.md` (Phase 27).
> **Last updated:** 2026-06-28.

---

## 1. Why this phase, and what it inherits

Everything a city needs to *sit on* and *be populated by* now exists or is
designed:

- **Where:** Phase 25 regions give deterministic, queryable ground
  (`findRegions({biome,kind,minArea})` → a `regionId` + seeded offset resolved to
  terrain).
- **Who:** Phase 26 embodiment promotes substrate aggregates into standing,
  Phase-24-talkable NPCs and folds them back.
- **Character:** `registries.js` factions carry `civTier`; `worldbuilding.md`
  gives each faction an aesthetic (Commonwealth "lived-in warm," Company of Doom
  "deliberately archaic," Index "clean archival instruments," etc.).

What is missing is the **settlement itself**: a deterministic layout — footprint,
paths, structures, function zones — that reads as a coherent place appropriate to
its tier and faction, conforms to true-scale terrain, and instantiates only when
the player is near. Phase 27 builds exactly that container. It does **not**
animate NPC lives (Phase 28) or populate a city at crowd scale; it proves **one
city** that is generated, walkable, and correctly placed.

---

## 2. The settlement generator (centerpiece)

A pure, deterministic generator keyed on the world, the region, and who controls
it. Same inputs → same city, byte-identical on re-entry (the planet-stack
determinism contract extended to structures).

```text
generateSettlement({ planetSeed, regionId, civTier, factionId }) -> Settlement {
  id,                       // stable: `settlement:<planetSeed>:<regionId>:<n>`
  anchorDir,                // unit-vector centre on the sphere (orbit marker + origin)
  footprint,                // terrain-conformant boundary on the region
  pathGraph,                // nodes + edges: roads/walkways
  structures: [{ id, kind, zone, pose, style, enterable }],
  zones: { market, residential, civic, industry, ... },
  style,                    // resolved tier+faction style params
  populationTarget          // hint for Phase 28 / substrate aggregates
}
```

Generation order (each step deterministic from a derived sub-seed):

1. **Site** — pick the settlement anchor inside the region via `findRegions` +
   `deriveSeed(planetSeed, 'settlement:<regionId>')`; reject steep/invalid ground
   using `getSurfaceSample` slope.
2. **Footprint** — grow a boundary over locally walkable terrain (slope-bounded),
   conforming to `heightAt`/`biomeAt`.
3. **Path graph** — a road/walkway graph (grid, radial, or organic by style)
   laid on the footprint; everything else hangs off it.
4. **Function zones** — partition into market / residential / civic / industry by
   style ratios.
5. **Structure placement** — place structures along the path graph per zone, each
   conformed to terrain (no floating/buried), most as exterior blockouts, a
   capped few `enterable`.

The generator is CPU-pure (no renderer/`three` import for the layout itself), so
it is fully testable headless; rendering consumes its output.

---

## 3. Placement, terrain conformance, and signposting

- **On a region, not a coordinate.** The city binds to a `regionId`; its anchor
  and every structure resolve through the shared surface model, so it lands on
  coherent ground and reproduces on re-entry.
- **Conformance discipline (locked, from `planet-visual-system-revamp.md §4.2`).**
  Structures and paths conform to `heightAt`; nothing floats or is buried.
  Where a flat pad is needed, the generator records an explicit, bounded **grade
  footprint** (a local flatten the surface query honors) rather than shader fakery
  — the player stands on what they see.
- **Signposted from orbit** using the Phase 16 marker discipline: the settlement
  anchor is a descent-visible POI so the player can find it across orbit →
  descent → landing → on-foot scales.
- **Gas giants / non-landable bodies** receive no settlement.

---

## 4. Instantiation as a substrate cluster (player-pull LOD)

A city is a Phase 23 LOD entity, not an always-on scene:

| Distance | Tier | What exists |
|---|---|---|
| In system, not landed | `statistical` | Population/wealth/faction aggregates only; a map/orbit marker |
| Approaching / landed far | `simulated` | Layout generated, structures as blockouts, no embodied NPCs |
| Walking among it | `embodied` | Nearby structures + a budgeted set of Phase 26 embodied NPCs |

- **Player-pull:** full geometry and NPCs instantiate only when the player is
  near, and demote on departure, folding any changed state back to aggregates
  (the §23 reversible round trip). The far city is just numbers.
- **Streaming budget:** layout generation and structure meshing are time-sliced
  through the existing tile/streaming discipline; approach holds the documented
  frame budget. Structures stream in by proximity like terrain tiles.
- **NPC population reuses Phase 26** — Phase 27 supplies zones/anchors and a
  `populationTarget`; it does not add a new NPC system.

---

## 5. Tech-level and faction styling

Style is **generation parameters, not bespoke art** — one structure/material kit
re-parameterized, so a different seed/tier/faction yields a visibly different
city without new assets.

| Style input | Affects |
|---|---|
| `civTier` (0–4) | Structure complexity, path regularity, tech props, density, lighting |
| `factionId` aesthetic | Palette, silhouette language, layout grammar (grid vs organic vs ceremonial) |
| dominant `biome` | Material weathering, foundation type, cover clearing |

Examples (from `worldbuilding.md`, placeholder until Phase 29 content): Commonwealth
→ warm, lived-in, grid-with-plazas; Company of Doom → archaic, fortified,
low-tech silhouette; Index → clean, archival, instrument-like. **Tier is a
runtime state** (`worldbuilding.md` tier fluidity) — a city re-generates its
style band from the *current* civ tier of its controlling faction, so a
collapsed faction's city reads as regressed.

---

## 6. Stable IDs and contracts

- **Settlement ID:** `settlement:<planetSeed>:<regionId>:<n>`, deterministic and
  ordered.
- **Structure ID:** `<settlementId>:struct:<n>`; zone and `enterable` are stable
  attributes.
- The generator is a **pure function of `(planetSeed, regionId, civTier,
  factionId)`**; civTier/factionId come from the Phase 23 substrate at generation
  time and are recorded with the instantiated city so a later tier change is a
  visible re-generation, not silent drift.
- **Enterable interiors reuse the Phase 26 interior shell** — a capped one or two
  per city, not bespoke interiors.
- Consumes only public surface/region/substrate contracts; reaches into no
  rendering, flight, or persistence internals (locked content rule).

---

## 7. Saved-state contract

**No save-envelope version bump.** City geometry is seed-derived and regenerated
on demand (seed-only persistence, like terrain and regions). The player-relevant
facts that must persist already have homes:

- **NPCs met** in the city persist via the Phase 26 met-NPC registry.
- **Faction control / civ tier** of the region lives in the Phase 23 substrate.
- **Visited/discovered** is an existing world-flag/event-log entry.

The only forward guarantee Phase 27 makes is that settlement and structure **IDs
are stable** across runs so Phase 28 schedules and any future persistent fact can
reference them safely. Unique mutable per-structure state (e.g. a building the
player damaged) is explicitly deferred.

---

## 8. Acceptance criteria

- [ ] `generateSettlement` is a pure function of `(planetSeed, regionId, civTier,
      factionId)`; the same inputs reproduce an identical city (layout, IDs,
      structures) on re-entry.
- [ ] Structures and paths conform to terrain within tolerance — nothing floating
      or buried; any flatten is an explicit bounded grade the surface query honors.
- [ ] A clearly different tier/faction/biome input yields a visibly different city
      from the same asset kit.
- [ ] The settlement is signposted from orbit and reachable across orbit →
      descent → landing → on-foot via the Phase 16 marker discipline.
- [ ] The city instantiates player-pull: `statistical` far, `simulated` on
      approach, `embodied` when walked; it demotes on departure with state folded
      back to aggregates (no per-city off-screen simulation).
- [ ] Generation and structure streaming hold the documented frame budget on
      approach and on foot; surface EVA still follows visible terrain among
      structures.
- [ ] Phase 26 embodied NPCs populate zone anchors within budget; the city's
      `populationTarget` matches its substrate aggregate.
- [ ] One or two enterable shells work via the Phase 26 interior reuse.
- [ ] No save-envelope bump; settlement/structure IDs are stable across
      regenerate/reset; gas giants/non-landable bodies get no settlement.
- [ ] Existing region, surface, landing, EVA, and determinism tests stay green.

---

## 9. Explicit exclusions

- **NPC daily life** — jobs, schedules, relationships, movement between buildings
  is Phase 28. Here NPCs stand at zone anchors and talk (Phase 24/26).
- **Building interiors at scale** — one or two enterable shells only; full
  interiors are content/later work.
- **City-wide combat, sieges, destruction, and persistent structural damage.**
- **Per-structure economy ownership** — markets remain the Phase 20 abstraction;
  a structure is not its own economic actor this phase.
- **Crowd-scale population** — a budgeted handful of embodied NPCs, not thousands
  on screen.
- **Bespoke art, named landmarks, and final faction architecture** — deferred to
  the Phase 29 content program.
- **Roads/transit between settlements, vehicles, and intra-city traffic
  simulation.**

---

## 10. Decision gates

| Decision | Recommended default |
|---|---|
| City size cap | Small footprint first (tens of structures), bounded by frame budget |
| Enterable interiors | One or two reused Phase 26 shells per city |
| Layout grammar source | Style params (tier+faction+biome); one re-parameterized kit, no bespoke art |
| Grading | Explicit bounded grade footprints the surface query honors; no shader-only flatten |
| Persistence | Seed-only geometry; no envelope bump; IDs stable for Phase 28 |
| Population wiring | Supply zone anchors + `populationTarget`; reuse Phase 26 for bodies |
| Split trigger | If enterable interiors become a real environment, split into their own phase |

---

## 11. Test ladder mapping

| Level | Phase 27 coverage |
|---|---|
| T0 Static | `node --check` on touched `src/`+`tests/`; `git diff --check` |
| T1 Domain | Generator determinism (same inputs → identical city/IDs), path-graph/zone validity, terrain-conformance + slope rejection, style divergence by tier/faction |
| T2 Persistence | No envelope bump; assert settlement/structure IDs stable across regenerate/reset so Phase 28 can reference them |
| T3 Integration | Generator ↔ region/surface model conformance; ↔ Phase 23 LOD instantiate/demote with fold-back; ↔ Phase 26 NPC population at zone anchors; flight/render isolation on failure |
| T4 Browser | Approach, descend, and walk one city; confirm conformance, streaming budget, enterable shell, no floating/buried structures |
| T5 Manual | Find from orbit → land → walk the layout → enter a shell → meet a Phase 26 NPC → leave and re-enter to identical city |
| T6 XR/device | Sustained approach + on-foot city pass holds comfort/perf on PCVR |

Randomized tests print their seed on failure; substrate/NPC/region use
deterministic fakes.

---

## 12. Debug API (planned)

```js
window.__deepSpaceDebug.cities.generate(planetSeed, regionId)     // headless layout, no render
window.__deepSpaceDebug.cities.getActive()                        // instantiated city + LOD tier
window.__deepSpaceDebug.cities.teleportToCity(settlementId)
window.__deepSpaceDebug.cities.getStructures(settlementId)        // ids, zones, enterable
window.__deepSpaceDebug.cities.getStyle(settlementId)             // resolved tier+faction params
window.__deepSpaceDebug.cities.getBudget()                        // structures streamed, frame cost
window.__deepSpaceDebug.cities.roundTrip(settlementId)            // generate→demote→generate assert
```

`getPlanetState()` gains active settlement ID, LOD tier, and structure count.

---

## 13. Verification record

To be completed when implemented. Expected commands:

```powershell
node --experimental-default-type=module --test tests/rpg/*.test.mjs
node --experimental-default-type=module --check <each src/test JavaScript file>
git diff --check
```

- T0–T3: pending (generator determinism + terrain conformance are the gating
  tests).
- T4–T6: pending owner approach/on-foot + PCVR verification.

---

## 14. Next action

If accepted, the first implementation step is the **headless settlement
generator and its determinism + terrain-conformance tests**, not the NPCs or the
LOD streaming. Build `generateSettlement` over Phase 25 regions producing a
conformant layout + stable IDs, prove same-input reproduction and no floating/
buried structures, then add player-pull LOD instantiation and Phase 26 population.
Do not start Phase 28 life-sim until one city is generated, placed, and walkable.
