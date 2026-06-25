# Phase 10 - Audio Engine Spec

> Status: DESIGN LOCKED.
>
> This document is the implementation contract for the Deep Space VR audio
> engine. It captures the feature decisions from June 25, 2026 and should be
> treated as the source of truth for agents implementing the audio pass.

## Goal

Add a dedicated browser audio engine for Deep Space VR that gives the experience
a subtle balance of:

- diegetic cockpit sound: ship systems, bridge hum, instruments, drive layers,
  alerts, scanner tones, and authored ShipAI callouts;
- cinematic atmosphere: sparse music and deep-space beds that support the mood
  without flattening the scene into constant soundtrack.

The target feel is restrained, readable, and spatially grounded. The player
should mostly feel like they are inside a ship listening to systems and space
through sensors, with music/ambience entering as emotional color.

## Non-goals

- Do not scatter `new Audio()` or ad hoc `<audio>` elements through gameplay
  code.
- Do not make music the dominant layer by default.
- Do not require a bundler or package install.
- Do not integrate the external voice-AI service yet. Prepare the audio bus so
  future generated TTS can use the same voice path as authored ShipAI clips.
- Do not implement advanced occlusion, reflection, or full room acoustics in V1.
- Do not require asset transcoding before the feature works. MP3 decoding through
  Web Audio is acceptable for V1.

## Existing Context

The app is a no-build Three.js ES module project served as static files.

Relevant state owners:

- `src/app/App.js` owns lifecycle, input, the render loop, telemetry, and debug
  hooks.
- `src/ship/Ship.js` owns ship transform, speed, hyperdrive spool level, and
  GLB animation/FX hooks.
- `src/ship/ShipControls.js` owns pilot, dampeners, airbrake, boost, and
  hyperdrive intent.
- `src/player/PlayerController.js` owns `walking`, `piloting`, and `eva` states.
- `src/space/Universe.js` exposes `getPOIs`, `getCurrentNode`, `getCounts`, and
  rare visual events through `UniverseEvents`.
- `src/ui/DiegeticStatusPanel.js` already displays core ship/player state in VR.
- `services/voice-ai` is a separate future integration target.

Current audio assets live under:

```text
assets/audio/
  ShipAI/
  space/
```

## Audio Direction

### Default Mix

Use a cockpit-first mix:

- ship interior hum and bridge instruments are present but quiet;
- space ambience is wide and low, more texture than volume;
- music starts subtle, sparse, and optional;
- drive/engine layers scale with speed and piloting state;
- ShipAI voice is clean, foregrounded briefly, then gets out of the way;
- alarms are rare, important, and never left at full intensity indefinitely.

Suggested default bus balance:

| Bus | Default gain | Notes |
| --- | ---: | --- |
| master | 1.00 | Global output. |
| music | 0.16 | Subtle cinematic bed. |
| ambience | 0.28 | Deep space / environmental beds. |
| ship | 0.42 | Cockpit and system texture. |
| engine | 0.45 | Speed/drive dependent. |
| voice | 0.90 | Authored ShipAI and future TTS. |
| alerts | 0.72 | Short, priority-based. |
| signals | 0.38 | Scanner/radio anomalies. |

These are starting values, not sacred constants. Keep them config-driven.

### Diegetic vs Cinematic Rule

When in doubt, make the sound diegetic first and let music support it. For
example, a black hole encounter should be driven by sensor tones, accretion hum,
subtle alarm pressure, and a ShipAI warning. Music can thicken underneath, but
it should not replace the ship's response.

## Architecture

Add a new `src/audio/` module family.

Recommended files:

```text
src/audio/
  audioManifest.js
  AudioEngine.js
  AudioBus.js
  LoopLayer.js
  CuePlayer.js
  ShipComputer.js
  AudioDirector.js
```

Optional if implementation grows:

```text
src/audio/
  SpatialAudio.js
  AudioDebugPanel.js
```

### `audioManifest.js`

Owns the stable IDs, file paths, and semantic metadata for all known clips.

Each entry should include:

- `id`
- `path`
- `bus`
- `kind`: `loop`, `oneShot`, `voice`, or `music`
- `loop`: boolean
- `gain`
- `priority`
- `cooldown`
- optional `tags`

Avoid hard-coding raw filenames outside this manifest.

### `AudioEngine`

Owns the Web Audio graph:

- `AudioContext`
- `THREE.AudioListener`, attached to the active camera
- top-level bus gains
- asset loading and decoded buffer cache
- `resumeFromUserGesture()`
- `update(dt, state)`
- `playCue(id, options)`
- `startLoop(id, options)`
- `stopLoop(id, options)`
- `setBusGain(name, value, rampSeconds)`
- `duck(busName, amount, seconds)`
- `getDebugState()`

The engine should not decide game logic. It plays and mixes what the director
asks for.

### `AudioBus`

Simple gain tree rooted at the Web Audio destination:

```text
master
  music
  ambience
  ship
  engine
  voice
  alerts
  signals
```

Use `GainNode.gain.linearRampToValueAtTime` or
`setTargetAtTime` for smooth changes. Avoid instantaneous gain jumps.

### `LoopLayer`

Represents one continuous adaptive loop or a small crossfade group.

Required behavior:

- lazy start;
- smooth fade in/out;
- stable loop restart handling;
- gain and playback-rate modulation;
- optional random start offset for ambience loops;
- no duplicate instances for the same loop ID unless explicitly allowed.

### `CuePlayer`

Handles one-shot non-voice sounds:

- short UI/bridge blips;
- scanner tones;
- startup thrusts;
- warp engage/disengage accents;
- alerts.

Required behavior:

- per-cue cooldown;
- max simultaneous instances per cue or bus;
- priority-based stopping or ignoring for spammy events;
- optional random pitch/gain variation for repeated small cues.

### `ShipComputer`

Handles authored ShipAI voice lines from `assets/audio/ShipAI`.

Required behavior:

- priority queue;
- do not overlap voice lines by default;
- cooldown per semantic event;
- duck music/ambience/ship buses while speaking;
- allow variants for the same semantic event;
- expose `say(eventId, options)`.

ShipAI should feel like a ship system, not a separate narrator. Keep it concise
and tied to actual state changes.

### `AudioDirector`

The director maps app state to audio intent.

It should read a compact state object each frame, for example:

```js
{
  displayMode,
  playerState,
  cameraMode,
  pilotActive,
  dampeners,
  airbrake,
  boost,
  speed,
  velocity,
  hyperdriveEngaged,
  hyperdriveLevel,
  currentNode,
  nearbyPois,
  nearestBlackHole,
  nearestAnomaly,
  nearestNebula,
  universeCounts,
  xrActive
}
```

The director owns thresholds and event memory:

- "system online" should trigger once after audio is unlocked;
- "new zone" triggers on sector change, with cooldown;
- "strange signal" triggers near signal/anomaly conditions, with cooldown;
- "black hole detected" triggers at a warning radius;
- "close to the black hole" triggers at a closer danger radius;
- "50% light speed" and "80% light speed" trigger once per hyperdrive run at
  normalized speed thresholds;
- "disengage" variants trigger on hyperdrive disengage.

## Integration Points

### App Boot

In `App.js` constructor:

- create `this.audio = new AudioEngine({ camera: this.camera, ship: this.ship })`;
- create `this.audioDirector = new AudioDirector({ audio: this.audio })`;
- install debug hooks under `window.__deepSpaceDebug.audio`.

### User Gesture Unlock

Browser autoplay policy requires a gesture before audio can start.

Call `this.audio.resumeFromUserGesture()` from existing input gestures:

- canvas click;
- first keydown;
- XR session start/select;
- gamepad button press if practical.

After unlock, play the ShipAI `systemOnline` or `systemReady` line once, at low
priority, unless disabled in config.

### Per-frame Update

After ship, player, universe, and speed FX have updated in `_tick()`, call:

```js
this.audioDirector.update(dt, this._getAudioState());
this.audio.update(dt);
```

Keep `_getAudioState()` small and explicit. Do not pass the entire `App`.

### Listener

Attach the listener to `this.camera`. The player camera already represents the
active desktop/VR view.

Most V1 cockpit/AI sounds should be non-positional or lightly stereo/panned.
Use positional audio only where it is naturally helpful:

- engine/thruster bed at the ship rear;
- airlock/hatch cue;
- external anomaly/black hole sensor cue, if tested and comfortable.

### Floating Origin

The app rebases the universe when the ship moves far from origin. Avoid storing
long-lived absolute positions in audio nodes without refreshing them. If a sound
is positional, recompute its position from the current object/POI state each
frame or recreate it when needed.

## Asset Manifest V1

### ShipAI Voice Lines

Map these to semantic IDs:

| Semantic ID | Files |
| --- | --- |
| `systemOnline` | `ShipAI/system online.mp3`, `system online2.mp3`, `system online3.mp3` |
| `systemReady` | `ShipAI/system ready for your commands.mp3` |
| `hyperdriveReady` | `ShipAI/hyperdrive ready.mp3` |
| `lightSpeed50` | `ShipAI/50% light speed.mp3` |
| `lightSpeed80` | `ShipAI/80% light speed.mp3` |
| `alert` | `ShipAI/Alert.mp3` |
| `anomalyDetected` | `ShipAI/Anomaly Detected.mp3` |
| `blackHoleDetected` | `ShipAI/Black Hole detected.mp3` |
| `blackHoleClose` | `ShipAI/close to the black hole.mp3` |
| `disengage` | `ShipAI/Disengage.mp3`, `Disengage2.mp3`, `disengage3.mp3`, `disengage4.mp3` |
| `newZone` | `ShipAI/new_zone.mp3`, `new_zone2.mp3`, `new_zone3.mp3`, `new_zone4.mp3` |
| `strangeSignal` | `ShipAI/strange signal.mp3`, `strange signal2.mp3`, `strange signal3.mp3` |
| `debugReadAloud` | `ShipAI/read-aloud (19).mp3` |

### Space / Ship / Event Layers

Map these to loop or cue IDs:

| ID | File | Kind | Notes |
| --- | --- | --- | --- |
| `musicAmbient` | `space/ambiant_music.mp3` | music loop | Very low by default. |
| `spaceBedA` | `space/ambiant_space.mp3` | ambience loop | Base space layer. |
| `spaceBedB` | `space/ambiant_space2.mp3` | ambience loop | Alternate/crossfade. |
| `spaceBedC` | `space/ambiant_space3.mp3` | ambience loop | Richer, use sparingly. |
| `spaceBedD` | `space/ambiant_space4.mp3` | ambience loop | Quiet fallback. |
| `ambientTexture` | `space/ambiant_sound.mp3` | ambience loop/cue | Short texture. |
| `shipAmbient` | `space/ship_ambiant.mp3` | ship loop | Interior baseline. |
| `shipBridge` | `space/ship_bridge.mp3` | ship loop/cue | Bridge texture. |
| `shipInstrumentA` | `space/ship_instrument.mp3` | ship loop | Instrument layer. |
| `shipInstrumentB` | `space/ship_instrument2.mp3` | ship loop | Variant layer. |
| `shipInstruments` | `space/ship_instruments.mp3` | ship loop | Busier instrument layer. |
| `shipAtSpeed` | `space/ship_at_speed.mp3` | engine loop | Scales with speed. |
| `rocketFiring` | `space/rocket_firing.mp3` | engine loop/cue | Thrust/boost accent. |
| `shipStartup` | `space/ship_starting(thrusts).mp3` | cue | On first startup/replay. |
| `warpSpeed` | `space/wrap_speed.mp3` | engine loop/cue | Hyperdrive spool. |
| `warpDistortion` | `space/wrap_distortion.mp3` | cue/loop | Engage accent. |
| `blackHoleAccretion` | `space/blackhole_accretion.mp3` | ambience loop | Proximity layer. |
| `alarm` | `space/Alarm.mp3` | alert loop | Never full-volume by default. |
| `longSignal` | `space/long_signal.mp3` | signals loop/cue | Strange signal bed. |
| `signal2` | `space/signal2.mp3` | signals loop/cue | Signal variant. |
| `signal3` | `space/signal3.mp3` | signals loop/cue | Signal variant. |
| `signal4` | `space/signal4.mp3` | signals cue | Short signal. |
| `signal5` | `space/signal5.mp3` | signals cue | Short signal. |
| `spaceSynth` | `space/freesound_community-space-synth1-90446.mp3` | signals/music cue | Sparse stinger. |
| `spaceChords` | `space/idoberg-space-chords-loop-310493.mp3` | music loop | Optional musical color. |

Note the existing file names use `ambiant` and `wrap`. Preserve the filenames in
paths; use corrected semantic IDs in code.

## State-to-Audio Design

### Startup

After audio unlock:

- fade in `spaceBedA` and `shipAmbient`;
- start a quiet bridge/instrument layer if player is inside the ship;
- play `systemOnline` or `systemReady` once;
- optionally play `shipStartup` if the GLB startup animation is replayed.

### Walking Inside Ship

- `shipAmbient`: medium-low.
- `shipInstrumentA/B`: subtle, randomized or crossfaded.
- `spaceBedA`: low.
- `musicAmbient`: optional, very low.
- speed FX layers are reduced, matching existing visual speed-FX behavior while
  nobody is piloting.

### Piloting

- raise `engine` and `ship` layers slightly.
- scale `shipAtSpeed` by normalized speed.
- use `rocketFiring` while strong thrust/boost is active.
- use short bridge/system cues for toggles if added later.

### EVA

- reduce cockpit interior layers.
- keep space bed present but not loud.
- consider a low suit-filtered hum in a later asset pass.
- ShipAI remains audible and clean, as if through comms.

### Hyperdrive

On engage:

- play `hyperdriveReady` if off cooldown and contextually appropriate;
- start/fade `warpSpeed`;
- play `warpDistortion` as an engage accent;
- scale playback rate or gain by `hyperdriveLevel`;
- trigger `lightSpeed50` and `lightSpeed80` once per hyperdrive run.

On disengage:

- fade out warp layers over 0.4-1.2s;
- play one `disengage` variant, unless another higher-priority warning is active.

### Sector Change

When `currentNode.name` changes:

- play one `newZone` ShipAI variant if cooldown allows;
- crossfade ambience toward a deterministic variant based on the new node theme
  if useful;
- keep the change subtle. A new sector should not always feel like a hard level
  transition.

### Anomalies and Signals

When a nearby POI has type `anomaly`, or when rare events suggest a signal:

- fade in `longSignal` or one of `signal2`/`signal3`;
- play `strangeSignal` or `anomalyDetected` with cooldown;
- use short `signal4`/`signal5` cues as intermittent scanner pings.

### Black Holes

Use distance bands based on POI distance and landmark danger profile when
available.

Suggested bands:

- detection: first black hole enters nearest POI set within a broad radius;
- warning: close enough for visual prominence or gravitational interest;
- danger: close enough to deserve alarm pressure.

Audio behavior:

- fade in `blackHoleAccretion` with distance;
- play `blackHoleDetected` once at warning radius;
- play `blackHoleClose` at danger radius;
- fade in `alarm` only in danger, capped below full volume;
- avoid repeating warnings constantly.

### Rare Universe Events

`UniverseEvents` currently spawns visual events internally but does not expose an
event stream. V1 can infer from nearby POIs and state. If implementing event
hooks, add a small event queue API to `UniverseEvents`:

```js
consumeAudioEvents() // returns [{ type, position, intensity, age }]
```

Then map:

- `ionStorm` -> signal sweep / electrical bed;
- `pulsarSweep` -> pulse cue;
- `comet` -> quiet pass-by cue if near camera;
- `supernova` -> distant low stinger, very rare.

## Configuration

Add audio defaults in `src/config/audioPresets.js` or `assets/config/audio.json`
if runtime overrides are desired.

Recommended preset shape:

```js
export const AUDIO_PRESET = {
  enabled: true,
  autoplayShipAiGreeting: true,
  buses: {
    master: 1,
    music: 0.16,
    ambience: 0.28,
    ship: 0.42,
    engine: 0.45,
    voice: 0.9,
    alerts: 0.72,
    signals: 0.38
  },
  ducking: {
    voiceAmount: 0.45,
    voiceAttack: 0.08,
    voiceRelease: 0.35
  },
  cooldowns: {
    newZone: 45,
    strangeSignal: 60,
    anomalyDetected: 60,
    blackHoleDetected: 90,
    blackHoleClose: 45,
    lightSpeed50: 8,
    lightSpeed80: 8
  },
  distanceBands: {
    blackHoleWarning: 90000,
    blackHoleDanger: 35000,
    anomalySignal: 70000
  }
};
```

F2 audio controls are optional for V1, but debug hooks are required.

## Debug Surface

Expose:

```js
window.__deepSpaceDebug.getAudioState()
window.__deepSpaceDebug.setAudioEnabled(trueOrFalse)
window.__deepSpaceDebug.setAudioBusGain(bus, value)
window.__deepSpaceDebug.playAudioCue(id)
window.__deepSpaceDebug.sayShipAi(eventId)
window.__deepSpaceDebug.stopAllAudio()
```

`getAudioState()` should include:

- unlocked/suspended state;
- loaded buffer count;
- active loops;
- active one-shots count;
- bus gains;
- last ShipAI line;
- pending ShipAI queue;
- director event cooldowns;
- nearest audio-relevant POIs.

## Implementation Order

1. Create `audioManifest.js` with semantic IDs and bus metadata.
2. Implement `AudioBus` and `AudioEngine` with unlock, loading, bus gains, and
   debug state.
3. Wire `AudioEngine` into `App.js`, attach listener to camera, and unlock on
   user gesture.
4. Implement `LoopLayer`; fade in base `spaceBedA` + `shipAmbient` after unlock.
5. Implement `CuePlayer`; verify `playAudioCue(id)` works from debug hooks.
6. Implement `ShipComputer`; queue ShipAI clips, duck other buses while speaking.
7. Implement `AudioDirector` for startup, player state, piloting, speed, and
   hyperdrive.
8. Add sector-change, anomaly/signal, and black-hole proximity callouts.
9. Add optional config loading from `assets/config/audio.json`.
10. Browser-validate desktop, then smoke-test in VR/WebXR.

## Acceptance Gates

- Audio is silent until a user gesture unlocks the context.
- After unlock, base ambience and cockpit hum fade in smoothly.
- `window.__deepSpaceDebug.getAudioState()` reports unlocked state, bus gains,
  loaded buffers, and active loops.
- `playAudioCue('shipStartup')` works without creating duplicate long-lived
  loops.
- `sayShipAi('systemOnline')` plays one voice line, ducks ambience/music, and
  does not overlap with another voice line.
- Walking, piloting, EVA, and hyperdrive have audibly different but subtle mixes.
- Hyperdrive engage/disengage produces a clear but not overpowering audio
  transition.
- ShipAI speed callouts trigger once per hyperdrive run.
- Sector changes can trigger a `newZone` callout with cooldown.
- Near anomalies/signals, signal layers and callouts occur without spam.
- Near black holes, accretion/warning/alarm layers ramp by distance and recover
  when leaving.
- Pausing or disabling audio fades/halts active loops cleanly.
- No console errors from failed audio loading. Missing assets should warn once
  and degrade gracefully.
- The app still runs as static files with no build step.

## Validation Commands

From the repository root:

```powershell
python -m http.server 5177
```

Then open:

```text
http://localhost:5177/
```

Manual browser checks:

1. Click the canvas or press a key to unlock audio.
2. Open DevTools and run `window.__deepSpaceDebug.getAudioState()`.
3. Run `window.__deepSpaceDebug.sayShipAi('systemOnline')`.
4. Run `window.__deepSpaceDebug.playAudioCue('shipStartup')`.
5. Take controls, accelerate, engage hyperdrive, then disengage.
6. Fly toward a black hole/anomaly POI and verify distance layers/callouts.

## Risks and Notes

- MP3 loop points may not be sample-perfect. Use crossfades and low-volume beds
  to hide small gaps. Later asset passes can add OGG/WAV loops if needed.
- Browser autoplay and suspended `AudioContext` states are expected. Treat them
  as normal until a gesture unlocks audio.
- Large ambience files should load lazily. Do not decode every file on initial
  page load.
- Voice callouts can become annoying fast. Cooldowns and priority rules matter
  as much as playback code.
- VR comfort: avoid loud positional surprises behind the player. ShipAI and
  alerts should feel stable and readable.
- Future voice-AI generated TTS should route through the `voice` bus and reuse
  the same ducking and priority rules.
