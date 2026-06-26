# Phase 14 — Cargo, Fuel, And Two-System Delivery

> **Status:** Complete. Automated verification, Chromium smoke testing, and the
> owner-performed normal-control/gamepad/WebXR checklist are recorded below.

## Scope

Phase 14 proves one authored, deterministic delivery loop:

1. At Port Meridian (`entry_hub`), hail Harbormaster Vale and accept
   `index_archive_delivery`.
2. Walk to the ship cargo terminal and load four sealed archive canisters.
3. Lock the placeholder Index HQ, `Index Relay K-7` (`index_hq`), in the
   existing navigation computer.
4. Engage hyperdrive. The authored route consumes a deterministic amount of
   fuel once and records an in-transit jump.
5. Enter Index Relay K-7, hail Archivist Senn, and deliver at the cargo
   terminal.
6. The required cargo is removed and the ship receives 850 credits plus 0.15
   Index reputation exactly once.

The cargo terminal is a ship-local physical interaction available through the
existing `C`, gamepad Triangle, and XR select paths. Debug APIs inspect and
exercise the same authoritative runtime but are not required for normal play.

## Stable content IDs

- Cargo: `index_archive_canister`
- Mission: `index_archive_delivery`
- Objectives: `load_archive_canisters`, `travel_to_index_hq`,
  `deliver_archive_canisters`
- Systems: `entry_hub`, `index_hq`
- Contacts: `port_meridian_harbormaster`, `index_hq_archivist`
- Successful branch: `delivered`
- Failure outcomes: `abandoned`, `cargo_lost`

`index_archive_canister` has unit mass 5, mission quantity 4, and legality tags
`legal`, `index_sealed`, and `mission_cargo`. Legality is descriptive in this
phase; scans and contraband policy remain deferred.

## Saved-state contracts

The save envelope advances from version 2 to version 3. RPG state advances from
version 1 to version 2. Existing version-2 slot bytes are retained while a
version-3 copy is created.

The version-3 `ship` domain contains:

```text
credits
fuel: { current, capacity, reserve }
cargo: { capacityMass, stacks[{ cargoId, quantity }] }
travel: {
  currentSystemId,
  pendingJump: { originSystemId, targetSystemId, distance, fuelCost } | null
}
```

All numeric values are finite and bounded. Cargo IDs must exist in the cargo
registry, quantities are positive integers, duplicate stacks are merged, mass
cannot exceed capacity, and system IDs must exist. Invalid imports and invalid
transitions fail with descriptive errors.

Mission lifecycle remains `unavailable`, `offered`, `accepted`, `resolved`, or
`failed`. Objectives have their own `pending`, `active`, `complete`, or
`failed` state plus timestamps. Loading completes the pickup objective; arrival
completes travel; delivery completes the final objective and lifecycle.

Autosaves occur at acceptance through the existing RPG runtime and atomically
at cargo, fuel, arrival, delivery, abandon/loss, refuel, and rescue mutations.

## Hyperdrive fuel and recovery

Authored route cost is:

```text
fuelCost = 8 + 2 × ceil(distance / 10,000 world units)
```

Distance is calculated from the fixed registry positions of the origin and
target systems. Engagement is rejected when paying the cost would reduce fuel
below the protected reserve of 15. A persisted `pendingJump` makes repeat
engagement, reload, and scale re-entry idempotent; arrival clears it.

Normal refuel is static: 25 credits buys up to 10 fuel at either authored
system. When fuel is at or below reserve, emergency rescue costs up to 50
available credits and restores fuel to at least reserve plus the most expensive
currently authored route cost. Rescue is deterministic, cannot create negative
credits, and is available at the physical cargo terminal. No market stock,
price movement, time tick, or free trading is introduced.

## Acceptance criteria

- [x] Cargo definitions have stable IDs, quantity, mass, and legality tags.
- [x] Credits, fuel, reserve, capacity, cargo, and travel state validate,
  sanitize, migrate, round-trip, reset, and appear in debug inspection.
- [x] The second fixed-seed authored system and its contact are reachable.
- [x] Mission objectives are separate from lifecycle status.
- [x] Cargo cannot load before acceptance or outside Port Meridian.
- [x] Cargo cannot deliver before load or outside Index HQ.
- [x] Full-capacity and insufficient-fuel states are rejected and explained.
- [x] Route fuel cost is deterministic and charged once across reload/re-entry.
- [x] Protected reserve and emergency rescue prevent a permanent stranding.
- [x] Delivery removes only four required canisters and awards exactly 850
  credits and 0.15 Index reputation once.
- [x] Duplicate delivery, abandon, cargo loss, and destination re-entry are
  idempotent or rejected descriptively as appropriate.
- [x] Saves before pickup, after loading, in transit, after delivery, and during
  both failure outcomes restore coherent state.
- [x] Phase 11 `A Clean Copy` behavior and outcomes remain unchanged.
- [x] Flight/rendering remain usable if Phase 14 initialization or storage fails.

## Explicit exclusions

- Dynamic markets, market stock, production, demand, price changes, or free
  buying/selling.
- Contraband scans, patrols, docking, station interiors, cargo meshes, loaders,
  NPC ships, schedules, or offline simulation.
- General route planning, arbitrary procedural-system fuel charges, ship
  condition, repairs, combat, crew, surface outposts, or final Index lore/art.

## Manual and device checklist

- [x] Clean slot: accept the job through Vale with keyboard/mouse.
- [x] Walk to the cargo terminal; load using `C`; verify mass and objective.
- [x] Reload before pickup and after loading.
- [x] Lock Index Relay K-7, engage hyperdrive, verify the documented fuel charge.
- [x] Disengage/re-engage and reload in transit; verify no duplicate charge.
- [x] Enter Index HQ, hail Archivist Senn, deliver at the terminal, and verify
  exact cargo removal/reward.
- [x] Reload after delivery and re-enter the destination; verify no duplicate.
- [x] Fill cargo, retry loading, and verify a visible capacity error.
- [x] Reduce fuel below route requirement, retry jump, and verify reserve error.
- [x] Exercise normal refuel and emergency rescue.
- [x] Exercise abandon and jettison/loss on separate saves, then reload.
- [x] Reset only the active slot and verify Phase 14 state resets while other
  slots remain intact.
- [x] Repeat terminal open/action/close with a gamepad.
- [x] Repeat terminal open/action/close with WebXR select on a PCVR headset.
- [x] Confirm walking, piloting, scale transition, hyperdrive, audio, radio,
  navigation, comms, ship log, and `A Clean Copy` still function.

## Debug API

```js
window.__deepSpaceDebug.delivery.getState()
window.__deepSpaceDebug.delivery.syncSystem('entry_hub')
window.__deepSpaceDebug.delivery.loadCargo()
window.__deepSpaceDebug.delivery.beginJump('index_hq')
window.__deepSpaceDebug.delivery.deliver()
window.__deepSpaceDebug.delivery.abandon()
window.__deepSpaceDebug.delivery.loseCargo()
window.__deepSpaceDebug.delivery.refuel()
window.__deepSpaceDebug.delivery.emergencyRescue()
window.__deepSpaceDebug.delivery.setFuelForDebug(15)
window.__deepSpaceDebug.delivery.addCargoForDebug('maintenance_supplies', 1)
window.__deepSpaceDebug.delivery.openTerminal()
```

These hooks call the same authoritative runtime used by normal play. The direct
RPG resolver rejects `index_archive_delivery`; cargo/reward resolution cannot
bypass the cargo domain.

## Verification record

Recorded on 2026-06-27.

Automated commands:

```powershell
node --experimental-default-type=module --test tests/rpg/*.test.mjs
node --experimental-default-type=module --check <each touched .js file>
git diff --check
```

- T0 static: all touched JavaScript modules passed `node --check`;
  `git diff --check` passed.
- T1–T3 domain/persistence/integration: 21/21 tests passed. Coverage includes
  version-2 envelope and RPG-v1 migration, every delivery checkpoint, capacity,
  reserve/recovery, forged routes, abandon/loss, duplicate delivery, re-entry,
  exact-once credits/reputation, initial-approach hyperdrive compatibility, and
  all existing Phase 11/13 regressions.
- T4 browser: the post-fix app loaded in Chromium at
  `http://127.0.0.1:5177/` with no console errors or warnings. The live renderer
  reported walking state plus `FUEL 100/100 reserve 15` and `CARGO 0/40`.
  The owner completed the full player-facing browser loop and supplied a capture
  showing a migrated three-slot archive, `resolved / delivered`, 1,150 credits,
  full fuel, and zero cargo mass.
- T5 manual: the project owner reported every checklist item passed, including
  all checkpoint reloads, failure/recovery paths, reset, and compatibility.
- T6 device: the project owner reported the gamepad and PCVR/WebXR terminal
  open/action/close checks passed.

Two issues found during owner testing were corrected before signoff:

- Initial approach and same-system hyperdrive no longer enter the authored-route
  fuel gate; only travel between two different known authored systems is metered.
- `PlayerController.interact()` now passes `openCargoTerminal` through to all
  keyboard, gamepad, and XR dispatchers.

## Known limits

- `Index Relay K-7`, Archivist Senn, terminal presentation, and all art are
  placeholders.
- Fuel applies only to routes between authored systems. Procedural-system fuel
  planning is intentionally deferred.
- Cargo has no physical mesh or loading animation.
- Prices and rewards are static; there is no market stock or free trading.
- Emergency rescue is deliberately deterministic and abstract, without a tow
  vessel or elapsed-time simulation.
