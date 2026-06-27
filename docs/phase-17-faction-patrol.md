# Phase 17 — Faction Territory And Patrol

> **Status:** Implementation complete. Automated coverage and the
> owner-performed core browser loop pass; the extended manual policy/device
> checklist remains open, so the phase is not yet marked fully complete.
> **Dependency:** Phase 14 cargo legality tags, faction reputation, authored
> travel, save slots, and persistent ship/RPG state.

## Scope and playable proof

Phase 17 adds one deterministic Commonwealth patrol encounter at Port Meridian
(`entry_hub`). On entering the authored system, one placeholder patrol craft
approaches, hails, waits for a response, applies a deterministic reputation and
cargo policy, then departs without combat.

The normal-control loop is:

1. Enter Port Meridian.
2. Observe `Meridian Watch One` spawn and approach the ship.
3. Answer its hail.
4. Receive a welcome, submit a manifest inspection, or receive a
   warning/refusal according to the reputation and cargo snapshot taken when
   the encounter spawned.
5. Close the hail and watch the patrol leave safely.

Ignoring an unanswered hail records `ignored_hail` and starts a safe departure.
Hiding the overlay or leaving the pilot seat does not resolve the encounter;
the same channel can be resumed at the physical cockpit comms station. A
hostile transponder receives `safe_hostility`: passage is refused, but Phase 17
never attacks, damages, immobilizes, or forces combat.

## Stable IDs and deterministic contracts

- Territory policy: `commonwealth_port_meridian`
- Patrol agent: `commonwealth_meridian_watch_1`
- System: `entry_hub`
- Faction: `commonwealth`
- Encounter ID: a stable hash of world seed, policy, system, visit sequence,
  authoritative RPG/ship snapshot, and spawn `gameTime`
- Outcomes: `welcome`, `inspection_clear`, `warning_refusal`,
  `ignored_hail`, `safe_hostility`, and `aborted`

`queryFactionInfluence({ systemId, rpgState })` validates the system and faction
IDs and returns a sorted influence result. In this slice, only Port Meridian has
an enabled patrol policy; the Index and unclaimed systems remain queryable but
do not spawn agents.

The encounter state machine is:

```text
spawn -> approach -> hail -> wait -> depart
                              \-> abort
```

Transitions use injected active-play `gameTime`; wall-clock time and time while
the browser is closed do not advance the encounter. The encounter snapshots its
reputation band, reputation value, cargo fingerprint, scan result, and policy
at spawn. Identical seed, state, system, visit sequence, and game time therefore
produce the same encounter.

The hail wait is 60 seconds of active play. The placeholder craft flies in
world space with an eased intercept, loose station-keeping lag, and a captured
departure vector; it is not rigidly attached to the player ship.

## Reputation and cargo policy

Commonwealth bands use hysteresis when a prior band is available:

- `positive`: enter at `>= 0.35`, remain until `< 0.30`
- `neutral`: the middle band
- `negative`: enter at `<= -0.25`, remain until `> -0.20`
- `hostile`: enter at `<= -0.60`, remain until `> -0.55`

The band is immutable for an active encounter, which prevents threshold
flapping after a hail begins. Positive legal manifests are welcomed. Neutral
ships and manifests tagged `index_sealed` or `mission_cargo` require an
inspection. Cargo tagged `commonwealth_contraband` is refused after inspection.
Negative ships receive a warning/refusal. Hostile ships receive safe hostility.
No cargo is confiscated or mutated.

The placeholder `unregistered_signal_scrambler` exists only to exercise policy,
validation, debug setup, and future content integration. Phase 17 adds no market
or normal-play acquisition system for it.

## Saved-state contract and migration

The save envelope advances from version 5 to version 6 and RPG state from
version 4 to version 5. The real version-5 migration adds:

```text
rpg.patrol: {
  version,
  presenceSystemId,
  nextSequence,
  activeEncounter,
  history
}
```

Encounter IDs, agent/policy/faction/system IDs, phases, outcomes, reputation
snapshots, cargo scans, fingerprints, game-time timestamps, and history entries
are validated and sanitized. History is bounded. Autosaves occur at spawn,
state transitions, response/scan resolution, departure completion, abort, and
system exit. Reset recreates a clean patrol domain without touching other slots.

Reload restores one active encounter and recreates one visual agent. A
same-system scale transition reuses that encounter. Leaving all levels belonging
to Port Meridian aborts and despawns it. A completed encounter cannot respawn
until the player leaves the authored system and later re-enters.

Patrol observes the settled scale stack from the normal frame loop. The
active-level callback never invokes patrol code during the reparent/rescale
swap, so optional patrol failure cannot block descent or ascent. Authored
systems without a patrol policy, including Index Relay K-7, perform no patrol
state or save write. A reload that starts at root scale preserves an active
encounter rather than treating the non-persisted spatial transform as a
player-authored territory exit.

Navigation locks own the scale depth in which their coordinates were created.
Floating-origin rebases move a lock only in that frame, and authored locks remap
by stable system ID on scale changes. This prevents a child-system rebase from
leaving a stale `48 m` HUD lock while the real Port/Index anchor is hundreds of
kilometres away in the parent frame.

## Acceptance criteria

- [x] Faction influence is a deterministic validated location/state query.
- [x] One patrol supports spawn, approach, hail, wait, depart, and abort.
- [x] Identical seed/state/location/time produces the same encounter.
- [x] Reputation thresholds use hysteresis and cannot flap during an encounter.
- [x] Cargo legality scan and Commonwealth policy evaluation are deterministic.
- [x] Welcome, inspection clear, warning/refusal, ignored-hail, and
  safe-hostility paths work without combat.
- [x] Reload and same-system scale transitions never duplicate the agent.
- [x] Leaving territory aborts, despawns, and allows a later re-entry encounter.
- [x] The hail UI can always close and never blocks flight controls after exit.
- [x] Patrol state validates, migrates from v5/RPG v4, round-trips, resets, and
  appears in debug inspection.
- [x] Existing automated flight-boundary, cargo, crew, outpost, save, and RPG
  tests pass.
- [x] Owner browser smoke proves spawn, response, clickable controls, clean UI
  exit, seat/comms resume, safe departure, and Port/Index scale recovery;
  automated tests cover reload and reset.

## Explicit exclusions

No weapons, damage, projectiles, targeting, pursuit combat, fleets, formations,
boarding, confiscation, arrest, fines, docking, dynamic faction agendas,
relationship simulation, economy changes, market acquisition, final ship art,
voice/LLM authority, or offline simulation is added.

## Manual checklist

- [x] Clean slot: enter Port Meridian and observe exactly one patrol.
- [x] Answer a positive/legal hail and verify welcome plus safe departure.
- [ ] Exercise neutral inspection and restricted/contraband refusal paths.
- [ ] Exercise negative warning/refusal and hostile safe-hostility paths.
- [ ] Explicitly ignore an unanswered hail and verify clean UI exit/departure;
  separately hide the channel and verify the encounter remains pending.
- [x] Leave the pilot seat during a hail, walk to cockpit comms, and resume the
  same encounter without a duplicate or ignored-hail outcome.
- [ ] Reload during approach, wait, and depart; verify one coherent agent.
- [x] Descend/ascend within Port Meridian; verify no duplicate.
- [ ] Leave the authored system mid-encounter; verify abort and despawn.
- [x] Re-enter after leaving; verify one new deterministic visit encounter.
- [ ] Reset the active slot; verify patrol state resets and other slots survive.
- [x] Confirm ordinary flight, walking, landing, hyperdrive, cargo, comms,
  navigation, ship log, crew, outpost, audio, and prior missions still work.

## Debug API

```js
window.__deepSpaceDebug.patrol.getState()
window.__deepSpaceDebug.patrol.getInfluence('entry_hub')
window.__deepSpaceDebug.patrol.syncSystem('entry_hub')
window.__deepSpaceDebug.patrol.update()
window.__deepSpaceDebug.patrol.acknowledge()
window.__deepSpaceDebug.patrol.submitScan()
window.__deepSpaceDebug.patrol.ignore()
window.__deepSpaceDebug.patrol.abort()
window.__deepSpaceDebug.patrol.restartVisit('entry_hub')
window.__deepSpaceDebug.patrol.openHail()
window.__deepSpaceDebug.patrol.closeHail()
```

These hooks call the same authoritative runtime used by normal play.

## Verification record

Recorded on 2026-06-27.

```powershell
node --experimental-default-type=module --test tests/rpg/*.test.mjs
node --experimental-default-type=module --check <each touched .js/.mjs file>
git diff --check
```

- T0 static: touched modules pass `node --check`; `git diff --check` passes.
- T1–T3 domain/persistence/integration: 46/46 RPG tests pass. The twelve
  Phase 17 tests cover deterministic influence/identity, all six phases, active
  play time, hysteresis and immutable snapshots, every policy outcome, cargo
  scans without mutation, wait/scan/depart reload checkpoints, reset,
  reload/scale deduplication, abort/re-entry, zero-write Index observation,
  navigation-frame ownership, v5/RPG-v4 migration, round trip, and corrupt-state
  rejection.
- T4 browser: the build reaches live WebGL telemetry without console errors or
  warnings. Owner testing exposed and verified fixes for wrapper quaternion
  ownership, short hail timing, rigid attachment, off-axis spawn, per-frame hail
  DOM replacement, seat/comms resumption, and stale authored navigation locks
  across child-frame rebases.
- Regression audit: earlier patrol-isolation changes remain because they reduce
  coupling but were not the authored-descent root cause. Patrol observes only a
  settled scale stack; Index causes no patrol write; optional sync errors are
  contained; active reload state is preserved; and gamepad/XR hide actions
  interact with the pilot seat only while actually piloting. The confirmed
  descent defect was stale navigation-target frame ownership.
- T5 manual: the owner confirmed the forward patrol, clickable hail, physical
  comms resume, safe departure, and Port Meridian/Index Relay exit/re-entry
  behavior after the final fixes. The unchecked extended policy/reset items
  above remain open.
- T6 device: no physical interaction contract changed. Gamepad/XR compatibility
  remains part of the pending manual regression pass; dedicated headset signoff
  is not required for this DOM hail slice.

## Known limits

- There is one Commonwealth patrol policy in one authored system.
- The patrol craft and hail presentation use placeholder primitives and text.
- Phase 20 now permits normal-play purchase of one contraband good and adds an
  appraised value to the immutable scan snapshot; Phase 17 policy still only
  refuses passage and never confiscates cargo or credits.
- Patrol movement is local presentation around the player ship; it has no
  collision, weapons, damage, or autonomous strategic agenda.
- The hail is a desktop DOM presentation. A diegetic in-headset hail surface
  and explicit gamepad focus navigation remain part of the open device checklist.
