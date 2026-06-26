# Phase 13 — Ship Log, Save Slots, And Simulation Clock

> **Status:** Complete. Automated verification, desktop browser smoke testing,
> and the owner-performed normal-control/device checklist are recorded below.
> **Historical note:** Phase 14 supersedes the version-2 envelope with version 3
> and migrates Phase 13 slots non-destructively. This document retains the
> Phase 13 contract as implemented at its signoff.

## Scope and decisions

Phase 13 establishes the durable local world-state boundary used by later RPG
phases and exposes it through a physical observation-bay ship computer.

- Three browser-local slots. The active slot is explicit.
- Autosave on every authoritative RPG write and on coalesced five-second active
  play-time checkpoints. Page hide, unload, focus/visibility changes, and slot
  switches also checkpoint.
- Import requires successful validation and an unchanged preview token. It
  always creates and activates a new slot; it never overwrites.
- No cloud or backend synchronization.
- The existing Phase 11 RPG state remains deterministic and keeps its version-1
  domain schema. The new world envelope is version 2.

## State contracts

Storage keys:

- `deep-space-vr:save-index:v2`
- `deep-space-vr:save-slot:v2:<slot-id>`
- legacy input only: `deep-space-vr:rpg-state:v1`

Envelope:

```text
version: 2
slot:       { id, name, createdAt, updatedAt }
autosave:   { kind, reason, savedAt, sequence }
player:     {}
ship:       {}
rpg:        Phase 11 deterministic RPG state v1
simulation: { gameTime }
settings:   {}
```

The empty player, ship, and settings objects are intentional contracts, not
promises of later fields. Phase 13 does not invent inventory, credits, fuel,
condition, schedules, economy, or NPC state.

Slot IDs match `slot-[a-z0-9-]+`. Unknown IDs and invalid transitions throw
descriptive errors. All timestamps, non-negative numbers, nested domains, RPG
state, and imports are validated and sanitized before use.

`gameTime` is seconds of active play. `GameClock` samples an injected monotonic
source. It discards hidden, unfocused, and paused gaps by resetting its baseline
at every active/inactive transition. Wall-clock time is metadata only.

## Migration

On first Phase 13 boot, a valid `deep-space-vr:rpg-state:v1` value becomes a new
version-2 envelope with autosave kind `migration` and reason `phase-11-v1`.
Mission status/outcome, reputation, contacts, conversation, events, and world
flags pass through the Phase 11 sanitizer unchanged. The legacy key is retained
as non-destructive recovery evidence.

The fixture `tests/fixtures/phase-11-v1-commonwealth.json` proves the
Commonwealth result of `A Clean Copy`, including both faction reputation values,
Vale's resolved node, two outcome events, and all route-packet flags.

## Event log query and retention

`RpgRuntime.queryEvents()` supports exact `type`, `missionId`, and `factionId`
filters, a bounded limit (maximum 500), and chronological or newest-first order.

At envelope sanitization, the log is capped at 500 entries. Mission
`resolved`, `failed`, and `consequence` entries are protected; ordinary entries
are compacted oldest-first while the newest ordinary history is retained. If
protected entries alone exceed 500, all protected entries remain. Phase 13 does
not summarize or synthesize new lore during compaction.

## Physical loop

Walk from the central spawn to the observation-bay ship computer at
`shipComputerStation` and press `C`, Triangle, or an XR select trigger.

1. Inspect the `A Clean Copy` status and event history.
2. Export the active slot to the terminal text area.
3. Close the terminal and change deterministic state through cockpit comms.
4. Reopen the terminal, paste/retain the prior export, validate and preview it.
5. Import. A new isolated slot is created and loaded with the prior state.
6. Close and reopen the page; the active imported slot and play time remain.

The terminal also supports new, load, delete, and active-slot reset. Reset does
not clear unrelated browser data.

## Acceptance criteria

- [x] Version-1 Phase 11 fixture migrates with mission, reputation, contact,
  event, and world-flag fidelity.
- [x] Three slots are isolated; unknown/full/only-slot delete paths are rejected.
- [x] Autosave metadata records kind, reason, timestamp, and sequence.
- [x] Export is sanitized; import requires preview and creates a new slot.
- [x] Corrupt, altered-after-preview, and future-version imports preserve the
  active slot.
- [x] Monotonic game time advances only during visible, focused, unpaused play.
- [x] Page close/reopen does not add catch-up time.
- [x] `A Clean Copy` and its chosen outcome are queryable in the ship log.
- [x] Storage write failure is visible while validated in-memory play continues.
- [x] Debug APIs inspect slots, envelope, clock, migration status, and event log.
- [x] Clean-checkout CI runs syntax checks and all RPG tests.
- [x] Existing flight/rendering and Phase 11 tests remain functional in browser.

## Debug API

```js
window.__deepSpaceDebug.saves.getStatus()
window.__deepSpaceDebug.saves.list()
window.__deepSpaceDebug.saves.getActive()
window.__deepSpaceDebug.saves.create('Test Flight')
window.__deepSpaceDebug.saves.load('slot-id')
window.__deepSpaceDebug.saves.export()
window.__deepSpaceDebug.saves.previewImport(json)
window.__deepSpaceDebug.saves.importPreviewed(json, token)
window.__deepSpaceDebug.saves.resetActive()
window.__deepSpaceDebug.saves.getGameTime()
window.__deepSpaceDebug.rpg.queryEvents({ missionId: 'port_meridian_route_packet' })
```

These hooks are diagnostic only. The complete proof loop is available through
normal ship-computer and comms controls.

## Verification record

Automated command:

```powershell
node --experimental-default-type=module --test tests/rpg/*.test.mjs
```

Recorded results on 2026-06-27:

- T0 static: all touched RPG/save/app/player/ship modules passed
  `node --check`; `git diff --check` passed.
- T1–T3 domain/persistence/integration: 15/15 tests passed, including the
  existing seven Phase 11 regressions.
- T4 browser: Chromium loaded and reloaded the real app at
  `http://127.0.0.1:5177/` with no console errors or warnings; renderer and
  walking state remained live; ship-anchor validation passed and included
  `shipComputerStation`; the active version-2 slot and game time survived
  reload.
- T5 manual: full normal-control checklist passed per project-owner signoff.
- T6 device: gamepad and XR interaction checklist passed per project-owner
  signoff.

Manual/browser checklist:

- [x] Walk to the observation-bay terminal and open/close with keyboard.
- [x] Inspect `A Clean Copy`, export, change state in comms, preview/import, and
  verify the earlier state is restored in a new slot.
- [x] Reload before and after import; verify active slot and state.
- [x] Hide/refocus and pause/resume; verify no game-time jump.
- [x] Create all three slots, switch among them, and verify isolation.
- [x] Reset active slot and verify other slots survive.
- [x] Force storage failure and verify visible error plus continuing renderer.
- [x] Gamepad Triangle opens/closes the physical interaction.
- [x] XR select opens the terminal; keyboard/gamepad close fallback works.

Manual signoff was reported by the project owner on 2026-06-27 after completing
the entire checklist. The supplied capture shows the physical `SHIP LOG / LOCAL
ARCHIVE` open in the running renderer with an active version-2 slot, autosave
metadata, play-time clock, `A Clean Copy` history view, and validated
export/import controls.

## Explicit exclusions and known limits

- No cloud/backend sync, merge, account identity, or cross-device conflict UI.
- No economy ticks, NPC schedules, catch-up simulation, or offline progression.
- No inventory, credits, fuel, ship condition, or Phase 14+ fields.
- No polished codex lore, final terminal art, file-picker/download integration,
  or clipboard permission flow. Export/import uses a validated text area.
- Browser storage is best-effort. A failed durable write continues in memory and
  reports the error; closing before storage recovers can lose that unsaved delta.
- Physical gamepad and headset checks require their devices and are not replaced
  by browser automation.
