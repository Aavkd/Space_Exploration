# Phase 20 — Dynamic Economy And Trade

> **Status:** Implementation and automated verification complete. A live
> Chromium render/runtime smoke passes; the normal-control trade route and
> gamepad/PCVR checks remain open, so the phase is partial rather than complete.
> **Dependencies:** Phase 13 active-play clock and save slots, Phase 14 cargo,
> credits, authored travel, and physical cargo terminal, and Phase 17 cargo
> legality/patrol snapshots.

## Scope and playable proof

Phase 20 adds one deliberately small trade network:

1. Inspect the three market reports at the ship's physical cargo terminal.
2. Buy `field_rations` from the surplus at Port Meridian.
3. Travel to the shortage at the Drifter market, `Wayfarer Exchange`.
4. Sell the rations for a profit.
5. Observe both stocks and both prices respond to the moved quantity.

The same terminal supports local buying and selling at Port Meridian
(`entry_hub`), Index Relay K-7 (`index_hq`), and Wayfarer Exchange
(`drifter_convergence`). Remote reports are cached observations with an explicit
`observedAtGameTime` and age; only the local market is refreshed to a live
snapshot. Wayfarer Exchange, its name, star, and primitive market presentation
are placeholder proof content.

### Navigation discoverability correction

The cockpit computer shows eight POIs. Its original system quota was
`floor(limit × 0.35)`, which provided only two system rows at that limit and
silently removed the third authored destination before rendering. Authored
systems now reserve system rows before any procedural-star quota is applied.
The list remains capped at eight, but Port Meridian, Index Relay K-7, and
Wayfarer Exchange are all guaranteed rows while they are positioned authored
destinations.

## Stable IDs and deterministic contracts

Markets:

- `port_meridian_exchange`
- `index_k7_exchange`
- `wayfarer_exchange`

Trade goods:

- `field_rations`
- `navigation_components`
- `unregistered_signal_scrambler`

Mission cargo and repair inventory are not trade goods. Each market/good pair
has authored integer minimum, maximum, target, initial stock, per-tick
production, and per-tick consumption. One economy tick is 60 seconds of Phase
13 `gameTime`. A tick applies:

```text
stock = clamp(stock + production - consumption, minimum, maximum)
```

No wall clock, page-close duration, or offline catch-up input is used. Tick
processing is deterministic, bounded, and capped per update; the runtime can
resume remaining accumulated active-play ticks on later updates.

Prices are positive integer credits. A deterministic scarcity multiplier is
derived from current stock and authored maximum stock, then clamped before the
market spread is applied. Buy prices round upward; sell prices round downward.
All transaction totals are safe integers, so repeating buy/sell at unchanged
state loses the spread and can never manufacture fractional credits.

## Saved-state and transaction contract

The save envelope advances from version 8 to version 9. Its `simulation` domain
adds:

```text
economy: {
  version,
  seed,
  lastTickGameTime,
  nextLedgerSequence,
  markets: {
    byId: {
      [marketId]: {
        id,
        systemId,
        lastUpdatedAtGameTime,
        goods: { [cargoId]: { stock } }
      }
    }
  },
  intel: {
    byMarketId: {
      [marketId]: {
        observedAtGameTime,
        goods: { [cargoId]: { stock, buyPrice, sellPrice } }
      }
    }
  },
  ledger: [{
    id, sequence, marketId, systemId, cargoId, side, quantity, unitPrice, total,
    gameTime, creditsBefore, creditsAfter, stockBefore, stockAfter,
    cargoBefore, cargoAfter
  }]
}
```

The real version-8 migration initializes the economy at the saved
`simulation.gameTime`; it does not simulate time that elapsed before migration.
RPG state advances from version 6 to 7 and patrol state from 1 to 2; existing
active/history scans migrate with zero-valued historical appraisals because no
authoritative Phase 20 market existed when those snapshots were created.
Every field validates and sanitizes through the save envelope. Unknown IDs,
invalid bounds, non-integer stock/money, forged ledger arithmetic, or time
regression fail descriptively. Ledger retention is bounded.

A buy or sell validates a clone of the current envelope, applies credits,
cargo, market stock, local intel, and one ledger entry, then makes one
`saveDomains` write. Therefore reload observes the wholly previous or wholly
next transaction, never a partially updated cross-domain state. Storage
failure follows the existing visible in-memory fallback.

## Patrol integration

`unregistered_signal_scrambler` is normally purchasable at Wayfarer Exchange.
The Phase 17 Commonwealth scan still snapshots the manifest at encounter spawn,
but each match now also records an integer appraised unit value and total value
from the current Port Meridian economy state. The scan exposes a
`contrabandValue` total. Value is presentation/policy input only in this phase:
the existing deterministic refusal outcome remains unchanged and patrol never
confiscates cargo or credits.

## Acceptance criteria

- [x] Exactly three reachable markets and three stable-ID trade goods exist.
- [x] Stock, production, consumption, tick timing, and prices are deterministic.
- [x] Stocks and prices remain finite, integer, positive where applicable, and
  within authored bounds in long seeded runs.
- [x] Economy advances from Phase 13 active play only and does not change while
  the game is closed.
- [x] Buy/sell atomically updates credits, cargo, stock, intel, and ledger.
- [x] Invalid IDs, quantities, local context, insufficient credits, cargo
  capacity, cargo quantity, and market capacity are rejected descriptively.
- [x] Integer quote/settlement rules prevent rounding and buy/sell exploits.
- [x] Reload around automated transaction checkpoints is wholly before or after.
- [x] Remote market information exposes observation time and age.
- [x] Commonwealth patrol snapshots expose the dynamic value of contraband.
- [x] The Port Meridian to Wayfarer rations route remains profitable at clean
  initial state and visibly narrows after trade.
- [x] Version-8 migration, version-9 round trip, corruption rejection, reset,
  and debug inspection are covered.
- [x] Existing RPG and flight-boundary regressions remain green.
- [ ] A normal-control browser smoke uses the physical cargo terminal without
  a debug shortcut.

## Explicit exclusions

- Galaxy-wide logistics, NPC freighters, route simulation, market orders,
  futures, loans, interest, speculative finance, crafting, manufacturing
  chains, autonomous faction budgets, taxation, docking fees, confiscation,
  barter, equipment markets, procedural markets, or offline simulation.
- Dynamic faction agendas, relationship changes, autonomous market ownership,
  or any Phase 23 scheduler.
- Cargo meshes, loading animation, final station art, or a new physical
  terminal. Phase 20 reuses the Phase 14 terminal and interaction dispatch.

## Manual and device checklist

- [ ] Clean slot: open the physical terminal at Port Meridian with keyboard and
  inspect local live quotes plus two age-stamped remote reports.
- [ ] Confirm `Wayfarer Exchange [RPG]` appears on the cockpit navigation
  computer, can be locked normally, and remains present after reload.
- [ ] Buy rations normally; verify credits, cargo mass, stock, price, and ledger.
- [ ] Reload immediately and verify exactly one purchase.
- [ ] Travel to Wayfarer Exchange, reopen the same terminal, refresh local intel,
  and sell the rations for a positive net route profit.
- [ ] Verify destination stock rises and sell price falls after the sale.
- [ ] Reload immediately and verify exactly one sale.
- [ ] Exercise insufficient funds, cargo capacity, cargo quantity, and full
  market rejection without any partial mutation.
- [ ] Let active play cross tick boundaries; verify production/consumption.
- [ ] Close/reopen without advancing saved game time; verify no economy change.
- [ ] Buy a signal scrambler at Wayfarer, enter Port Meridian, and verify the
  patrol scan displays an immutable positive contraband value.
- [ ] Reset the active slot and verify initial markets return while other slots
  remain unchanged.
- [ ] Repeat terminal open, buy/sell, and close with a gamepad.
- [ ] Repeat the changed terminal interaction with WebXR select on PCVR.
- [ ] Confirm flight, walking, landing, scale transitions, hyperdrive, audio,
  navigation, comms, save slots, cargo mission, patrol, maintenance, and combat
  still initialize and remain usable.

## Debug API

The debug surface will call the same authoritative runtime as normal play:

```js
window.__deepSpaceDebug.economy.getState()
window.__deepSpaceDebug.economy.getMarket('port_meridian_exchange')
window.__deepSpaceDebug.economy.getReports()
window.__deepSpaceDebug.economy.syncSystem('entry_hub')
window.__deepSpaceDebug.economy.update()
window.__deepSpaceDebug.economy.buy('field_rations', 1)
window.__deepSpaceDebug.economy.sell('field_rations', 1)
window.__deepSpaceDebug.economy.openTerminal()
```

## Verification record

Recorded on 2026-06-27.

```powershell
node --experimental-default-type=module --test tests/rpg/*.test.mjs
node --experimental-default-type=module --check <each src/test JavaScript file>
git diff --check
```

- T0: all 120 JavaScript/ESM files under `src/` and `tests/` pass
  `node --check`; `git diff --check` passes.
- T1–T3: 74/74 RPG tests pass; the complete repository test run passes 83/83.
  The twelve Phase 20 tests cover the version-8
  migration, deterministic quotes/ticks, clean profitable proof route, price
  response, rounding resistance, atomic failures, stale intel, dynamic
  contraband appraisal, interrupted durable writes, corrupt persistence, and a
  deterministic one-million-tick soak using seed `deep-space-vr-economy-v1`.
- T4 partial: the static app loaded to live desktop WebGL telemetry in the
  in-app Chromium browser. Debug mirror evidence showed walking state, render
  pipeline availability, the physical `cargoTerminalStation`, save envelope 9,
  economy version 1, and all three market reports. A test click produced a
  browser-shell pointer-lock warning, and a fresh follow-up tab crashed in the
  browser host; no normal-control terminal transaction is claimed.
- T5–T6: the manual normal-control, reload, gamepad, and PCVR/WebXR checklist
  remains open. The project owner reports the other Phase 20 features appear
  functional and will perform the checklist, including the corrected Wayfarer
  navigation row. This is why Phase 20 is not marked complete.
- Post-smoke navigation fix: two deterministic allocation regressions prove all
  three positioned authored systems receive rows in the eight-entry navigation
  list and that allocation remains bounded. A post-fix in-app browser retry was
  unavailable because the browser host remained in its prior crashed state; no
  visual navigation signoff is claimed.
