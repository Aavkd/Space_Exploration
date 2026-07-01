# Deep Space VR

Deep Space VR is a no-build Three.js space exploration prototype built for desktop and PCVR. It combines a seeded procedural universe, a walkable ship interior, inertial 6-DOF flight, hyperdrive-scale traversal, and a custom WebXR post-processing path that preserves the project's retro deep-space visual identity in VR.

![Desktop cockpit near black hole](docs/assets/desktop-visual-reference-blackhole-cockpit.png)

## Highlights

- Browser-first ES module app with no bundler or install step.
- Seeded procedural universe with stars, galaxies, nebulae, black holes, pulsars, anomalies, POI markers, and live regeneration controls.
- Walkable ship interior with ship-local movement, piloting, and tethered EVA transitions.
- Autonomous ship simulation with inertia, gravity attractors, dampeners, airbrake, boost, and hyperdrive.
- Desktop post-FX stack plus a custom WebXR render path for bloom, retro pixel treatment, scanlines, color depth, and speed-scaled warp.
- Hyperdrive-responsive star-field aberration and Doppler/beaming, tunable from the F2 `Relativistic Stars` group.
- DualSense / standard gamepad support, WebXR controller support, and runtime debug hooks.
- Validated first RPG loop at Port Meridian: cockpit comms, a deterministic two-branch mission, persistent faction reputation, world flags, and conversation outcomes.
- Validated two-system delivery loop: persistent cargo, capacity, credits, protected-reserve fuel, exact-once rewards, and the placeholder Index Relay K-7 destination.
- Validated surface-outpost loop at Index Relay K-7: pinned orbit scanner,
  true-radius descent and landing, surface walking, a physical terminal,
  return-to-ship reporting, and versioned checkpoint persistence.
- Deterministic Commonwealth territory patrol at Port Meridian: one local
  agent, reputation bands, cargo inspection, safe refusal, ignored hails, and
  reload/scale deduplication without combat.
- Persistent hull and six-system condition, a one-shot K-7 derelict
  hazard/salvage transaction, repair inventory, bounded flight degradation,
  and physical maintenance.
- Warned K-7 ship combat with two pulse hardpoints, deterministic targeting,
  one Tier 2 raider, flee/victory/tow outcomes, persistent wreck state, and
  Phase 18 repair consequences.
- Three seeded markets with active-play production/consumption, bounded integer
  prices and stock, atomic trade, stale remote reports, and contraband appraisal.
- A non-hostile Wayfarer derelict loop with secured untethered EVA, active-play
  oxygen, one placeholder interior, exact-once log recovery, and safe return.
- A deterministic hostile K-7 surface site with one pulse carbine, one sentry
  drone, physical cover/LOS, evasion or combat resolution, retryable defeat,
  and an exact-once safe-return reward.
- Live tuning panels: `F2` for post-FX, comfort, XR, and ship tuning, and `F10` for universe generation, presets, import/export, and regeneration.

## Run

This project is served as static files. From the repo root:

```powershell
python -m http.server 5177
```

Then open [http://localhost:5177/](http://localhost:5177/).

## RPG regression tests

The dependency-free RPG suite covers missions, slots and clock, cargo/fuel,
crew, surface placement, faction patrol, condition/repair, ship combat, economy,
Phase 21 boarding, and Phase 22 surface-combat migration, deterministic failures,
atomicity, checkpoint reloads, recovery, and long-run invariants:

```powershell
node --experimental-default-type=module --test tests/rpg/*.test.mjs tests/space/*.test.mjs tests/ship/*.test.mjs
```

## Custom Radio & Music Transceiver

The walkable ship interior features a diegetic radio transceiver console (RX-90) located in the walkway corridor. In addition to default static channels and celestial signals, players can load their own music playlists.

### Adding Custom Music Stations:
1. Create a subdirectory under `assets/audio/custom_radios/` (e.g. `assets/audio/custom_radios/RetroWave/`).
2. Drop your `.mp3` or `.wav` music tracks inside that subdirectory.
3. Run the manifest generator from the project root:
   ```powershell
   node sync-music.js
   ```
4. Boot the game. The custom directories will be loaded dynamically, sorted, and mapped to unique, deterministic FM frequencies (between 88.0 MHz and 108.0 MHz) on the receiver dial.

## Voice Service

The Phase 09 voice assistant service lives in [services/voice-ai/README.md](/D:/Documents/PROJECTS/DEEP_SPACE_VR/services/voice-ai/README.md).

Quick start from `services/voice-ai`:

```powershell
docker compose up --build
```

Then open [http://localhost:8000/dashboard](http://localhost:8000/dashboard).

Notes:

- There is no `package.json` because Three.js is loaded from a CDN import map in `index.html`.
- First load can take a few seconds because `ship.glb` is large and streams in asynchronously.
- A modern Chromium browser is the safest choice for desktop, Gamepad API, and WebXR support.

## Controls

### On foot and EVA

| Input | Action |
| --- | --- |
| Click canvas | Capture mouse |
| Mouse | Look |
| `W` / `A` / `S` / `D` | Walk / strafe or EVA float |
| `Shift` | Run on foot |
| `R` / `F` | EVA up / down |
| `C` | Contextual interact: take controls, open cockpit comms, leave controls, exit airlock, re-enter ship |
| `T` | Teleport/toggle inside-outside EVA for testing |
| `Y` | Safe return during Wayfarer boarding EVA/interior |
| `V` | Return to the first-person player camera |
| `B` / gamepad D-pad Down | Arm/safe the pulse carbine while walking aboard or in EVA |
| Primary mouse / gamepad R2 | Fire the armed pulse carbine; encounter damage applies only at the hostile site |

### Piloting

| Input | Action |
| --- | --- |
| `C` | Take / leave ship controls |
| `W` / `S` | Thrust forward / reverse |
| `A` / `D` | Strafe left / right |
| `R` / `F` | Lift up / down |
| Arrow keys | Pitch / yaw |
| `Q` / `E` | Roll |
| `Shift` | Boost |
| `Z` | Toggle dampeners |
| `X` | Airbrake |
| `Space` | Toggle hyperdrive |
| `B` | Toggle combat mode while piloting, walking aboard, or in EVA |
| `Tab` | Cycle/lock a hostile combat target |
| Primary mouse | Fire locked pulse hardpoints |

### Debug and panels

| Input | Action |
| --- | --- |
| `1` | Exterior debug camera |
| `2` | Interior debug camera |
| `F2` | Post-FX / comfort / XR / ship panel |
| `F10` | Universe panel |
| `F3` | Toggle debug markers |
| `F4` | Toggle retro effect |
| `F6` | Toggle ASCII effect |
| `F7` | Toggle halftone effect |
| `P` | Replay ship startup animation |
| `L` | Toggle ship animation loop |
| `H` | Toggle VR HUD |

### First RPG mission

The first playable RPG slice is `A Clean Copy` in the authored Port Meridian
system:

1. Use the cockpit navigation computer to lock `Port Meridian [RPG]`.
2. Enter the system and walk to the cockpit comms station.
3. Press `C` to contact Harbormaster Vale.
4. Ask for work, accept the route packet, then route it to either the
   Commonwealth or the Index.
5. Reopen comms after resolving the mission to see the saved branch-specific
   response.

The mission result is saved automatically in browser `localStorage`. To reset
only RPG progress without clearing other site data:

```js
window.__deepSpaceDebug.rpg.reset();
```

### Ship log and save slots

Walk to the observation-bay ship computer and press `C` / Triangle / XR select
to inspect `A Clean Copy`, manage three isolated local slots, export validated
JSON, preview/import it into a new slot, and inspect active-play time. Phase 11
version-1 browser saves migrate automatically through the current Phase 21
version-11 envelope / player version 1 / ship version 2 / RPG version 9;
Phase 13–21 slots migrate
non-destructively.
There is no cloud synchronization or offline simulation.

### Cargo delivery

`The Weight of a Copy` is the Phase 14 two-system delivery:

1. At Port Meridian, hail Harbormaster Vale and ask about Index freight.
2. Accept the job, then walk to the observation-bay cargo terminal and load four
   archive canisters.
3. Lock `Index Relay K-7 [RPG]` and engage hyperdrive.
4. Enter the relay, hail Archivist Senn, and complete delivery at the cargo
   terminal.

The route consumes deterministic fuel while preserving a protected reserve.
Static refuel and emergency rescue controls are available at the cargo terminal.

### Surface outpost

`K-7 Surface Verification` connects the existing flight and surface-EVA stacks:

1. Enter `Index Relay K-7 [RPG]`.
2. Use the cockpit navigation computer and lock
   `K-7 Cartography Annex [SURFACE SCAN]`.
3. Descend to the marked first terrestrial world and land inside the safe-area
   marker.
4. Leave through the airlock, walk to the cyan outpost terminal, and press
   `C` / Triangle / XR select to verify its beacon.
5. Return to the ship, board, and report at the observation-bay ship log.

The outpost has fixed authored geography and uses the same terrain sampling as
rendering, collision, landing, and walking. It is not placed on gas giants or
unrelated planets.

### Faction patrol

Entering Port Meridian creates one deterministic Commonwealth patrol encounter
per system visit. `Meridian Watch One` spawns ahead of the cockpit, approaches
on an independent world-space flight path, and waits 60 seconds of active play
for an answer. Reputation and the spawn-time cargo manifest produce a welcome,
inspection, warning/refusal, ignored hail, or safe-hostility departure. No
outcome attacks, damages, confiscates cargo, or forces combat. Leaving the
pilot seat hides but does not resolve the hail; use the cockpit comms station
to resume it.

### Ship condition, salvage, and repair

At Index Relay K-7, walk to the observation-bay cargo terminal and recover the
nearby `index_k7_derelict_cache`. Its one-shot transaction applies a
deterministic micrometeoroid hit and grants three repair parts plus two hull
plates. Use the same physical terminal to repair hull or a named system; every
repair consumes exactly one matching item and saves immediately. Engine and
hyperdrive degradation have bounded live flight effects, while emergency
stabilization keeps critical hull/engine saves controllable.

### Ship combat

The placeholder raider `Red Knife` appears automatically on entering Index
Relay K-7 but holds patrol. After 10 active-play seconds it sends a hostile
comm warning, followed by a 5-second no-attack grace period. Toggle combat mode
with `B` or gamepad D-pad Down, use `Tab` / Triangle to lock it, and use primary
mouse / Cross to fire. The combat lock uses the navigation computer's existing
target and compass display. Combat mode can be toggled anywhere and only controls
the player's weapons; safing weapons does not despawn or resolve an encounter.
Open distance to flee, destroy the raider and claim its exact-once wreck
salvage, or press `Y` after defeat for a recoverable tow. Combat damage
persists into the Phase 18 maintenance loop.

### Dynamic economy and trade

The observation-bay cargo terminal now exposes Port Meridian, Index Relay K-7,
and the placeholder Drifter stop `Wayfarer Exchange`. Port Meridian begins with
surplus field rations while Wayfarer begins short: buy rations at Port, travel
to `Wayfarer Exchange [RPG]`, then sell them and observe stock rise and the sell
price fall. Only local quotes settle trades; remote reports retain an
observation time and display their age. Economy ticks use active-play time only.
Signal scramblers bought at Wayfarer receive a dynamic prohibited-value snapshot
from Commonwealth patrols at Port Meridian. Authored destinations reserve
navigation-computer rows before procedural systems, so all three markets remain
visible in the eight-entry cockpit list.

### Untethered EVA and derelict boarding

Phase 21 adds the peaceful `Wayfarer Survey Wreck [EVA]` contact:

1. Travel to `Wayfarer Exchange [RPG]`, enter its system, and lock the pinned
   wreck contact on the cockpit navigation computer.
2. Approach within 75 m, slow below 1.5 m/s, leave the controls, and walk to the
   airlock.
3. Press `C` / Triangle / XR select to secure the ship and begin untethered EVA.
   Use the existing EVA movement controls to cross to the cyan-lit hatch.
4. Enter the one-room wreck, recover its operations log, exit, and return through
   the ship airlock.

The HUD shows the 180-second active-play oxygen budget and range to the ship and
wreck. `Y`, gamepad Circle, or the XR right-face/A button performs a consequence-
free safe return. Oxygen exhaustion or exceeding 150 m recovers automatically.
Returning before the log leaves the mission retryable; returning with it resolves
the objective exactly once.

### Hostile surface site

At Index Relay K-7, lock `K-7 Black Cache [HOSTILE SURFACE]`, land in its
separate marked area, and disembark. Use the two solid barriers to break the
sentry drone's line of sight. Recover the stolen survey core while the sentry
is alive for the `evaded` route, or destroy it with four clear pulse-carbine
hits for `combat_resolved`. Return aboard for the same exact-once 600-credit
reward. Suit defeat fades back aboard with no reward and leaves the mission
retryable.

Desktop uses camera aim and primary mouse fire; gamepad uses right-stick aim
and Cross; WebXR uses the right-controller ray/select while left select remains
the interaction hand. The supplied `assets/desert_eagle_gun.glb` is the
placeholder weapon model.

### Gamepad and VR

- DualSense and standard gamepads are supported on desktop and in VR.
- In VR, XR controllers are used when no gamepad is connected.
- The project targets PCVR and includes a custom WebXR post-FX route validated for Quest 3 streaming according to [docs/phase-06-xr-post-fx-pipeline.md](docs/phase-06-xr-post-fx-pipeline.md).

## Project structure

```text
assets/
  config/          Runtime JSON overrides
  ship/            Ship manifest / design contract
docs/              Phase notes, specs, and design references
src/
  app/             App orchestration and lifecycle
  config/          Default config and presets
  input/           Gamepad and WebXR input adapters
  player/          Walking, piloting, EVA, and camera rig
  postprocessing/  Custom shaders
  rendering/       Desktop and XR render pipelines, panels, HUD helpers
  rpg/             RPG state, persistence, registries, contacts, missions, and comms runtime
  ship/            Ship entity, physics, controls, model loading, interior
  space/           Procedural universe facade, gravity, and landmarks
  ui/              Diegetic HUD and navigation markers
  xr/              WebXR session and visual FX glue
```

## Configuration and debugging

- Optional startup overrides are loaded from [assets/config/post_processing.json](assets/config/post_processing.json) and [assets/config/universe.json](assets/config/universe.json).
- Runtime presets live in `src/config/`.
- The app exposes `window.__deepSpaceApp` and `window.__deepSpaceDebug` for inspection and scripted validation.

Examples:

```js
window.__deepSpaceDebug.getRenderPipelineState();
window.__deepSpaceDebug.getUniverseState();
window.__deepSpaceDebug.toggleHyperdrive();
window.__deepSpaceDebug.applyUniversePreset('dense_cluster');
window.__deepSpaceDebug.rpg.adjustReputation('commonwealth', 0.25, 'manual-test');
window.__deepSpaceDebug.rpg.getCommsState();
window.__deepSpaceDebug.rpg.getMission('port_meridian_route_packet');
window.__deepSpaceDebug.saves.list();
window.__deepSpaceDebug.saves.getActive();
window.__deepSpaceDebug.saves.getGameTime();
window.__deepSpaceDebug.delivery.getState();
window.__deepSpaceDebug.surfaceOutpost.getState();
window.__deepSpaceDebug.surfaceOutpost.getPlacement();
window.__deepSpaceDebug.patrol.getState();
window.__deepSpaceDebug.patrol.getInfluence('entry_hub');
window.__deepSpaceDebug.patrol.restartVisit('entry_hub');
window.__deepSpaceDebug.condition.getState();
window.__deepSpaceDebug.condition.getCapabilities();
window.__deepSpaceDebug.condition.claimSalvage();
window.__deepSpaceDebug.condition.repair('engine');
window.__deepSpaceDebug.combat.getState();
window.__deepSpaceDebug.combat.toggleMode();
window.__deepSpaceDebug.combat.cycleTarget();
window.__deepSpaceDebug.combat.fire();
window.__deepSpaceDebug.combat.rescue();
window.__deepSpaceDebug.economy.getState();
window.__deepSpaceDebug.economy.getReports();
window.__deepSpaceDebug.economy.buy('field_rations', 1);
window.__deepSpaceDebug.economy.sell('field_rations', 1);
window.__deepSpaceDebug.boarding.getState();
window.__deepSpaceDebug.boarding.getPlacement();
window.__deepSpaceDebug.boarding.recover();
window.__deepSpaceDebug.boarding.setOxygen(30);
window.__deepSpaceDebug.surfaceCombat.getState();
window.__deepSpaceDebug.surfaceCombat.getPlacement();
window.__deepSpaceDebug.surfaceCombat.getPerformance();
window.__deepSpaceDebug.surfaceCombat.fire();
window.__deepSpaceDebug.surfaceCombat.recoverObjective();
```

The Phase 11A-E implementation and verification checklist are documented in
[docs/phase-11-rpg-roadmap.md](docs/phase-11-rpg-roadmap.md).

## Documentation map

- [docs/project-foundation.md](docs/project-foundation.md) - project conventions and source of truth
- [docs/phase-02-ship-design.md](docs/phase-02-ship-design.md) - ship model and hull integration
- [docs/phase-03-ship-physics.md](docs/phase-03-ship-physics.md) - 6-DOF flight and gravity
- [docs/phase-04-ship-interior.md](docs/phase-04-ship-interior.md) - interior walking, piloting, EVA
- [docs/phase-05-vr-comfort.md](docs/phase-05-vr-comfort.md) - WebXR layer and comfort model
- [docs/phase-06-xr-post-fx-pipeline.md](docs/phase-06-xr-post-fx-pipeline.md) - custom XR post-processing path
- [docs/phase-07-procedural-universe.md](docs/phase-07-procedural-universe.md) - procedural universe architecture
- [docs/phase-08-ship-speed-and-hyperdrive.md](docs/phase-08-ship-speed-and-hyperdrive.md) - speed regime and hyperdrive design
- [docs/phase-11-rpg-roadmap.md](docs/phase-11-rpg-roadmap.md) - RPG implementation roadmap and first comms mission slice
- [docs/phase-12-radio-transceiver.md](docs/phase-12-radio-transceiver.md) - radio transceiver system, custom music folders, and cosmic beacons
- [docs/phase-13-save-slots-and-clock.md](docs/phase-13-save-slots-and-clock.md) - versioned world envelope, local slots, ship log, and active-play clock
- [docs/phase-14-cargo-fuel-delivery.md](docs/phase-14-cargo-fuel-delivery.md) - persistent cargo, fuel, recovery, and two-system delivery
- [docs/phase-16-surface-outpost.md](docs/phase-16-surface-outpost.md) - authored planet POI, surface terminal mission, and checkpoint persistence
- [docs/phase-17-faction-patrol.md](docs/phase-17-faction-patrol.md) - deterministic faction influence, cargo policy, and one safe local patrol
- [docs/phase-18-ship-condition.md](docs/phase-18-ship-condition.md) - persistent condition, one-shot salvage/hazard, repair inventory, and recovery
- [docs/phase-19-ship-combat.md](docs/phase-19-ship-combat.md) - opt-in targeting, weapons, Tier 2 enemy, damage, recovery, and cleanup
- [docs/phase-20-dynamic-economy.md](docs/phase-20-dynamic-economy.md) - three markets, active-play ticks, atomic trade, stale intel, and contraband value
- [docs/phase-21-eva-boarding.md](docs/phase-21-eva-boarding.md) - secured untethered EVA, one derelict interior, log recovery, and safe return
- [docs/phase-22-surface-combat.md](docs/phase-22-surface-combat.md) - one hostile surface POI, cover/LOS, pulse carbine, sentry, recovery, and reward
- [docs/phase-23-autonomous-simulation.md](docs/phase-23-autonomous-simulation.md) - simulation substrate: headless deterministic tick, simulation-LOD contract, faction agendas, tier fluidity, and economy/territory re-parenting
- [docs/phase-24-hybrid-dialogue.md](docs/phase-24-hybrid-dialogue.md) - hybrid dialogue: authored-beat vs live-LLM arbitration, the state-safety contract, LOD-aware model routing/budget, and offline fallback
- [docs/phase-25-biomes-and-regions.md](docs/phase-25-biomes-and-regions.md) - planet-gen depth: deterministic region/continent aggregation layer (placement substrate), plus instanced ground cover, water plane, and weather hooks
- [docs/phase-26-npc-presence.md](docs/phase-26-npc-presence.md) - NPC presence: the embodiment service (L2→L3) across surface/station/ship venues, generalized presence contract, budget/selection, and the met-NPC registry
- [docs/phase-27-procedural-cities.md](docs/phase-27-procedural-cities.md) - procedural settlements: deterministic layout generator (region/tier/faction/biome), terrain conformance, player-pull LOD instantiation, and style-as-parameters
- [docs/phase-28-npc-life-simulation.md](docs/phase-28-npc-life-simulation.md) - NPC life-sim: deterministic schedule/needs model, the off-screen abstraction boundary (reconstruct, don't replay), event-traced relationships, and the leave-and-return proof
- [docs/rpg-future-development-roadmap.md](docs/rpg-future-development-roadmap.md) - post-Phase-11 vertical slices, dependencies, tests, and acceptance gates
- [docs/rpg-phase-agent-prompts.md](docs/rpg-phase-agent-prompts.md) - copy-paste implementation prompts for each future RPG phase

## Current caveats

- The imported ship mesh is heavy for VR and may need a decimated or LOD variant for sustained headset performance.
- The interior collision model is an abstract ship-local blockout, not full collision against the authored GLB interior.
- Phase 21 untethered EVA is limited to one secured, 150 m encounter frame; free
  world-frame EVA, moving-ship assault, full physical hazards, and a 3D radar/map
  remain future work.
- Phase 22 is implementation/automation complete but awaits owner-performed
  browser, gamepad, and PCVR/WebXR signoff. It contains one authored sentry and
  one weapon only; the approximately 460k-triangle supplied weapon model is a
  specific live-performance risk until device measurements are recorded.
- Phase 20 is a three-market proof only. It has no docking, cargo meshes, NPC
  logistics, crafting, finance, autonomous faction budgets, or offline
  simulation. Full normal-control route, gamepad, and PCVR signoff is pending.
- Phase 16 ships one placeholder outpost only; procedural settlements, interiors,
  combat, crowds, markets, and spatial transform persistence remain deferred.
- Phase 17 ships one placeholder Commonwealth patrol and one territory policy.
  There are no weapons, damage, fleets, confiscation, dynamic agendas, or
  autonomous budgets. Phase 20 adds one purchasable contraband good and dynamic
  appraisal, but the hail remains a desktop DOM panel rather than a diegetic
  in-headset surface.
- Phase 18 has one text-presented derelict cache and one deterministic hazard.
  There is no boarding, general loot generation, repair animation, crafting,
  salvage market, hostile damage source, or usable weapon system. Full
  gamepad/PCVR device signoff remains pending.
- Phase 19 has one opt-in placeholder raider and pulse weapon only. There are no
  fleets, missiles, shields, capital ships, boarding, ammunition, or equipment
  progression. Full browser normal-control, gamepad, and PCVR device signoff
  remains pending.
- Phase 21 has one peaceful placeholder wreck and a single abstract room. There
  is no docking, hostile boarding, close-quarters combat, general loot,
  procedural interior generation, or life-support-condition coupling. Automated
  verification passes; owner-performed browser/gamepad/PCVR signoff remains open.
