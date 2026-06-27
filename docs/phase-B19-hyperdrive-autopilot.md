# Phase B19 — Hyperdrive Autopilot

**Status:** Design Approved — ready for implementation.
**Companion docs:** `phase-08-ship-speed-and-hyperdrive.md`, `universe-scale-architecture.md`

---

## 1. Problem statement

The hyperdrive system (Phase 08) gives the player unbounded inertial speed, but crossing a star system or galaxy in a straight line still requires the player to:

1. Sit at the controls the entire journey.
2. Manually decelerate precisely enough to not overshoot the target.
3. Align the ship before the descent speed gate can trigger.

The autopilot feature removes all three friction points by letting the player engage hyperdrive, lock a nav target, and either **leave the seat** or **engage autopilot while seated** — the ship handles the rest, maintaining the target speed, slowing down near the target to guarantee arrival, and presenting the descent transition automatically.

---

## 2. Feature scope

### What it IS

- An **automated flight-to-descent** loop for **hyperdrive only**.
- Active exclusively on **Universe scale** (tier 0) and **Galaxy scale** (tier 1) — the two tiers where hyperdrive travel is the intended locomotion mode.
- When autopilot is active it **steers, maintains speed, and brakes** toward the locked target, then hands off to the normal `ScaleStack` descent transition.
- Supports both seated engagement (via controls) and unpiloted engagement (by leaving the seat while hyperdrive is spooled and target is locked).

### What it is NOT

- It does not override manual control unless autopilot is explicitly engaged.
- It does not operate inside a **System scale** level (tier 2) or deeper — those are for precision flight and the existing gravity + manual controls are the intended UX there.
- It is not a combat autopilot, obstacle avoidance system, or general pathfinding agent.
- It does not replace the existing `ScaleStack` descent machinery — it just feeds it the right ship state at the right moment.

---

## 3. Existing systems and how they relate

| System | Relevant behaviour |
|---|---|
| `ShipControls.pilotActive` | When `false` (unpiloted), controls emit zero thrust but keep hyperdrive intent. Autopilot can run in this mode. When `true` (seated), autopilot can also run if explicitly toggled. |
| `Ship.update(dt, command, ...)` | Accepts any `command` object — autopilot can inject its own command without touching `ShipControls`. |
| `ShipPhysics.integrate()` | Pure function of the command; angular authority is already halved at full hyperdrive spool (`hyperAngularScale = 0.5`). |
| `ScaleStack.update({ hyperdriveLevel })` | Descent gate fires when `hyperdriveLevel < DESCENT.speedGateLevel (0.2)`. Autopilot must **disengage hyperdrive** before arrival so this gate opens. |
| `ScaleStack._containedDescents()` | Finds all entry shells the ship is inside. Autopilot targeting must ensure only the locked target triggers descent — addressed by the **target-exclusive descent** rule (§4.1). |
| `this.selectedNavigationTarget` (App) | The locked POI object with a live `.position` (kept in sync through floating-origin rebases via `_maybeRebaseOrigin`). Position is always valid and current. |
| `this.selectedNavigationTargetDepth` | The stack depth at which the target was locked — already used to validate rebase applicability. |

---

## 4. Technical Design

### 4.1 Target-exclusive descent gate (universe & galaxy scale only)

> **Rule:** When a navigation target is locked (`selectedNavigationTarget !== null`) and the ship is on **universe** (tier 0) or **galaxy** (tier 1) scale, the `ScaleStack` descent check is restricted to that target only. Any other object whose entry shell the ship enters is silently ignored.

**Implementation hook:** `ScaleStack._nearestUnblocked()` already filters the candidate list; we extend the filter logic so when a `lockedTargetId` is present in the context (tier 0 or tier 1 only), all candidates where `candidate.id !== lockedTargetId` are rejected.

This rule applies when:
- `scaleStack.depth === 0` → galaxies and field-star systems are candidates; only the locked one descends.
- `scaleStack.depth === 1` → star systems inside a galaxy are candidates; only the locked one descends.

**It does NOT apply at tier 2 (system) or deeper** — inside a system the player selects a planet through close-range precision flight, not through the long-range nav computer lock.

---

### 4.2 Autopilot engage condition

Autopilot engages when **either** of the following state changes occur:

1. **Unpiloted Engagement:** The player leaves the pilot seat (`shipControls.pilotActive` becomes `false`) **while** `shipControls.hyperdriveEngaged === true`, a target is locked (`selectedNavigationTarget !== null`), and `scaleStack.depth <= 1`.
2. **Seated Engagement:** The player explicitly toggles autopilot while seated in the pilot seat (`shipControls.pilotActive === true`) via gamepad **L3** (left-stick click) or keyboard **KeyU**.

**General Prerequisites (must all be true to stay engaged):**
- `selectedNavigationTarget !== null` (target is locked)
- `scaleStack.depth <= 1` (on Universe or Galaxy scale)
- `!scaleStack.isTransitioning` (no scale transition is already running)

**Manual Handback Rule:** If the player re-seats (starts piloting via interaction) or explicitly toggles autopilot off, **control is handed back immediately** with no warning or transition delay. Autopilot disengages and the ship coasts on manual input/inertia.

---

### 4.3 Autopilot state machine

```
IDLE
  │ (engage conditions met)
  ▼
CRUISE ─── manual handback (seated/unseated) ───► IDLE (manual/coast)
  │
  │ (within deceleration radius)
  ▼
DECELERATE ── manual handback ──────────────────► IDLE (manual/coast)
  │
  │ (speed < arrival threshold AND near target center)
  ▼
HANDOFF ──► clears lock, disengages hyperdrive ──► ScaleStack descent ──► IDLE
```

**CRUISE phase:**
- **Target Speed Capture:** The ship's current speed at the exact moment autopilot engages is captured as `targetSpeed`.
- **Bearing Alignment:** Computes world-space bearing to `selectedNavigationTarget.position`. Injects `pitch` and `yaw` proportional corrections: `cmd.yaw = Kp * yawError`, `cmd.pitch = Kp * pitchError` (Kp ≈ 0.8, clamped to `[-1, 1]`).
- **Speed Maintenance:** Rather than accelerating continuously, autopilot modulates thrust. It applies forward thrust (`thrust: 1`) only when current speed is less than `targetSpeed`. If speed matches or exceeds `targetSpeed`, it zeroes thrust (`thrust: 0`).
- **Thrust Pause:** If angular alignment error exceeds `AUTOPILOT_MAX_ERROR_BEFORE_PAUSE_THRUST` (e.g. > 15°), forward thrust is paused until the ship is realigned to prevent drifting off-course.

**DECELERATE phase (Combined Ramp):**
- Enters when `distanceToTarget <= d_brake + AUTOPILOT_BRAKE_BUFFER`.
- Dynamic brake distance `d_brake` is calculated each frame using a two-stage combined braking model:
  - **Stage 1 (Gentle):** Uses dampeners (rate 1.4/s) for the initial deceleration phase.
  - **Stage 2 (Hard):** Applies the airbrake (rate 5.0/s) as the ship gets closer to the target to bring it to a near halt.
- Sets `shipControls.hyperdriveEngaged = false` immediately on entry to decelerate, spooling down the hyperdrive level so the scale stack speed gate can open.
- Keeps correcting bearing to keep the ship pointed directly at target during deceleration.

**HANDOFF phase:**
- When the ship is slow enough (speed < 50 m/s) **AND** has arrived near the exact target location (distance < candidate.entryRadius * 0.1):
  1. Force `shipControls.hyperdriveEngaged = false`.
  2. Clear target lock: `selectedNavigationTarget = null` and `selectedNavigationTargetDepth = null`.
  3. Return state machine to `IDLE`.
- The `ScaleStack` handles the subsequent scale descent transition.

---

### 4.4 Autopilot command injection

In `App._tick()`:

```js
const command = autopilot.isActive()
    ? autopilot.buildCommand(ship, selectedNavigationTarget, dt)
    : shipControls.getCommand(input.keys, controlInput);
```

`autopilot.buildCommand()` returns:

```js
{
    active: true, // enables thrust + damping paths in ShipPhysics.integrate()
    hyperdrive: <spool level>,
    thrust: 0 | 1,
    dampeners: false | true,
    airbrake: false | true,
    pitch: <pitch correction>,
    yaw: <yaw correction>,
    roll: 0,
    strafe: 0,
    lift: 0,
    boost: false
}
```

---

### 4.5 HUD feedback

**`DiegeticStatusPanel`** drive line states:

```
DRIVE AUTOPILOT ◈ 84%      ← CRUISE phase (alignment percentage)
DRIVE AUTOPILOT ▼ BRAKE    ← DECELERATE phase
DRIVE AUTOPILOT ✓ ARRIVE   ← HANDOFF phase
```

**`UniverseNavigation`** alignment label:

```
AUTOPILOT ACTIVE — STAND BY
```

Cockpit audio/visual indicators: **No visual/audio changes for now.** A dedicated audio feedback line will be added in a future phase.

---

## 5. Design Decisions Summary (from Q&A)

1. **Seated Engagement:** Allowed and mapped to **L3** (left-stick click) on gamepads and keyboard **KeyU**.
2. **Speed Profile:** Maintain the speed at engagement (do not continue accelerating).
3. **Deceleration:** Combined ramp using gentle dampeners followed by hard airbrakes close to target.
4. **Descent Target Stop:** Autopilot slows the ship to a near halt at the exact location of the target before handing off.
5. **Aesthetics:** No temporary visual/audio additions; dedicated audio lines deferred to a later phase.
6. **Tier Restriction:** Restricted to Universe (tier 0) and Galaxy (tier 1) scales. System scale (tier 2) remains fully manual.
7. **Control Handback:** Immediate manual handback upon seating or disabling.

---

## 6. Implementation Plan

### 1. Create `src/ship/HyperdriveAutopilot.js`
- Implement class `HyperdriveAutopilot` with a simple state machine: `IDLE`, `CRUISE`, `DECELERATE`, `HANDOFF`.
- Track `targetSpeed` captured upon entering `CRUISE`.
- Proportional steering calculation.
- Speed maintenance logic.
- Dual-stage deceleration distance formula.

### 2. Update `src/ship/ShipControls.js`
- Define toggle key `autopilot: 'KeyU'` in `TOGGLE_KEYS`.
- Add L3/gamepad mapping for toggling autopilot.
- Add `autopilotActive` boolean to control state.

### 3. Update `src/app/App.js`
- Instantiate autopilot class.
- Update `_tick()` to inject autopilot commands.
- Pass `lockedTargetId` to `ScaleStack.update()`.
- Implement immediate handback when `pilotActive` or manual inputs override.

### 4. Update `src/space/scale/ScaleStack.js`
- Update `_nearestUnblocked()` to support exclusive target lock.

---

## 7. Acceptance Gates

- [ ] Lock target, leave seat → autopilot steers, maintains speed, decelerates using dual-ramp, stops, and descends automatically.
- [ ] Lock target, stay seated, press **KeyU** or controller **L3** → autopilot engages.
- [ ] Sit down or toggle off mid-flight → ship immediately returns control to manual flight.
- [ ] Non-locked targets do not trigger scale descents.
- [ ] Autopilot completes descent → hyperdrive and nav lock both disengage; next scale tier loads normally.
- [ ] Drive label shows correct autopilot phase strings in desktop HUD and VR diegetic panel.
- [ ] No regression: manual precision descent still works (player seated, PRECISION gear, inside entry shell).
