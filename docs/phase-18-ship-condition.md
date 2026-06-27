# Phase 18 — Ship Condition, Hazard, Salvage, And Repair

> **Status:** Implementation and automated/browser verification complete.
> Full normal-control travel-loop, gamepad, and PCVR/WebXR device signoff remain
> open, so the phase is not yet marked complete.
> **Dependencies:** Phase 14 persistent ship/cargo state and Phase 17
> deterministic territory/event foundations. Phase 17's extended manual
> policy/device checklist remains an upstream known limitation, but its
> Phase 18 dependencies are implemented and covered by automation.

## Scope and playable proof

Phase 18 makes the ship the deterministic character sheet before combat exists.
The normal-control proof loop is:

1. Fly to Index Relay K-7 (`index_hq`).
2. Walk to the existing physical cargo/fuel terminal and open it with `C`,
   gamepad Triangle, or XR select.
3. Recover the one-shot `index_k7_derelict_cache`. The atomic transaction
   applies `index_k7_micrometeoroid_shear`, grants three repair parts and two
   hull plates, records events, and saves once.
4. Spend a hull plate on hull damage or a repair part on a named system.
5. Reload after salvage and after each repair to verify exact persistence and
   exact-once consumption.

The derelict and hazard use placeholder text presentation. There is no boarding,
untethered EVA, combat, market, or crafting system.

## Stable IDs and state contract

- Salvage source: `index_k7_derelict_cache`
- Hazard: `index_k7_micrometeoroid_shear`
- Repair items: `repair_parts`, `hull_plates`
- Condition records: `hull`, `engine`, `hyperdrive`, `sensors`, `comms`,
  `life_support`, and `weapons`

The envelope advances from version 6 to version 7. The ship domain advances
from version 1 to version 2 and adds:

```text
condition: {
  hull: { current, maximum }
  systems: {
    engine|hyperdrive|sensors|comms|life_support|weapons:
      { condition }
  }
}
inventory: {
  repairParts
  hullPlates
}
maintenance: {
  salvageSources: {
    index_k7_derelict_cache: {
      claimed
      claimedAtGameTime
    }
  }
  hazards: {
    index_k7_micrometeoroid_shear: {
      triggered
      triggeredAtGameTime
    }
  }
}
```

Condition values sanitize into `[0, 100]`; inventory sanitizes to bounded
non-negative integers. Non-finite values, malformed records, unknown saved
source/hazard IDs, and invalid timestamps are rejected descriptively. The real
v6/ship-v1 migration initializes pristine condition, empty repair inventory,
and unclaimed/untriggered encounter records without changing earlier domains.

## Deterministic effects and transactions

The one-shot hazard applies:

- hull: `-35`
- engine: `-45`
- sensors: `-30`

and grants exactly three repair parts plus two hull plates. Claim, damage,
inventory, event records, and checkpoint save are one transaction. A claimed
source cannot grant inventory or apply damage again through reload, re-entry,
or repeated input.

Hull repair consumes one hull plate and restores up to 25 condition. A system
repair consumes one repair part and restores up to 30 condition. Invalid/full
targets and insufficient inventory fail before mutation.

Capability multipliers are pure bounded functions of condition:

- engine translation authority: `0.40..1.00`
- hyperdrive spool/authority: `0.50..1.00`
- sensor range/readiness: `0.50..1.00`
- comms clarity/readiness: `0.60..1.00`
- life-support efficiency: `0.60..1.00`
- weapons readiness: `0.50..1.00` (observable only; weapons do not exist yet)
- hull integrity: `0.50..1.00`

Engine and hyperdrive multipliers affect the live flight model. Floors preserve
translation, rotation, braking, and hyperdrive escape at every condition
reachable in this phase. Other effects are exposed in the maintenance UI,
telemetry, and debug state until their owning gameplay systems exist.

## Critical-state recovery

If hull or engine condition is at or below 10, the maintenance console offers
free emergency stabilization. One atomic action raises each critical record to
25, records the recovery event, and saves. It grants no items, credits, fuel,
or reward and cannot be repeated while the ship is above the critical
threshold. This prevents a future/corrupt-but-valid critical checkpoint from
becoming an unrecoverable proof-slice save.

## Acceptance criteria

- [x] Hull and all six named systems validate, sanitize, migrate, round-trip,
  reset, and appear in normal/debug inspection.
- [x] Capability effects are finite, bounded, observable, and preserve control.
- [x] One non-combat hazard and one one-shot salvage source are reachable with
  normal controls.
- [x] Salvage, damage, inventory grants, events, and saving are atomic.
- [x] Salvage cannot duplicate through repeat input, reload, or system re-entry.
- [x] Repairs consume exactly one correct item and apply exactly one bounded
  repair; failures do not partially mutate state.
- [x] Damage and repair persist at every important checkpoint.
- [x] Extreme finite condition/inventory values sanitize safely; malformed and
  non-finite state is rejected descriptively.
- [x] Critical-state stabilization is recoverable, persistent, and non-farmable.
- [x] Optional Phase 18 initialization/storage failure cannot break flight,
  rendering, walking, or earlier RPG systems.
- [x] Existing RPG regressions, static checks, and a real browser smoke pass.
- [ ] Keyboard/mouse and gamepad physical interaction paths pass; changed
  WebXR interaction receives explicit device signoff.

## Explicit exclusions

- Weapons, projectiles, targeting, hostile AI, combat damage, enemy ships, crew
  injury, oxygen/food consumption, death, defeat, or save deletion.
- Untethered EVA, derelict boarding/interiors, general loot generation, random
  hazards, broad crafting/recipes, repair animations, or final art.
- Dynamic salvage or repair markets, item prices, buy/sell, economy ticks,
  offline simulation, insurance, towing, or station docking.
- Changes to Phase 17 patrol outcomes or cargo confiscation.

## Manual, reload, and device checklist

- [ ] Clean slot: enter Index Relay K-7 and open the physical terminal.
- [ ] Claim the cache; verify exact damage and `3` parts / `2` plates.
- [ ] Close and reopen the terminal; verify the cache is already claimed.
- [ ] Reload after salvage; verify damage/inventory and no duplicate claim.
- [ ] Leave and re-enter Index; verify no duplicate claim.
- [ ] Repair hull once; verify one plate consumed and reload persistence.
- [ ] Repair engine and sensors once each; verify one part consumed per repair.
- [ ] Attempt a full/unknown target and empty-inventory repair; verify no
  partial mutation.
- [ ] Reach a critical hull/engine checkpoint, stabilize, reload, and verify
  condition 25 with no granted inventory.
- [ ] Reset the active slot; verify pristine condition and unclaimed salvage
  without changing another slot.
- [ ] Fly with the hazard damage and with each reachable condition extreme;
  verify thrust, rotation, dampeners, airbrake, and hyperdrive remain usable.
- [ ] Repeat open/action/close with gamepad Triangle.
- [ ] Repeat open/action/close with WebXR select on a PCVR headset.
- [ ] Confirm walking, landing, scale transitions, cargo, fuel, patrol, comms,
  ship log, crew, outpost, audio, and earlier missions remain functional.

## Debug API

```js
window.__deepSpaceDebug.condition.getState()
window.__deepSpaceDebug.condition.getCapabilities()
window.__deepSpaceDebug.condition.claimSalvage()
window.__deepSpaceDebug.condition.repair('hull')
window.__deepSpaceDebug.condition.repair('engine')
window.__deepSpaceDebug.condition.stabilize()
window.__deepSpaceDebug.condition.setConditionForDebug('engine', 0)
window.__deepSpaceDebug.condition.setInventoryForDebug({ repairParts: 3, hullPlates: 2 })
window.__deepSpaceDebug.condition.openTerminal()
```

Debug mutations use the same validation, transaction, event, and save paths as
normal play. Debug APIs are not required to complete the proof loop.

## Verification record

Recorded on 2026-06-27.

```powershell
node --experimental-default-type=module --test tests/rpg/*.test.mjs
node --experimental-default-type=module --check <each touched .js/.mjs file>
git diff --check
```

- T0 static: all touched JavaScript and test modules pass `node --check`;
  `git diff --check` passes (line-ending notices only).
- T1–T3 domain/persistence/integration: 53/53 RPG tests pass. The seven Phase
  18 tests cover the real v6/ship-v1 migration, exact atomic salvage/damage,
  reload/re-entry deduplication, exact repair consumption, no-partial-mutation
  failures, critical recovery, extreme/corrupt sanitization, bounded capability
  floors, cross-domain cargo/fuel preservation, and reset.
- T4 Chromium browser: the live WebGL app reached walking telemetry with
  `HULL 100 / ENG 100 / SENS 100`. Using normal keyboard controls, the player
  walked from interior spawn to the existing physical cargo terminal, pressed
  `C`, and opened `CARGO / FUEL / MAINTENANCE`. The panel showed all seven
  records, inventory, bounded capabilities, salvage state, repair actions, and
  stabilization. Attempting salvage outside K-7 produced the descriptive
  `requires authored system index_hq` failure. No new console error occurred
  after the final refresh.
- T5 manual: full clean-save travel, salvage, all checkpoint reloads, repair,
  critical recovery, degraded-flight, and compatibility checks remain open.
- T6 device: no gamepad was attached and the browser reported WebXR unsupported.
  The implementation reuses the previously validated cargo-terminal
  `C`/Triangle/XR-select dispatch, but Phase 18 gamepad and headset signoff
  remains open.
