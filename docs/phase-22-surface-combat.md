# Phase 22 — Hostile Surface Site

> **Status:** Implementation and T0–T3 automated verification complete.
> Browser, normal-control, gamepad, and PCVR/WebXR testing is owner-performed
> and remains open, so the phase is partial.
> **Dependencies:** Phase 16 deterministic surface placement and Phase 18
> recovery are implemented. Phase 19's fixed-step, hit-event, cleanup, and
> exact-once conventions are reused without coupling first-person combat to the
> ship-combat runtime.

## Scope and playable loop

Phase 22 adds `K-7 Black Cache`, a second authored surface POI on
`index_hq_planet_1`. The peaceful Phase 16 Cartography Annex is unchanged.

1. Select `K-7 Black Cache [HOSTILE SURFACE]` in K-7.
2. Land inside its marked safe area and disembark normally.
3. Advance through the two solid cover barriers.
4. Evade the sentry and recover the core, or destroy it with the pulse carbine.
5. Return to the ship. Boarding resolves the chosen route and pays 600 credits
   exactly once.
6. If suit integrity reaches zero, a comfort fade returns the player aboard,
   restores the suit, resets the sentry, and leaves the mission retryable.

Debug APIs inspect or invoke the same runtime; none are required by normal play.

## Stable IDs and contracts

- Site: `index_k7_black_cache`
- Encounter: `index_k7_black_cache_encounter`
- Mission: `index_k7_black_cache_recovery` / `Silence in the Dust`
- Objective: `index_k7_stolen_survey_core`
- Enemy: `k7_scavenger_sentry_drone`
- Weapon: `surface_pulse_carbine`
- Routes: `evaded`, `combat_resolved`
- Retryable attempt outcome: `defeat`

The site is fixed at latitude `17.006`, longitude `-34.008` on the existing
K-7 terrestrial world. Planet queries now return an ordered list of authored
surface POIs while the old singular query still returns the Phase 16 annex.

The terrain sampler used for rendering and walking projects the landing point,
objective, ordered enemy candidates, and patrol points. Spawn selection rejects
terrain, cover, player, and ship intersections. The two authored cover AABBs
also drive player collision and segment LOS; terrain LOS uses samples from the
same height field.

Combat runs at a bounded 60 Hz fixed step:

- carbine range 70 m, cooldown 0.25 s, 0.20 heat/shot, 0.35 heat cooling/s;
- carbine damage 25, so four clear hits destroy the 100-integrity sentry;
- sentry detection 55 m, attack range 45 m, cooldown 1 s, damage 10;
- sentry phases: patrol, pursue, attack, search, destroyed;
- at most 16 transient shot effects and 24 feedback records.

The supplied `assets/desert_eagle_gun.glb` is loaded once and normalized as the
weapon presentation. It contains approximately 459,696 triangles / 243,025
vertices and is hidden outside the encounter with shadows disabled. A visible
primitive fallback contains model-loading failure without changing authority.

## Saved state and migration

The envelope advances from version 10 to 11 and RPG state from version 8 to 9.
The real migration initializes `rpg.surfaceCombat` without changing Phase
11–21 state.

The version-1 surface-combat record persists:

- checkpoint: `undiscovered`, `approach`, `active`,
  `objective_recovered`, or `completed`;
- stable encounter/site/mission/enemy/objective IDs;
- enemy disposition and bounded integrity;
- bounded suit integrity;
- objective recovered flag and active-play time;
- 600-credit exact-once claim flag and active-play time;
- chosen route, last attempt outcome, and bounded attempt history.

Positions, patrol interpolation, cooldown, heat, aim rays, and shot effects are
transient. Reload reconstructs them from saved progress and deterministic site
placement. Unknown IDs, invalid states, inconsistent flags/times, and non-finite
values fail descriptively.

Defeat adds a `defeat` attempt, restores the encounter to `approach`, and keeps
the mission accepted. Objective recovery records `evaded` when the sentry lives
or `combat_resolved` when it is destroyed. Boarding atomically updates mission,
world flags, credits, reward claim, events, and save state.

## Controls, comfort, and debug

- Desktop: `B` arms/safes the carbine while on foot; mouse/camera aim; primary
  mouse fires; `C` recovers the core.
- Gamepad: right-stick camera aim; D-pad Down toggles combat mode while aboard
  or in EVA; R2 fires the surface carbine; Triangle recovers the core.
- WebXR: right-controller ray/select fires; left select interacts.
- Arming in normal ship-interior walking or EVA equips the carbine and permits
  transient dry fire, but only the authored hostile-site encounter exposes a
  damage target or mutates mission/NPC state.
- Existing surface locomotion and snap/smooth turning remain authoritative.
- Damage uses HUD feedback and optional haptics without forced camera rotation
  or shake. Defeat uses the existing short black transfer veil.

```js
window.__deepSpaceDebug.surfaceCombat.getState()
window.__deepSpaceDebug.surfaceCombat.getPlacement()
window.__deepSpaceDebug.surfaceCombat.getPerformance()
window.__deepSpaceDebug.surfaceCombat.scan()
window.__deepSpaceDebug.surfaceCombat.sync()
window.__deepSpaceDebug.surfaceCombat.fire()
window.__deepSpaceDebug.surfaceCombat.recoverObjective()
window.__deepSpaceDebug.surfaceCombat.recordBoarded()
window.__deepSpaceDebug.surfaceCombat.recoverFromDefeat()
window.__deepSpaceDebug.surfaceCombat.queryEvents({})
window.__deepSpaceDebug.surfaceCombat.getPresentationState()
```

## Acceptance criteria

- [x] One weapon, one enemy, cover/LOS, aiming, damage, defeat, recovery, and
  safe return exist as one deterministic loop.
- [x] Ordered spawn candidates reject terrain, structures, player, and ship.
- [x] Evasion, combat resolution, and retryable defeat are distinct saved
  outcomes.
- [x] Objective and equal 600-credit route reward cannot duplicate.
- [x] Leaving/reloading reconstructs one encounter without persistent transient
  projectiles or agents.
- [x] Version-10/RPG-v8 state migrates to validated version 11/RPG version 9.
- [x] Optional runtime/model/presentation failure does not own flight or walking.
- [x] T0–T3 and the 120-second deterministic CPU/bounds scene pass.
- [ ] Owner desktop browser normal-control and checkpoint checklist passes.
- [ ] Owner gamepad checklist passes.
- [ ] Owner PCVR/WebXR comfort, aiming, interaction, and performance passes.

## Owner-performed browser, reload, and device checklist

- [ ] Clean slot: lock the `[HOSTILE SURFACE]` signal and confirm the peaceful
  Annex remains separately selectable and unchanged.
- [ ] Follow the marker through orbit/descent; verify site, cover, pad, console,
  enemy, and ship are terrain-aligned and non-intersecting.
- [ ] Reload at `approach` and `active`; confirm one enemy and one objective.
- [ ] Walk into both barriers from several angles and confirm solid collision.
- [ ] Break and restore LOS behind each barrier and behind terrain.
- [ ] Desktop: aim with the camera, fire with primary mouse, test cooldown,
  overheat, hit feedback, four-hit victory, and missed/blocked shots.
- [ ] Evade with the enemy alive, recover with `C`, return, receive 600 credits,
  reload, and confirm no duplicate objective, enemy, event, or reward.
- [ ] Reset/new slot, destroy the enemy, recover, return, receive the same 600
  credits, reload, and confirm `combat_resolved`.
- [ ] Reset/new slot, accept ten enemy hits, confirm fade/return, full suit,
  available sentry, accepted mission, no credits, and successful retry.
- [ ] Leave/re-enter the planet and K-7 before and after objective recovery;
  confirm stable geography and no duplicate encounter.
- [ ] Reset the active slot and confirm other slots/browser data remain intact.
- [ ] Gamepad: repeat movement, camera aim, R2 fire, Triangle interaction,
  defeat recovery, and return.
- [ ] PCVR: verify right-hand ray/select fire, left-select interaction, sticks,
  snap and smooth turn, haptics, HUD legibility, defeat fade, and no forced turn.
- [ ] Disable or fail the model/presentation path and confirm the visible
  fallback plus functional flight, landing, walking, mission, and recovery.
- [ ] Recheck flight, scale transitions, landing, ordinary surface walking,
  Annex interaction, ship combat, EVA boarding, cargo, economy, patrol, repair,
  comms, ship log, audio, save/reload, and reset.

## Performance scene

Run for 120 seconds after warm-up with one sentry active, cover LOS queries,
weapon model visible, and repeated firing up to the effect cap.

- Runtime CPU target: average ≤ 1.0 ms/frame, p95 ≤ 2.0 ms.
- One enemy mesh and at most 16 shot-effect lines.
- No unbounded growth in agents, effects, feedback, events, or model instances.
- Desktop target: 60 fps and p95 frame time ≤ 20 ms.
- PCVR target: headset refresh within compositor budget; record headset,
  runtime, refresh rate, application frame time, and reprojection.

## Verification record

Recorded on 2026-06-28:

- Dedicated Phase 22 suite: 16/16 passing.
- Full RPG regression suite: 100/100 passing.
- T0 syntax: all 130 `src`/`tests` JavaScript modules passed `node --check`.
- The 120-second deterministic scene met average/p95 runtime CPU assertions and
  retained one enemy with bounded effects.
- Expected warning output came only from deliberate storage-failure tests.
- Per owner instruction, no browser, normal-control, gamepad, or XR result is
  claimed.

## Explicit exclusions and known limits

No weapon roster, ammunition, loadouts, squads, procedural bases, boarding
combat, hostile ship-runtime reuse, dynamic faction agenda, final balance,
final enemy animation/art, general loot, or persistent player-character stats.

The Desert Eagle source model is unusually expensive for a held placeholder.
Its live desktop/PCVR suitability is an explicit owner performance gate. Suit
integrity is encounter-local; Phase 22 does not add injury or character
progression. The single sentry uses authored patrol points rather than general
surface navigation.
