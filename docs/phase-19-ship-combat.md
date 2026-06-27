# Phase 19 — Ship Combat Foundation

> **Status:** In implementation. Automated, browser, manual, and device evidence
> is recorded at the end of this document; unchecked criteria prevent signoff.
> **Dependencies:** Phase 18's versioned hull/system condition, repair inventory,
> bounded capability floors, atomic save writes, and critical stabilization.

## Scope and playable proof

Phase 19 adds one fair arcade encounter at Index Relay K-7 (`index_hq`).
`scavenger_red_knife`, a hostile Tier 2 raider, appears automatically on entry
but holds patrol. After 10 seconds of active play its comm warning opens; a
further 5-second grace period elapses before pursuit and attack are enabled.
The player can toggle combat mode anywhere without spawning, despawning,
pausing, or resolving an encounter. In combat mode they cycle/lock a valid
target, read range and lead, and fire the two fixed pulse hardpoints. They can
win and recover salvage or physically open distance until the raider
disengages. Hull/system damage persists and is repaired through the existing
Phase 18 maintenance terminal.

Defeat never deletes a save. At zero hull, rescue control tows the player to a
recoverable checkpoint, clears combat, restores hull and engine to 25, and
records the outcome. Simulation advances only while App active play advances.

## Stable IDs and saved state contract

- Encounter: `index_k7_red_knife_encounter`
- Enemy/agent: `scavenger_red_knife`
- Enemy faction: `drifters`
- Player hardpoints: `pulse_port`, `pulse_starboard`
- Weapon: `tier2_pulse_laser`
- Enemy weapon: `tier2_raider_pulse`
- Enemy salvage source: `scavenger_red_knife_wreck`

The envelope advances from version 7 to 8 and the RPG domain from version 5 to
6. `rpg.combat` contains version 1 encounter state, the persistent enemy
disposition (`available`, `destroyed`, or `escaped`), outcome checkpoints, and
bounded history. Transient positions, velocity, target lock, heat, cooldowns,
projectiles, visuals, and audio are reconstructed or cleared on load.

The v7/RPG-v5 migration initializes a clean combat record without changing
ship, mission, patrol, surface, crew, cargo, credits, condition, or event data.
Unknown IDs/states, malformed history, and invalid/non-finite times reject with
descriptive errors.

## Deterministic contracts

Combat uses a 60 Hz fixed step with a bounded accumulator. Each hardpoint has a
0.22 second cooldown, adds 0.22 heat, cools at 0.30/second, and cannot fire at
heat 1.0 or while weapons condition is zero. Ammunition is not saved or used.

A target must be hostile, alive, locked, inside 650 units, and within the
forward lock cone. Lead is the analytic constant-velocity intercept for the
documented projectile speed, with a direct-aim fallback when no finite positive
solution exists. Projectiles have stable sequence IDs, a finite lifetime, and
one hit at most. A combat lock is also installed as the live navigation-computer
target, so the existing desktop compass and diegetic navigation display track
the moving enemy. Clearing the combat lock clears that navigation target;
hyperdrive autopilot will not engage against combat targets.

Every hit carries `{sourceId, targetId, weaponId, projectileId, damage,
systemId}`. Damage is computed from immutable weapon data and a seeded
projectile-ID hash. Hull always loses the weapon's hull damage; the selected
system loses the weapon's system damage. Values clamp to `[0,100]`. The same
function handles player and enemy hits. Friendly and neutral targets cannot be
locked or damaged.

The enemy state machine is
`patrol → comm warning → 5s grace → pursue → attack → retreat → destroyed`.
The warning begins after exactly 10 seconds of active fixed-step time. The
enemy cannot pursue or fire before the additional five seconds complete. It
then pursues inside detection range, attacks only inside its weapon envelope,
retreats at low hull, and is destroyed at zero hull. Its slower pulse deals
4 hull / 6 system damage on a 1.5-second cooldown; player pulses deal 8 / 12.
The encounter escapes only after sustained physical separation beyond the
disengage distance. Toggling combat mode off merely safes player weapons and
clears their lock. All transitions are fixed-step deterministic.

## Public integration hooks

The combat runtime exposes immutable state/events plus:

- `setOutcomeHooks({ mission, reputation, crew, salvage })`
- `queryCombatEvents(...)`
- `claimWreckSalvage()`

Hooks receive deterministic records after the authoritative transaction. They
cannot choose hit, damage, state transitions, defeat, rewards, or persistence.
Hook failure is recorded and does not break flight or roll back combat.

## Acceptance criteria

- [ ] Two named hardpoints, cooldown/heat, feedback, lock/range/lead, projectile,
  and hit contracts are implemented and debug-visible.
- [ ] One Tier 2 enemy patrols, pursues, attacks, retreats, and is destroyed.
- [ ] Normal desktop controls can win and flee.
- [ ] Defeat performs recoverable tow/rescue and never deletes a save.
- [ ] Player/enemy damage integrates with Phase 18 repair.
- [ ] Destroyed enemy and claimed salvage remain exact-once through reload.
- [ ] Friendly/neutral entities cannot be locked or damaged.
- [ ] Escape/defeat/destroy clears targets, projectiles, agents, and combat audio.
- [ ] Mission, reputation, crew reaction, and salvage hooks are public and safe.
- [ ] Fixed-step, migration, corruption, failure, persistence, and integration
  tests pass with the existing regression suite.
- [ ] Desktop browser smoke and normal-control checkpoint reloads pass.
- [ ] Gamepad and PCVR normal-control passes are signed off.
- [ ] Performance scene stays within the budget below.

## Explicit exclusions

Fleets, capital ships, boarding, surface combat, Tier 3 weapons, ammunition,
missiles, shields, broad equipment/loadout progression, crew injury, dynamic
spawns, general loot tables, insurance/economy, and Phase 17 patrol hostility.

## Controls and manual checklist

- Desktop: `B` toggles combat mode; `Tab` cycles/locks a hostile;
  primary mouse fires while piloting.
- Gamepad: D-pad Down toggles combat mode; Triangle cycles/locks; Cross fires.
- PCVR: left grip toggles combat mode; left trigger cycles/locks; right-hand
  select fires while piloting.

- [ ] Clean slot: enter K-7, observe Red Knife patrol for 10 active seconds,
  receive its comm warning, and verify no pursuit/fire during the 5-second grace.
- [ ] Toggle combat mode with `B` / D-pad Down, lock Red Knife with
  `Tab` / Triangle, verify Red Knife on the navigation compass, fire with
  mouse / Cross, and inspect range/lead.
- [ ] Toggle combat mode off; verify only player weapons and lock are safed while
  the enemy, projectiles, encounter phase, and outcome remain live.
- [ ] Fire to overheat; verify cooldown, alternating hardpoints, and feedback.
- [ ] Win; verify destroyed state, cleanup, event, salvage, reload, and no respawn.
- [ ] New/reset slot: flee beyond disengage range; verify cleanup and reload.
- [ ] New/reset slot: accept enemy fire to zero hull; verify tow, condition 25,
  cleanup, persistence, and Phase 18 repair.
- [ ] Reload during patrol, pursuit, attack, retreat, destroyed, and after salvage.
- [ ] Attempt lock/fire against friendly patrol and neutral debug target.
- [ ] Leave K-7 and change scale during combat; verify complete cleanup.
- [ ] Disable/fail optional audio, combat presentation, hooks, and persistence;
  verify flight/rendering remain usable and failures are descriptive.
- [ ] Repeat win/flee/defeat with gamepad.
- [ ] Repeat lock/fire/flee with PCVR controllers and comfort settings.
- [ ] Reset active slot; verify enemy available without changing another slot.

## Performance scene and budget

Scene: K-7 encounter active at 300 units, one enemy agent, player and enemy
firing continuously until the projectile cap, target/lead markers visible,
desktop post-FX default and then PCVR default. Run 120 seconds after warm-up.

- Combat fixed-step CPU: average ≤ 1.0 ms/frame, p95 ≤ 2.0 ms.
- Combat render adapter: ≤ 32 live projectile meshes and one agent mesh.
- No unbounded growth in projectiles, targets, audio voices, agents, or events.
- Desktop target: 60 fps / p95 frame time ≤ 20 ms.
- PCVR target: headset refresh with p95 application frame time within its
  compositor budget; record headset/runtime/refresh and reprojection.

## Verification record

Pending implementation and evidence. Device absence is reported as an open
signoff item, never converted into a pass through synthetic input alone.
