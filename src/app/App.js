import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DEEP_SPACE_PRESET } from '../config/deepSpacePreset.js';
import {
    POST_FX_PRESETS,
    POST_FX_PRESET_NAMES,
    resolvePostFxPresetName
} from '../config/postFxPresets.js';
import {
    UNIVERSE_CONFIG,
    UNIVERSE_PRESETS,
    UNIVERSE_PRESET_NAMES,
    cloneUniverseConfig,
    resolveUniversePresetName
} from '../config/universePresets.js';
import { SCALE_TIERS } from '../config/scaleTiers.js';
import { Universe } from '../space/Universe.js';
import { ScaleStack } from '../space/scale/ScaleStack.js';
import { createRootLevel } from '../space/scale/Level.js';
import { GravityField } from '../space/GravityField.js';
import { Ship } from '../ship/Ship.js';
import { ShipControls } from '../ship/ShipControls.js';
import { PlayerRig } from '../player/PlayerRig.js';
import { RelativeLocomotion } from '../player/RelativeLocomotion.js';
import { PlayerController, PLAYER_STATE } from '../player/PlayerController.js';
import { GamepadInput } from '../input/GamepadInput.js';
import { SkyDeepSpace } from '../rendering/SkyDeepSpace.js';
import { RenderPipeline } from '../rendering/RenderPipeline.js';
import { PostProcessingPanel } from '../rendering/PostProcessingPanel.js';
import { UniversePanel } from '../rendering/UniversePanel.js';
import { XRExperience } from '../xr/XRExperience.js';
import { XRVisualEffects } from '../xr/XRVisualEffects.js';
import { DiegeticStatusPanel } from '../ui/DiegeticStatusPanel.js';
import { UniverseNavigation } from '../ui/UniverseNavigation.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { AudioDirector } from '../audio/AudioDirector.js';

// Rebase the world origin when the ship exceeds this distance from (0,0,0).
// 1 000 units → float32 precision < 0.0002 units, imperceptible on any surface.
// At hyperdrive speed (~1 200 units/frame) the rebase fires every frame, keeping
// the ship at (0,0,0) during the render call and eliminating IBL shimmer.
const FLOAT_ORIGIN_THRESHOLD_SQ = 1_000 ** 2;

export class App {
    constructor({ canvas }) {
        this.canvas = canvas;
        this.clock = new THREE.Clock();
        this.scene = new THREE.Scene();
        this.universeConfig = cloneUniverseConfig(UNIVERSE_CONFIG);
        this.activeUniversePreset = UNIVERSE_PRESET_NAMES.default;
        this.scene.background = new THREE.Color(0x000005);
        this.scene.fog = new THREE.FogExp2(0x000005, this.universeConfig.global.fogDensity);

        this.camera = new THREE.PerspectiveCamera(
            70,
            window.innerWidth / window.innerHeight,
            0.1,
            DEEP_SPACE_PRESET.cameraFar
        );
        this.camera.position.set(38, 16, 62);
        this.scene.add(this.camera);

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            preserveDrawingBuffer: true,
            powerPreference: 'high-performance',
            logarithmicDepthBuffer: true
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = POST_FX_PRESETS.desktopDefault.retro.exposure;

        // Image-based light so PBR/metal ship materials reflect something and are
        // not rendered near-black in the dim deep-space lighting. Per-material
        // envMapIntensity (set on the ship hull) keeps the overall mood dark.
        this._setupEnvironmentLighting();

        this.sky = new SkyDeepSpace(this.scene);
        this.environment = new Universe({ config: this.universeConfig });
        this.scene.add(this.environment.group);

        // Gravity is decoupled from the meshes: the environment hands out
        // attractor positions + masses, the field turns them into acceleration.
        this.gravityField = new GravityField();
        this.gravityField.setAttractors(this.environment.getAttractors());
        this.debrisHazardState = {
            active: false,
            intensity: 0,
            distance: Infinity,
            acceleration: new THREE.Vector3()
        };

        // 'glb' swaps in the imported Star Citizen hull; 'procedural' keeps the
        // original blockout from ShipModel.js available for later reuse.
        this.ship = new Ship({ variant: 'glb' });
        this.ship.position.set(0, 0, 0);
        this.ship.setGravityField(this.gravityField);
        this.shipControls = new ShipControls();
        this.scene.add(this.ship.object3D);

        // Nested scale levels (docs/universe-scale-architecture.md). The current
        // Universe becomes the tier-0 level; the stack owns descent into galaxy
        // levels and the reparent/rescale handoff. `this.environment` always
        // points at the *active* level's universe so the rest of App keeps using
        // it unchanged; transitions repoint it via _onActiveLevelChange.
        this.scaleStack = new ScaleStack({
            scene: this.scene,
            rootLevel: createRootLevel(this.environment),
            baseConfig: this.universeConfig,
            ship: this.ship,
            gravityField: this.gravityField,
            onActiveChange: (level) => this._onActiveLevelChange(level)
        });

        this.audio = new AudioEngine({ camera: this.camera, ship: this.ship });
        this.audioDirector = new AudioDirector({ audio: this.audio });
        this.ship.ready
            .then((info) => {
                if (info) console.info('Ship hull ready', info.size, 'scale', info.appliedScale);
                // Re-apply once the async hull exists so the F2 slider values stick.
                this.ship.setEnvMapIntensity(this.postFxConfig.ship?.envMapIntensity ?? 0.85);
                this.ship.setGlassOpacity(this.postFxConfig.ship?.glassOpacity ?? 0.15);
                this.ship.setBrightness(this.postFxConfig.ship?.brightness ?? 1);
                this.ship.setBloom(this.postFxConfig.ship?.bloom ?? 1);
                this._applyRuntimeConfig();
            })
            .catch(() => {});

        this.debugCamera = {
            mode: 'exterior',
            // Remembered free-camera mode to restore when leaving pilot mode.
            freeMode: 'exterior',
            exteriorOffset: new THREE.Vector3(38, 16, 62),
            interiorLocalPosition: this.ship.getAnchorLocalPosition('cameraDebugMount') ?? new THREE.Vector3(0, 1.65, -3.8),
            // Chase-cam offset behind the ship (ship-local; forward is -Z, so +Z is behind).
            chaseLocalOffset: new THREE.Vector3(0, 7, 30),
            chaseLookAhead: new THREE.Vector3(0, 1.5, -16)
        };

        this.playerRig = new PlayerRig({ ship: this.ship });
        // The rig is parented to the ship's interior root, so the player's pose is
        // expressed in the ship-local frame and rides along with every ship
        // translation/rotation. The camera converts local -> world each frame.
        this.ship.interiorRoot.add(this.playerRig.object3D);

        // Phase 4: on-foot relative locomotion + the WALKING/PILOTING/EVA state
        // machine. Piloting is routed through ShipControls (same as Phase 3),
        // locomotion is a separate state, and EVA is a tethered ship-frame float.
        this.locomotion = new RelativeLocomotion();
        this.playerController = new PlayerController({
            ship: this.ship,
            playerRig: this.playerRig,
            shipControls: this.shipControls,
            locomotion: this.locomotion
        });

        // 'player' -> first-person rig drives the camera (default Phase 4 view);
        // 'debug'  -> the free inspection cameras from Phase 2/3 (keys 1 / 2).
        this.cameraMode = 'player';
        this.mouse = { dx: 0, dy: 0 };

        // Phase 08 extreme-speed cues: base FOV to widen from, and the eased
        // radial warp distortion (one value; only one render path is live).
        this._baseCameraFov = this.camera.fov;
        this._warpDistortion = 0;
        // Eased speed-FX intensity: full while piloting, subdued on foot / EVA.
        this._speedFxScale = 1;
        this._relativisticBeta = 0;
        this._relativisticDirection = new THREE.Vector3(0, 0, -1);

        // Phase 2 debug helpers (anchor spheres + player scale capsule) are now
        // hidden by default: with bloom they looked like stray bits stuck on the
        // hull. Toggle back on with F3 / the debug hook when aligning anchors.
        this.debugMarkersVisible = false;
        this._applyDebugMarkers();

        this.input = this._createInputState();
        this.paused = false;
        this.postFxConfig = structuredClone(POST_FX_PRESETS.desktopDefault);
        this.activePreset = POST_FX_PRESET_NAMES.desktopDefault;
        this.displayMode = 'desktop';
        this._desktopStateBeforeVr = null;
        this.vrHudVisible = true;
        this.renderPipeline = new RenderPipeline({
            renderer: this.renderer,
            scene: this.scene,
            camera: this.camera,
            config: this.postFxConfig
        });
        this.postPanel = new PostProcessingPanel({
            config: this.postFxConfig,
            onChange: () => this._handleRuntimeConfigChange(),
            onPreset: (name) => this.applyFxPreset(name)
        });
        this.universePanel = new UniversePanel({
            config: this.universeConfig,
            presets: UNIVERSE_PRESETS,
            onLiveChange: () => this._handleUniverseLiveChange(),
            onRegen: () => this.regenerateUniverse(),
            onPreset: (name) => this.applyUniversePreset(name)
        });
        this.universeNavigation = new UniverseNavigation({ universe: this.environment });
        this.diegeticPanel = new DiegeticStatusPanel();
        this.camera.add(this.diegeticPanel.object3D);
        this.xr = new XRExperience({
            renderer: this.renderer,
            scene: this.scene,
            camera: this.camera,
            playerRig: this.playerRig,
            onSessionStart: () => this._enterVrMode(),
            onSessionEnd: () => this._leaveVrMode(),
            onSelect: () => this._handleXrSelect()
        });
        this.xrVisualEffects = new XRVisualEffects({
            scene: this.scene,
            camera: this.camera,
            ship: this.ship,
            environment: this.environment
        });
        this.xrVisualEffects.resize(window.innerWidth, window.innerHeight, this.renderer.getPixelRatio());

        this._createTelemetryHud();
        this._bindEvents();
        this._installDebugHooks();
        this._applyRuntimeConfig();
        this._loadInitialJsonPreset();
    }

    start() {
        this.renderer.setAnimationLoop(() => this._tick());
    }

    _tick() {
        const dt = Math.min(this.clock.getDelta(), 0.05);
        const gamepad = this.input.gamepad.update();
        const xrInput = this.xr.update(dt, this.postFxConfig.vrComfort);
        const xrActive = this.xr.isPresenting;
        const controlInput = xrActive && !gamepad.connected ? xrInput : gamepad;

        if (xrActive) {
            if (this.cameraMode !== 'player') this._enterPlayerMode();
            this._handleGamepadButtons(gamepad);
            if (gamepad.connected) this._applyGamepadLook(gamepad, dt);
            else this.playerController.applyComfortTurn(xrInput.turnDelta ?? 0);
        } else {
            this._handleGamepadButtons(gamepad);
            this._applyGamepadLook(gamepad, dt);
        }

        // Hyperdrive toggle (r3 on a pad, right face button in VR) reads from
        // whichever input is actually driving the ship this frame.
        this._handleHyperdriveButton(controlInput);

        // Ship is simulated every frame whether or not anyone is piloting: when
        // pilot mode is off the command is inactive and it coasts on inertia +
        // gravity. So it keeps moving and keeps being bent by attractors.
        // `paused` freezes only the live simulation so manual/automated stepping
        // through the debug hooks is deterministic; rendering keeps running.
        if (!this.paused) {
            const command = this.shipControls.getCommand(this.input.keys, controlInput);
            this.debrisHazardState = this.environment.getHazardState?.(this.ship.position, this.ship.velocity) ?? this._emptyDebrisHazard();
            this.ship.update(dt, command, this.gravityField, this.debrisHazardState.acceleration);
            this._maybeRebaseOrigin();
            // Planetary tier only: resolve ship-vs-surface contact after physics
            // so gravity rests the hull on the terrain (touchdown) while outward
            // thrust still lifts off. No-op on every other level (optional method).
            this.environment.collideShip?.(this.ship, dt);
        }

        // Camera: in player mode the rig (ship-local) drives it after the ship
        // transform was integrated this frame, so walking while the ship moves
        // reads correctly through the windows. In debug mode the Phase 2/3 free
        // cameras drive it instead.
        if (this.cameraMode === 'player') {
            if (!this.paused) this.playerController.update(dt, this.input.keys, controlInput);
            if (!xrActive) this.playerController.updateCamera(this.camera);
        } else {
            this._updateDebugCamera(dt);
        }

        this.playerRig.update(dt);
        // Updates the active level and evaluates the descend/ascend transition
        // rule (entry shell + PRECISION speed gate to sink in, exit shell to
        // climb back out), running the reparent/rescale handoff under a veil.
        this.scaleStack.update({
            shipPosition: this.ship.position,
            dt,
            cameraPosition: this.camera.position,
            hyperdriveLevel: this.ship.getHyperdriveLevel()
        });
        this.sky.update(dt, this.camera.position);

        this._updateSpeedFx(dt, xrActive);

        this._updateTelemetry();
        this.universeNavigation.update({
            shipPosition: this.ship.position,
            camera: this.camera,
            displayMode: this.displayMode
        });
        this.universePanel.updateStats({
            counts: this.environment.getCounts(),
            currentNode: this.environment.getCurrentNode(this.ship.position),
            fps: 1 / Math.max(dt, 0.0001)
        });
        this._updateDiegeticPanel();
        this.xrVisualEffects.update(dt, {
            config: this.postFxConfig.xrVisualFx,
            xrActive,
            shipSpeed: this.ship.speed
        });
        this.audioDirector.update(dt, this._getAudioState({ xrActive }));
        this.audio.update(dt);

        // One stable render entrypoint. The facade picks desktop EffectComposer
        // or the custom XR post-FX backend (real Bloom + Retro/Pixel + Color
        // Depth + Scanlines + Warp) based on the live XR session.
        this.renderPipeline.render({ scene: this.scene, camera: this.camera, dt });
    }

    _handleGamepadButtons(gamepad) {
        if (!gamepad.connected) return;
        const buttons = gamepad.buttons;

        if (Object.values(buttons).some((button) => button.justPressed)) {
            this._unlockAudioFromGesture();
        }

        if (buttons.triangle.justPressed && this.cameraMode === 'player') {
            const action = this.playerController.interact();
            if (action) {
                this.input.gamepad.pulse({ duration: 90, weak: 0.25, strong: 0.45 });
                this._syncDebugDomState();
            }
        }

        if (buttons.square.justPressed) {
            if (this.shipControls.handleToggleKey('KeyZ') === 'dampeners') {
                this.input.gamepad.pulse({ duration: 70, weak: 0.18, strong: 0.28 });
                this._syncDebugDomState();
            }
        }

        if (buttons.circle.pressed && this.shipControls.pilotActive) {
            this.input.gamepad.pulse({
                duration: 90,
                weak: 0.18,
                strong: 0.12,
                minInterval: 120
            });
        }
    }

    _applyGamepadLook(gamepad, dt) {
        if (!gamepad.connected || this.cameraMode !== 'player') return;
        this.playerController.applyGamepadLook(gamepad.axes.rightX, gamepad.axes.rightY, dt);
    }

    // Edge-triggered hyperdrive toggle from a gamepad / XR controller button.
    _handleHyperdriveButton(input) {
        if (!(this.postFxConfig.hyperdrive?.enabled ?? true)) return;
        if (!input?.connected) return;
        if (!input.buttons?.r3?.justPressed) return;
        if (this.shipControls.handleToggleKey('Space') === 'hyperdrive') {
            this._onHyperdriveToggled(input.source === 'webxr');
        }
    }

    // Tactile feedback + state sync on engage/disengage. A punchy pulse on
    // engage, a softer one on disengage.
    _onHyperdriveToggled(fromXr = false) {
        const engaged = this.shipControls.hyperdriveEngaged;
        const pulse = engaged
            ? { duration: 160, weak: 0.5, strong: 0.7, strength: 0.6 }
            : { duration: 90, weak: 0.2, strong: 0.3, strength: 0.3 };
        if (fromXr) this.xr.pulse({ duration: pulse.duration, strength: pulse.strength });
        else this.input.gamepad.pulse(pulse);
        this._syncDebugDomState();
    }

    // Floating-origin rebase: when the ship strays past the float32 precision
    // threshold, shift every absolute world-space position by the ship's current
    // displacement so the ship lands back at (0,0,0). Relative geometry is
    // unchanged; velocity/angular state are relative and need no adjustment.
    _maybeRebaseOrigin() {
        if (this.ship.position.lengthSq() < FLOAT_ORIGIN_THRESHOLD_SQ) return;
        const offset = this.ship.position.clone();
        this.ship.object3D.position.set(0, 0, 0);
        // Rebase runs in the active level's frame only (dormant ancestors keep
        // their frozen frame so an ascent can restore the ship there).
        this.scaleStack.rebaseOrigin(offset);
        this.gravityField.setAttractors(this.environment.getAttractors());
    }

    // Called by the scale stack whenever the active level changes (descend /
    // ascend / reset). Repoints every system that reads the live universe at the
    // newly active level and rebuilds gravity from its attractors.
    _onActiveLevelChange(level) {
        this.environment = level.universe;
        if (this.universeNavigation) this.universeNavigation.universe = level.universe;
        // Widen the gravity field's reach to the active level's request (a
        // planetary theatre is far larger than the default 70k field), so the
        // planet at its centre still pulls the ship in from the orbital standoff.
        this.gravityField.maxDistance = level.universe.gravityReach ?? 70000;
        this.gravityField.setAttractors(level.universe.getAttractors());
        this._applyUniverseRuntimeConfig();
        this._syncDebugDomState();
    }

    // Phase 08: drive warp / speed-lines / FOV / distortion from the active gear.
    // Replaces the old fixed `speed / 600` warp factor with a regime-scaled
    // reference that blends from PRECISION to HYPERDRIVE by the spool level.
    _updateSpeedFx(dt, xrActive) {
        const speed = this.ship.speed;
        const level = this.ship.getHyperdriveLevel();
        const hd = this.postFxConfig.hyperdrive ?? {};
        const comfort = this.postFxConfig.vrComfort ?? {};
        const warpCfg = this.postFxConfig.warp ?? {};
        const relativisticCfg = this.postFxConfig.relativisticStars ?? {};

        // Speed-FX intensity: full while piloting, subdued when nobody is at the
        // controls (walking the ship / EVA) so the drift FX read calmer on foot.
        // Eased so taking / leaving the controls fades rather than pops.
        const targetFxScale = this.shipControls.pilotActive
            ? (warpCfg.speedFxScale ?? 1)
            : (warpCfg.speedFxOnFootScale ?? 0.35);
        this._speedFxScale += (targetFxScale - this._speedFxScale) * THREE.MathUtils.clamp(dt * 3, 0, 1);
        const fxScale = this._speedFxScale;

        // Warp speed factor: reference speed blends up with spool so warp is not
        // pinned during normal PRECISION flight nor stuck low in hyperdrive.
        const warpRef = THREE.MathUtils.lerp(
            hd.warpRefPrecision ?? 1500,
            hd.warpRefHyper ?? 18000,
            level
        );
        const speedFactor = THREE.MathUtils.clamp(speed / Math.max(warpRef, 1), 0, 1) * fxScale;
        const warpCeiling = comfort.warpMax ?? 1;
        this.renderPipeline.setWarpSpeedFactor(Math.min(speedFactor, warpCeiling));

        // Extreme-speed cues use absolute m/s thresholds (Racing used km/h).
        const fovStart = hd.fovStart ?? 8000;
        const fovMax = hd.fovMax ?? 60000;
        const fovFactor = THREE.MathUtils.clamp((speed - fovStart) / Math.max(fovMax - fovStart, 1), 0, 1);

        // Part 12: feed the star-field shader a perceptual relativistic beta
        // keyed to the same normalized hyperdrive speed source as warp.
        const spoolFactor = THREE.MathUtils.smoothstep(level, 0.05, 1);
        const maxBeta = THREE.MathUtils.clamp(relativisticCfg.maxBeta ?? 0.82, 0, 0.95);
        const intensity = Math.max(0, relativisticCfg.intensity ?? 1);
        const drivenBeta = (relativisticCfg.enabled ?? true)
            ? THREE.MathUtils.clamp(speedFactor * spoolFactor * intensity * maxBeta, 0, maxBeta)
            : 0;
        const targetBeta = relativisticCfg.debugOverrideEnabled
            ? THREE.MathUtils.clamp(relativisticCfg.debugBeta ?? 0, 0, maxBeta)
            : drivenBeta;
        this._relativisticBeta += (targetBeta - this._relativisticBeta) * THREE.MathUtils.clamp(dt * 2.6, 0, 1);
        if (this.ship.velocity.lengthSq() > 1e-4) {
            this._relativisticDirection.copy(this.ship.velocity).normalize();
        }
        this.environment.setRelativisticState?.({
            beta: this._relativisticBeta,
            direction: this._relativisticDirection,
            observerPosition: this.camera.position
        });

        // Radial distortion everywhere, capped per platform and eased.
        const distCap = xrActive
            ? (comfort.warpDistortionMaxVR ?? 0.25)
            : (comfort.warpDistortionMaxDesktop ?? 0.6);
        const distTarget = fovFactor * distCap * fxScale;
        const distEase = THREE.MathUtils.clamp(dt * 3, 0, 1);
        this._warpDistortion += (distTarget - this._warpDistortion) * distEase;
        this.renderPipeline.setWarpDistortion(this._warpDistortion);

        // FOV widen: desktop / chase cam only. In an XR session the per-eye
        // projection is device-supplied, so camera.fov has no effect (documented
        // constraint, not a TODO) — leave it at base.
        const fovBoostMax = comfort.fovBoostMaxDesktop ?? 40;
        const targetFov = this._baseCameraFov + (xrActive ? 0 : fovFactor * fovBoostMax * fxScale);
        const fovEase = THREE.MathUtils.clamp(dt * 3, 0, 1);
        const nextFov = this.camera.fov + (targetFov - this.camera.fov) * fovEase;
        if (Math.abs(nextFov - this.camera.fov) > 0.01) {
            this.camera.fov = nextFov;
            this.camera.updateProjectionMatrix();
        }

        // Recalibrate the speed lines for the active gear (thresholds scale by the
        // effective multiplier^0.7, matching Racing's calibration exponent).
        const mult = hd.hyperForwardMult ?? 120;
        const exp = Math.pow(mult, 0.7);
        this.ship.speedLines.setSpeedThresholds(
            THREE.MathUtils.lerp(200, 200 * exp, level),
            THREE.MathUtils.lerp(1800, 1800 * exp, level)
        );
        this.ship.speedLines.setIntensity(fxScale);
    }

    // Human-readable drive state for the telemetry + diegetic HUD.
    _hyperdriveDriveLabel() {
        const engaged = this.shipControls.hyperdriveEngaged;
        const level = this.ship.getHyperdriveLevel();
        if (!engaged && level < 0.01) return 'PRECISION';
        if (engaged && level > 0.99) return 'HYPERDRIVE';
        return `HYPERDRIVE ⟳ ${Math.round(level * 100)}%`;
    }

    _handleXrSelect() {
        this._unlockAudioFromGesture();
        if (this.cameraMode !== 'player') return false;
        const action = this.playerController.interact();
        if (action) {
            this.xr.pulse({ duration: 80, strength: 0.34 });
            this._syncDebugDomState();
        }
        return action;
    }

    _enterVrMode() {
        this._unlockAudioFromGesture();
        this.displayMode = 'vr';
        this._exitPointerLock();
        this.postPanel.setVisible(false);
        this.universePanel.setVisible(false);
        this._enterPlayerMode();
        this.playerController.setComfortMode(true);
        this._applyRuntimeConfig();
        this._syncDebugDomState();
    }

    _leaveVrMode() {
        this.displayMode = 'desktop';
        this.playerController.setComfortMode(false);
        this._applyRuntimeConfig();
        this._enterPlayerMode();
        this._syncDebugDomState();
    }

    applyFxPreset(name) {
        const key = resolvePostFxPresetName(name);
        if (!key) return false;

        replaceConfig(this.postFxConfig, POST_FX_PRESETS[key]);
        this.activePreset = POST_FX_PRESET_NAMES[key];
        this.postPanel.refresh();
        this._applyRuntimeConfig();
        this._syncDebugDomState();
        return this.activePreset;
    }

    applyUniversePreset(name) {
        const key = resolveUniversePresetName(name);
        if (!key) return false;

        replaceConfig(this.universeConfig, UNIVERSE_PRESETS[key]);
        this.activeUniversePreset = UNIVERSE_PRESET_NAMES[key] ?? key;
        this.universePanel.refresh();
        this.regenerateUniverse();
        this._syncDebugDomState();
        return this.activeUniversePreset;
    }

    regenerateUniverse() {
        // Collapse back to the root level before regenerating: the universe panel
        // edits the tier-0 config, and any descended galaxy levels are stale once
        // the root seed/config changes.
        this.scaleStack?.resetToRoot();
        this.environment.regenerate(this.universeConfig);
        this.gravityField.setAttractors(this.environment.getAttractors());
        this._applyUniverseRuntimeConfig();
        this._syncDebugDomState();
    }

    _handleRuntimeConfigChange() {
        this.activePreset = 'custom';
        this._applyRuntimeConfig();
        this._syncDebugDomState();
    }

    _handleUniverseLiveChange() {
        this.activeUniversePreset = 'custom';
        this._applyUniverseRuntimeConfig();
        this._syncDebugDomState();
    }

    _updateDebugCamera(dt) {
        if (this.debugCamera.mode === 'pilot') {
            this._updatePilotChaseCamera(dt);
            return;
        }

        if (this.debugCamera.mode === 'interior') {
            this._updateInteriorDebugCamera(dt);
            return;
        }

        this._updateExteriorDebugCamera(dt);
    }

    // Chase cam used while piloting: rides behind the ship in its local frame so
    // it banks/pitches/rolls with it, making 6-DOF rotation legible. Movement
    // keys (arrows/Q/E) go to the ship in this mode, not to the camera.
    _updatePilotChaseCamera(dt) {
        // Ship transform was just integrated this frame; refresh its world matrix
        // so localToWorld reflects the new orientation without a one-frame lag.
        this.ship.object3D.updateWorldMatrix(true, false);
        const desired = this.ship.localToWorld(this.debugCamera.chaseLocalOffset.clone());
        const lerp = THREE.MathUtils.clamp(dt * 4, 0, 1);
        this.camera.position.lerp(desired, lerp);
        this.camera.up.copy(this.ship.localToWorld(new THREE.Vector3(0, 1, 0)).sub(this.ship.position));
        this.camera.lookAt(this.ship.localToWorld(this.debugCamera.chaseLookAhead.clone()));
    }

    _updateExteriorDebugCamera(dt) {
        const speed = this.input.keys.has('ShiftLeft') ? 38 : 12;
        const move = new THREE.Vector3();

        if (this.input.keys.has('ArrowUp')) move.z -= 1;
        if (this.input.keys.has('ArrowDown')) move.z += 1;
        if (this.input.keys.has('ArrowLeft')) move.x -= 1;
        if (this.input.keys.has('ArrowRight')) move.x += 1;
        if (this.input.keys.has('KeyQ')) move.y += 1;
        if (this.input.keys.has('KeyE')) move.y -= 1;

        if (move.lengthSq() > 0) {
            move.normalize().multiplyScalar(speed * dt);
            this.debugCamera.exteriorOffset.add(move);
        }

        this.camera.position.copy(this.ship.position).add(this.debugCamera.exteriorOffset);

        const cameraTarget = this.ship.localToWorld(new THREE.Vector3(0, 1.7, 0));
        this.camera.lookAt(cameraTarget);
    }

    _updateInteriorDebugCamera(dt) {
        const speed = this.input.keys.has('ShiftLeft') ? 5.5 : 2.2;
        const move = new THREE.Vector3();

        if (this.input.keys.has('ArrowUp')) move.z -= 1;
        if (this.input.keys.has('ArrowDown')) move.z += 1;
        if (this.input.keys.has('ArrowLeft')) move.x -= 1;
        if (this.input.keys.has('ArrowRight')) move.x += 1;
        if (this.input.keys.has('KeyQ')) move.y += 1;
        if (this.input.keys.has('KeyE')) move.y -= 1;

        if (move.lengthSq() > 0) {
            move.normalize().multiplyScalar(speed * dt);
            this.debugCamera.interiorLocalPosition.add(move);
            this.debugCamera.interiorLocalPosition.x = THREE.MathUtils.clamp(this.debugCamera.interiorLocalPosition.x, -5.8, 2.8);
            this.debugCamera.interiorLocalPosition.y = THREE.MathUtils.clamp(this.debugCamera.interiorLocalPosition.y, 0.8, 2.35);
            this.debugCamera.interiorLocalPosition.z = THREE.MathUtils.clamp(this.debugCamera.interiorLocalPosition.z, -14.0, 12.8);
        }

        const localPosition = this.debugCamera.interiorLocalPosition;
        const localTarget = localPosition.clone().add(new THREE.Vector3(0, -0.05, -5.5));

        this.camera.position.copy(this.ship.localToWorld(localPosition));
        this.camera.lookAt(this.ship.localToWorld(localTarget));
    }

    _applyDebugMarkers() {
        this.ship.setAnchorMarkersVisible(this.debugMarkersVisible);
        this.playerRig.setMarkerVisible(this.debugMarkersVisible);
    }

    setDebugMarkersVisible(visible) {
        this.debugMarkersVisible = Boolean(visible);
        this._applyDebugMarkers();
        return this.debugMarkersVisible;
    }

    toggleVrHud() {
        this.vrHudVisible = !this.vrHudVisible;
        this._updateDiegeticPanel();
        this._syncDebugDomState();
        return this.vrHudVisible;
    }

    _createTelemetryHud() {
        const hud = document.createElement('div');
        hud.id = 'ship-telemetry';
        hud.innerHTML = `
            <style>
                #ship-telemetry {
                    position: fixed;
                    left: 16px;
                    top: 16px;
                    min-width: 220px;
                    padding: 10px 12px;
                    background: rgba(4, 8, 18, 0.78);
                    border: 1px solid rgba(150, 205, 255, 0.28);
                    color: #cfe6ff;
                    font: 12px/1.5 "Consolas", "Courier New", monospace;
                    letter-spacing: 0.04em;
                    pointer-events: none;
                    z-index: 9;
                    white-space: pre;
                }
                #ship-telemetry b { color: #9bdcff; }
                #ship-telemetry .on { color: #74ffb0; }
                #ship-telemetry .off { color: #6f8196; }
                #ship-telemetry .warn { color: #ffb061; }
            </style>
            <div data-telemetry></div>
        `;
        document.body.appendChild(hud);
        this.telemetryNode = hud.querySelector('[data-telemetry]');

        // Center-bottom contextual interaction prompt (take controls, airlock...).
        const prompt = document.createElement('div');
        prompt.id = 'interaction-prompt';
        prompt.innerHTML = `
            <style>
                #interaction-prompt {
                    position: fixed;
                    left: 50%;
                    bottom: 96px;
                    transform: translateX(-50%);
                    padding: 8px 16px;
                    background: rgba(4, 8, 18, 0.82);
                    border: 1px solid rgba(150, 205, 255, 0.45);
                    border-radius: 4px;
                    color: #dff0ff;
                    font: 13px/1.4 "Consolas", "Courier New", monospace;
                    letter-spacing: 0.05em;
                    text-shadow: 0 0 10px rgba(120, 180, 255, 0.6);
                    pointer-events: none;
                    z-index: 9;
                    display: none;
                }
            </style>
            <span data-prompt></span>
        `;
        document.body.appendChild(prompt);
        this.promptNode = prompt.querySelector('[data-prompt]');
        this.promptContainer = prompt;
    }

    _updateTelemetry() {
        if (!this.telemetryNode) return;

        const controls = this.shipControls.getState();
        const command = this.ship.commandState ?? {};
        const speed = this.ship.speed;
        const angSpeed = THREE.MathUtils.radToDeg(this.ship.angularVelocity.length());
        const nearest = this.gravityField.nearestAttractor(this.ship.position);
        const gamepad = this.input.gamepad.state;

        const flag = (value, label = ['ON', 'OFF']) =>
            value ? `<span class="on">${label[0]}</span>` : `<span class="off">${label[1]}</span>`;

        const mode = this.cameraMode === 'player'
            ? `PLAYER:${this.playerController.getState().toUpperCase()}`
            : `DEBUG:${this.debugCamera.mode.toUpperCase()}`;
        const dampLabel = controls.dampeners
            ? '<span class="on">ON</span>'
            : '<span class="warn">OFF (inertial)</span>';
        const brake = command.airbrake ? '<span class="warn">AIRBRAKE</span>' : '';
        const driveLabel = this.shipControls.hyperdriveEngaged || this.ship.getHyperdriveLevel() > 0.01
            ? `<span class="on">${this._hyperdriveDriveLabel()}</span>`
            : '<span class="off">PRECISION</span>';
        const padId = gamepad.id && gamepad.id.length > 34 ? `${gamepad.id.slice(0, 31)}...` : gamepad.id;

        const lines = [
            `<b>VIEW</b> ${mode}    <b>PILOT</b> ${flag(controls.pilotActive)} ${brake}`,
            `<b>DAMPENERS</b> ${dampLabel}    <b>DRIVE</b> ${driveLabel}`,
            `<b>PAD</b> ${gamepad.connected ? `<span class="on">${padId || 'CONNECTED'}</span>` : '<span class="off">OFF</span>'}`,
            `<b>SPEED</b> ${speed.toFixed(1)} m/s   <b>ANG</b> ${angSpeed.toFixed(1)} deg/s`
        ];

        if (nearest) {
            lines.push(
                `<b>${nearest.name}</b> ${nearest.distance.toFixed(0)} m  pull ${nearest.acceleration.toFixed(2)} m/s2`
            );
        }

        if (this.debrisHazardState?.active) {
            lines.push(
                `<b>DEBRIS</b> ${this.debrisHazardState.name} ${(this.debrisHazardState.intensity * 100).toFixed(0)}% turbulence`
            );
        }

        const currentNode = this.environment.getCurrentNode(this.ship.position);
        if (currentNode) {
            lines.push(`<b>SECTOR</b> ${currentNode.name} / ${currentNode.theme}`);
        }

        const scale = this.scaleStack.getState(this.ship.position);
        const scaleLabel = scale.transition
            ? `<span class="warn">${scale.transition.toUpperCase()}…</span>`
            : `<span class="on">${scale.levelName}</span>`;
        lines.push(`<b>SCALE</b> ${scaleLabel} (tier ${scale.tier})`);

        // Planetary tier: surface altitude + landing readout.
        const landing = this.environment.getLandingState?.(this.ship.position);
        if (landing) {
            if (landing.landed) {
                lines.push('<b>SURFACE</b> <span class="on">LANDED</span>');
            } else if (landing.contact && !landing.canLand) {
                lines.push('<b>SURFACE</b> <span class="warn">CLOUD DECK</span> (no touchdown)');
            } else {
                const altText = landing.altitude >= 1000
                    ? `${(landing.altitude / 1000).toFixed(1)} km`
                    : `${Math.max(0, landing.altitude).toFixed(0)} m`;
                const tag = landing.canLand ? '' : ' (gas — no touchdown)';
                lines.push(`<b>ALT</b> ${altText}${tag}`);
            }
        }

        this.telemetryNode.innerHTML = lines.join('\n');

        // Contextual interaction prompt (player mode only).
        const promptText = this.cameraMode === 'player' ? this.playerController.getPrompt() : null;
        if (this.promptNode) {
            this.promptNode.textContent = promptText ?? '';
            this.promptContainer.style.display = promptText ? 'block' : 'none';
        }
    }

    _updateDiegeticPanel() {
        const controls = this.shipControls.getState();
        this.diegeticPanel.object3D.visible = this.displayMode === 'vr' && this.vrHudVisible;
        this.diegeticPanel.update({
            displayMode: this.displayMode,
            playerState: this.playerController.getState(),
            speed: this.ship.speed,
            dampeners: controls.dampeners,
            pilotActive: controls.pilotActive,
            drive: this._hyperdriveDriveLabel(),
            preset: this.activePreset,
            universe: this.activeUniversePreset,
            nav: this.universeNavigation.getState(),
            hazard: this.debrisHazardState,
            prompt: this.cameraMode === 'player' ? this.playerController.getPrompt() : null
        });
    }

    _emptyDebrisHazard() {
        return {
            active: false,
            type: null,
            name: null,
            intensity: 0,
            distance: Infinity,
            acceleration: new THREE.Vector3()
        };
    }

    _getAudioState({ xrActive = false } = {}) {
        const nearbyPois = this.environment.getPOIs(this.ship.position, 18);
        const nearestBlackHole = nearbyPois.find((poi) => poi.type === 'blackhole') ?? null;
        const nearestAnomaly = nearbyPois.find((poi) => poi.type === 'anomaly') ?? null;
        const nearestNebula = nearbyPois.find((poi) => poi.type === 'nebula' || poi.type === 'cluster') ?? null;
        const nearestDebris = nearbyPois.find((poi) => poi.type === 'asteroid belt') ?? null;
        const currentNode = this.environment.getCurrentNode(this.ship.position);
        const controls = this.shipControls.getState();
        const command = this.ship.commandState ?? {};

        return {
            displayMode: this.displayMode,
            playerState: this.playerController.getState(),
            cameraMode: this.cameraMode,
            pilotActive: controls.pilotActive,
            dampeners: controls.dampeners,
            airbrake: Boolean(command.airbrake),
            boost: Boolean(command.boost),
            command: { ...command },
            speed: this.ship.speed,
            velocity: this.ship.velocity.toArray(),
            hyperdriveEngaged: controls.hyperdriveEngaged,
            hyperdriveLevel: this.ship.getHyperdriveLevel(),
            currentNode: currentNode
                ? {
                    name: currentNode.name,
                    theme: currentNode.theme,
                    radius: currentNode.radius
                }
                : null,
            nearbyPois: nearbyPois.map((poi) => ({
                type: poi.type,
                name: poi.name,
                distance: poi.distance,
                radius: poi.radius,
                theme: poi.theme
            })),
            nearestBlackHole,
            nearestAnomaly,
            nearestNebula,
            nearestDebris,
            debrisHazard: this.debrisHazardState,
            universeCounts: this.environment.getCounts(),
            xrActive
        };
    }

    _setupEnvironmentLighting() {
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
        this.scene.environment = environment.texture;
        pmrem.dispose();
    }

    _createInputState() {
        return { keys: new Set(), gamepad: new GamepadInput() };
    }

    _bindEvents() {
        window.addEventListener('resize', () => this._resize());
        window.addEventListener('keydown', (event) => {
            this._unlockAudioFromGesture();

            if (event.code === 'F2') {
                event.preventDefault();
                this.postPanel.toggle();
                // The panel needs the mouse, so drop pointer lock when it opens.
                if (this.postPanel.visible) this._exitPointerLock();
                return;
            }

            if (event.code === 'F10') {
                event.preventDefault();
                this.universePanel.toggle();
                if (this.universePanel.visible) this._exitPointerLock();
                return;
            }

            if (event.code === 'F4') {
                event.preventDefault();
                this.postFxConfig.retro.enabled = !this.postFxConfig.retro.enabled;
                this._applyRuntimeConfig();
                return;
            }

            if (event.code === 'F6') {
                event.preventDefault();
                this.postFxConfig.ascii.enabled = !this.postFxConfig.ascii.enabled;
                this._applyRuntimeConfig();
                return;
            }

            if (event.code === 'F7') {
                event.preventDefault();
                this.postFxConfig.halftone.enabled = !this.postFxConfig.halftone.enabled;
                this._applyRuntimeConfig();
                return;
            }

            if (event.code === 'F3') {
                event.preventDefault();
                this.setDebugMarkersVisible(!this.debugMarkersVisible);
                return;
            }

            if (event.code === 'KeyH') {
                event.preventDefault();
                this.toggleVrHud();
                return;
            }

            if (event.code === 'Digit1') {
                event.preventDefault();
                this._setDebugCameraMode('exterior');
                return;
            }

            if (event.code === 'Digit2') {
                event.preventDefault();
                this._setDebugCameraMode('interior');
                return;
            }

            // Return to the first-person player camera from a debug free camera.
            if (event.code === 'KeyV') {
                event.preventDefault();
                this._enterPlayerMode();
                return;
            }

            if (event.code === 'KeyP') {
                event.preventDefault();
                this.ship.replayStartSequence();
                this.audio.playCue('shipStartup');
                return;
            }

            if (event.code === 'KeyL') {
                event.preventDefault();
                const looping = this.ship.toggleAnimationLoop();
                console.info('Ship start sequence loop:', looping);
                return;
            }

            // Phase 4: C is the contextual interact (take / leave the controls,
            // exit / enter the airlock), edge-triggered so a held key fires once.
            if (event.code === 'KeyC') {
                event.preventDefault();
                if (!event.repeat && this.cameraMode === 'player') {
                    this.playerController.interact();
                    this._syncDebugDomState();
                }
                return;
            }

            // Z toggles inertial dampeners (a flight assist). Movement keys fall
            // through to input.keys below so locomotion / ShipControls can read them.
            if (event.code === 'KeyZ') {
                if (this.shipControls.handleToggleKey('KeyZ') === 'dampeners') {
                    event.preventDefault();
                    this._syncDebugDomState();
                }
                return;
            }

            // Space toggles hyperdrive (PRECISION <-> HYPERDRIVE gear).
            if (event.code === 'Space') {
                event.preventDefault();
                if (!event.repeat && (this.postFxConfig.hyperdrive?.enabled ?? true)) {
                    if (this.shipControls.handleToggleKey('Space') === 'hyperdrive') {
                        this._onHyperdriveToggled();
                    }
                }
                return;
            }

            // Stop arrow keys from scrolling the page while flying/free-looking.
            if (event.code.startsWith('Arrow')) {
                event.preventDefault();
            }

            this.input.keys.add(event.code);
        });
        window.addEventListener('keyup', (event) => {
            this.input.keys.delete(event.code);
        });

        // Pointer lock for first-person mouse look (player mode only). Clicking
        // the canvas grabs the mouse; Esc (browser default) or opening F2 frees it.
        this.canvas.addEventListener('pointerdown', () => this._unlockAudioFromGesture(), { passive: true });
        this.canvas.addEventListener('click', () => {
            this._unlockAudioFromGesture();
            if (this.cameraMode === 'player' && !this.postPanel.visible && !this.universePanel.visible) {
                this.canvas.requestPointerLock?.();
            }
        });
        window.addEventListener('mousemove', (event) => {
            if (this.cameraMode !== 'player') return;
            if (document.pointerLockElement !== this.canvas) return;
            this.playerController.applyMouseLook(event.movementX, event.movementY);
        });
    }

    _unlockAudioFromGesture() {
        this.audio?.resumeFromUserGesture()
            ?.then(() => this._syncDebugDomState())
            .catch(() => {});
    }

    _exitPointerLock() {
        if (document.pointerLockElement) document.exitPointerLock();
    }

    _enterPlayerMode() {
        this.cameraMode = 'player';
        this.camera.up.set(0, 1, 0);
        // A debug-cam switch can clear the pilot flag; restore it if the player
        // is still seated at the controls.
        this.playerController.syncPilotState();
        this._syncDebugDomState();
    }

    _resize() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
        this.renderPipeline.resize(width, height);
        this.xrVisualEffects.resize(width, height, this.renderer.getPixelRatio());
    }

    _applyRuntimeConfig() {
        // Keep Three's material tone mapping at the F2 baseline. The adaptive
        // multiplier is applied inside the desktop/XR post-FX pipelines so both
        // paths share the same eased eye-adaptation behavior.
        this.renderer.toneMappingExposure = this.postFxConfig.retro.exposure;
        this.ship.setEnvMapIntensity(this.postFxConfig.ship?.envMapIntensity ?? 0.85);
        this.ship.setGlassOpacity(this.postFxConfig.ship?.glassOpacity ?? 0.15);
        this.ship.setBrightness(this.postFxConfig.ship?.brightness ?? 1);
        const xrVisualFx = this.postFxConfig.xrVisualFx ?? {};
        const xrVisualActive = Boolean(
            xrVisualFx.enabled &&
            xrVisualFx.bloomSurrogateEnabled &&
            (this.displayMode === 'vr' || xrVisualFx.previewOnDesktop)
        );
        const sceneGlow = xrVisualActive ? (xrVisualFx.sceneGlow ?? 1) : 1;
        const shipGlow = xrVisualActive ? (xrVisualFx.shipGlow ?? 1) : 1;
        const starGlow = xrVisualActive ? (xrVisualFx.starGlow ?? 1) : 1;
        const nebulaGlow = xrVisualActive ? (xrVisualFx.nebulaGlow ?? 1) : 1;
        const landmarkGlow = xrVisualActive ? (xrVisualFx.landmarkGlow ?? 1) : 1;

        this.ship.setBloom((this.postFxConfig.ship?.bloom ?? 1) * shipGlow);

        this._applyUniverseRuntimeConfig({ sceneGlow, starGlow, nebulaGlow, landmarkGlow });
        this.ship.physics.setAccelerationCap(this.postFxConfig.vrComfort?.accelerationCap ?? 45);
        const hyperdrive = this.postFxConfig.hyperdrive ?? {};
        this.ship.physics.setHyperdriveConfig({
            hyperForwardMult: hyperdrive.hyperForwardMult,
            hyperAccelCap: hyperdrive.accelCap,
            hyperSafetyClamp: hyperdrive.safetyClamp,
            hyperAngularScale: hyperdrive.angularScale
        });
        this.ship.setHyperdriveSpool(hyperdrive.engageTime ?? 0.9, hyperdrive.disengageTime ?? 0.5);
        this.ship.speedLines.setMaxOpacity(this.postFxConfig.vrComfort?.speedLinesMaxOpacity ?? 0.38);
        this.xr.setControllerSpheresVisible(this.postFxConfig.vrComfort?.controllerSpheresVisible ?? true);
        this.xr.setUserScale(this.displayMode === 'vr' ? (this.postFxConfig.vrComfort?.vrUserScale ?? 1) : 1);
        this.xr.setFramebufferScaleFactor(xrVisualFx.framebufferScale ?? 1);
        this.locomotion.setConfig({
            walkSpeed: this.postFxConfig.vrComfort?.walkSpeed ?? 3.2,
            runSpeed: Math.max((this.postFxConfig.vrComfort?.walkSpeed ?? 3.2) * 1.85, 1.4)
        });
        this.playerController.setComfortMode(this.displayMode === 'vr');

        this.renderPipeline.applyConfig(this.postFxConfig);
    }

    _applyUniverseRuntimeConfig({
        sceneGlow = 1,
        starGlow = 1,
        nebulaGlow = 1,
        landmarkGlow = 1
    } = {}) {
        const inGalaxyTier = this.scaleStack?.active?.tier === SCALE_TIERS.galaxy.tier;
        const activeConfig = inGalaxyTier
            ? (this.environment?.baseConfig ?? this.environment?.config ?? this.universeConfig)
            : this.universeConfig;
        const galaxyStarScale = inGalaxyTier ? 0.35 : 1;
        const galaxyBloomScale = inGalaxyTier ? 0.34 : 1;
        const galaxyBackdropScale = inGalaxyTier ? 0.42 : 1;

        this.gravityField.setGravityScale(this.universeConfig.global.gravityScale ?? 1);
        if (this.scene.fog) this.scene.fog.density = activeConfig.global.fogDensity ?? this.universeConfig.global.fogDensity;
        this.camera.far = Math.max(DEEP_SPACE_PRESET.cameraFar, activeConfig.global.regionRadius * 2.4);
        this.camera.updateProjectionMatrix();
        this.environment.setRuntimeConfig({
            global: {
                gravityScale: this.universeConfig.global.gravityScale,
                fogDensity: activeConfig.global.fogDensity ?? this.universeConfig.global.fogDensity
            },
            stars: {
                ...activeConfig.stars,
                opacity: this.universeConfig.stars.opacity * (inGalaxyTier ? 0.86 : 1),
                brightness: activeConfig.stars.brightness * sceneGlow * starGlow * galaxyStarScale,
                bloom: (activeConfig.stars.bloom ?? 1) * galaxyBloomScale
            },
            galaxies: {
                ...activeConfig.galaxies,
                opacity: activeConfig.galaxies.opacity * galaxyBackdropScale,
                brightness: activeConfig.galaxies.brightness * galaxyBackdropScale,
                bloom: (activeConfig.galaxies.bloom ?? 1) * galaxyBloomScale,
                maxGlow: inGalaxyTier ? 1.05 : activeConfig.galaxies.maxGlow
            },
            blackHoles: this.universeConfig.blackHoles,
            nebulae: {
                ...activeConfig.nebulae,
                opacity: this.universeConfig.nebulae.opacity * (inGalaxyTier ? 0.48 : 1),
                brightness: activeConfig.nebulae.brightness * sceneGlow * nebulaGlow * (inGalaxyTier ? 0.36 : 1),
                bloom: (activeConfig.nebulae.bloom ?? 1) * (inGalaxyTier ? 0.42 : 1)
            },
            debris: {
                ...(activeConfig.debris ?? this.universeConfig.debris),
                opacity: this.universeConfig.debris.opacity,
                brightness: this.universeConfig.debris.brightness * sceneGlow,
                driftSpeed: this.universeConfig.debris.driftSpeed,
                hazardIntensity: this.universeConfig.debris.hazardIntensity
            },
            galaxyInterior: inGalaxyTier && activeConfig.galaxyInterior
                ? {
                    ...activeConfig.galaxyInterior,
                    opacity: (activeConfig.galaxyInterior.opacity ?? 0.26) * 0.92,
                    brightness: (activeConfig.galaxyInterior.brightness ?? 0.78) * 0.9,
                    bloom: (activeConfig.galaxyInterior.bloom ?? 0.42) * 0.82,
                    gasOpacity: (activeConfig.galaxyInterior.gasOpacity ?? 0.22) * 1.05,
                    gasBrightness: (activeConfig.galaxyInterior.gasBrightness ?? 0.72) * 0.95,
                    gasBloom: (activeConfig.galaxyInterior.gasBloom ?? 0.28) * 0.88
                }
                : activeConfig.galaxyInterior,
            lighting: this.universeConfig.lighting,
            events: this.universeConfig.events
        });
        this.environment.setVisualGlow({ sceneGlow, landmarkGlow });
    }

    async _loadInitialJsonPreset() {
        try {
            const response = await fetch('./assets/config/post_processing.json');
            if (!response.ok) return;

            const json = await response.json();
            mergeConfig(this.postFxConfig, json);
            this.activePreset = 'custom_json';
            this.postPanel.refresh();
            this._applyRuntimeConfig();
        } catch (error) {
            console.warn('Could not load post_processing.json', error);
        }

        try {
            const response = await fetch('./assets/config/universe.json');
            if (!response.ok) return;

            const json = await response.json();
            mergeConfig(this.universeConfig, json);
            this.activeUniversePreset = 'custom_json';
            this.universePanel.refresh();
            this.regenerateUniverse();
        } catch (error) {
            console.warn('Could not load universe.json', error);
        }
    }

    _installDebugHooks() {
        // Expose the live app so F2-equivalent tweaks can be poked from the
        // console during manual/automated validation (e.g. lower warpMax or
        // gravityScale, then re-apply).
        window.__deepSpaceApp = this;
        window.__deepSpaceDebug = {
            getPostFxState: () => ({
                activePreset: this.activePreset,
                displayMode: this.displayMode,
                bloom: this.postFxConfig.bloom.enabled,
                bloomStrength: this.renderPipeline.desktop.bloomPass.strength,
                warp: this.postFxConfig.warp.enabled,
                retro: this.postFxConfig.retro.enabled,
                autoExposure: this.postFxConfig.autoExposure?.enabled,
                autoExposureState: this.renderPipeline.getState().desktop?.autoExposure,
                ascii: this.postFxConfig.ascii.enabled,
                halftone: this.postFxConfig.halftone.enabled,
                xrPostFx: this.postFxConfig.xrPostFx?.enabled,
                xrBackend: this.renderPipeline.requestedXrBackend,
                activeBackend: this.renderPipeline.activeBackend,
                warpResolution: this.renderPipeline.desktop.warpPass.uniforms.resolution.value.toArray(),
                retroResolution: this.renderPipeline.desktop.retroPass.uniforms.resolution.value.toArray()
            }),
            // --- Phase 06 render pipeline debug surface ---
            getRenderPipelineState: () => this.renderPipeline.getState(),
            getXrPostFxState: () => this.renderPipeline.getXrPostFxState(),
            setXrPostFxBackend: (name) => this.renderPipeline.setXrPostFxBackend(name),
            setXrPostFxEnabled: (enabled) => {
                this.postFxConfig.xrPostFx.enabled = Boolean(enabled);
                const result = this.renderPipeline.setXrPostFxEnabled(enabled);
                this._syncDebugDomState();
                return result;
            },
            // A/B the real XR combined shader on the desktop canvas (no headset).
            setXrPreviewOnDesktop: (enabled) => {
                this.postFxConfig.xrPostFx.previewOnDesktop = Boolean(enabled);
                this.renderPipeline.previewXrOnDesktop = Boolean(enabled);
                this.postPanel.refresh();
                return this.postFxConfig.xrPostFx.previewOnDesktop;
            },
            getDisplayMode: () => this.displayMode,
            getVrState: () => this.xr.getDebugState(),
            getXrVisualFxState: () => this.xrVisualEffects.getDebugState(),
            applyFxPreset: (name) => this.applyFxPreset(name),
            getActivePreset: () => this.activePreset,
            getUniverseState: () => this.environment.getDebugState(this.ship.position),
            getUniverseConfig: () => structuredClone(this.universeConfig),
            getDebrisState: () => ({
                hazard: {
                    ...this.debrisHazardState,
                    acceleration: this.debrisHazardState?.acceleration?.toArray?.() ?? [0, 0, 0]
                },
                counts: this.environment.getCounts(),
                pois: this.environment.getPOIs(this.ship.position, 18)
                    .filter((poi) => poi.type === 'asteroid belt')
                    .map((poi) => ({
                        type: poi.type,
                        name: poi.name,
                        distance: poi.distance,
                        radius: poi.radius
                    }))
            }),

            // --- Nested scale levels (Universe <-> Galaxy) debug surface ---
            getScaleState: () => this.scaleStack.getState(this.ship.position),
            // Descend into the nearest galaxy regardless of distance / speed gate.
            descendNearest: () => this.scaleStack.forceDescend(this.ship.position),
            ascendLevel: () => this.scaleStack.forceAscend(),
            resetToRootLevel: () => this.scaleStack.resetToRoot(),
            applyUniversePreset: (name) => this.applyUniversePreset(name),
            regenerateUniverse: () => this.regenerateUniverse(),
            getAudioState: () => this.audio.getDebugState({
                director: this.audioDirector.getDebugState(),
                state: this._getAudioState({ xrActive: this.xr.isPresenting })
            }),
            setAudioEnabled: (enabled) => {
                const result = this.audio.setEnabled(enabled);
                this._syncDebugDomState();
                return result;
            },
            setAudioBusGain: (bus, value, rampSeconds = 0.12) => this.audio.setBusGain(bus, value, rampSeconds),
            playAudioCue: (id, options = {}) => this.audio.playCue(id, options),
            sayShipAi: (eventId, options = {}) => this.audio.say(eventId, options),
            stopAllAudio: () => this.audio.stopAllAudio(),
            audio: {
                getState: () => this.audio.getDebugState({
                    director: this.audioDirector.getDebugState(),
                    state: this._getAudioState({ xrActive: this.xr.isPresenting })
                }),
                setEnabled: (enabled) => this.audio.setEnabled(enabled),
                setBusGain: (bus, value, rampSeconds = 0.12) => this.audio.setBusGain(bus, value, rampSeconds),
                playCue: (id, options = {}) => this.audio.playCue(id, options),
                sayShipAi: (eventId, options = {}) => this.audio.say(eventId, options),
                stopAll: () => this.audio.stopAllAudio()
            },
            getComfortState: () => ({ ...this.postFxConfig.vrComfort }),
            getDiegeticPanelState: () => this.diegeticPanel.getDebugState(),
            getVrHudState: () => ({
                enabled: this.vrHudVisible,
                visible: this.diegeticPanel.object3D.visible,
                key: 'H'
            }),
            toggleVrHud: () => this.toggleVrHud(),
            toggleEngineFx: () => this.ship.toggleEngineFx(),
            setEngineFxVisible: (visible) => this.ship.setEngineFxVisible(visible),
            setDebugMarkersVisible: (visible) => this.setDebugMarkersVisible(visible),
            toggleDebugMarkers: () => this.setDebugMarkersVisible(!this.debugMarkersVisible),

            // --- Phase 3 ship physics debug surface ---
            getShipMotionState: () => this.ship.getMotionState(),
            getControlsState: () => this.shipControls.getState(),
            getGamepadState: () => this.input.gamepad.getDebugState(),
            setGamepadEnabled: (enabled) => {
                this.input.gamepad.setEnabled(enabled);
                this._syncDebugDomState();
                return this.input.gamepad.getDebugState();
            },
            setGamepadDeadzone: (deadzone) => {
                this.input.gamepad.setDeadzone(deadzone);
                this._syncDebugDomState();
                return this.input.gamepad.getDebugState();
            },
            setGamepadLeftDeadzone: (deadzone) => {
                this.input.gamepad.setLeftDeadzone(deadzone);
                this._syncDebugDomState();
                return this.input.gamepad.getDebugState();
            },
            setGamepadRightDeadzone: (deadzone) => {
                this.input.gamepad.setRightDeadzone(deadzone);
                this._syncDebugDomState();
                return this.input.gamepad.getDebugState();
            },
            setPilotActive: (active) => {
                this.shipControls.setPilotActive(active);
                this._onPilotModeChanged();
                return this.shipControls.pilotActive;
            },
            setDampeners: (on) => {
                this.shipControls.dampeners = Boolean(on);
                this._syncDebugDomState();
                return this.shipControls.dampeners;
            },
            // Apply a synthetic command for N seconds without a keyboard (used by
            // automated checks): fly a leg, sample the resulting trajectory.
            sendShipCommand: (command, seconds = 1, step = 1 / 60) => {
                const samples = [];
                let elapsed = 0;
                while (elapsed < seconds) {
                    const dt = Math.min(step, seconds - elapsed);
                    this.ship.update(dt, { active: true, ...command }, this.gravityField);
                    elapsed += dt;
                }
                samples.push(this.ship.getMotionState());
                return samples[samples.length - 1];
            },
            coastShip: (seconds = 1, step = 1 / 60) => {
                let elapsed = 0;
                while (elapsed < seconds) {
                    const dt = Math.min(step, seconds - elapsed);
                    this.ship.update(dt, { active: false }, this.gravityField);
                    elapsed += dt;
                }
                return this.ship.getMotionState();
            },
            getGravityState: () => ({
                gravityScale: this.gravityField.gravityScale,
                attractors: this.gravityField.attractors.map((a) => ({
                    type: a.type,
                    name: a.name,
                    mass: a.mass,
                    position: a.position.toArray()
                })),
                nearest: this.gravityField.nearestAttractor(this.ship.position),
                accelerationHere: this.gravityField
                    .getAcceleration(this.ship.position, new THREE.Vector3())
                    .toArray()
            }),
            haltShip: () => {
                this.ship.physics.halt();
                return this.ship.getMotionState();
            },
            pause: () => {
                this.paused = true;
                return this.paused;
            },
            resume: () => {
                this.paused = false;
                return this.paused;
            },
            isPaused: () => this.paused,
            getWarpSpeedFactor: () => this.renderPipeline.desktop.warpPass.uniforms.speedFactor.value,
            getWarpDistortion: () => this.renderPipeline.desktop.warpPass.uniforms.distortion.value,
            getCameraFov: () => this.camera.fov,
            getSpeedLinesOpacity: () => this.ship.speedLines.material.uniforms.uOpacity.value,
            getSpeedLinesFactor: () => this.ship.speedLines.getSpeedFactor(),

            // --- Phase 08 hyperdrive debug surface ---
            getHyperdriveState: () => ({
                engaged: this.shipControls.hyperdriveEngaged,
                level: this.ship.getHyperdriveLevel(),
                effectiveMult: this.ship.physics.getEffectiveThrustMultiplier(),
                label: this._hyperdriveDriveLabel()
            }),
            setHyperdriveEngaged: (on) => {
                this.shipControls.hyperdriveEngaged = Boolean(on);
                this._syncDebugDomState();
                return this.shipControls.hyperdriveEngaged;
            },
            toggleHyperdrive: () => {
                this.shipControls.handleToggleKey('Space');
                this._syncDebugDomState();
                return this.shipControls.hyperdriveEngaged;
            },

            getShipAnchorNames: () => this.ship.getAnchorNames(),
            getShipAnchorSummary: () => this.ship.getAnchorSummary(),
            validateShipAnchors: () => this.ship.validateAnchors(),
            getShipDimensions: () => this.ship.dimensions,
            getDebugCameraMode: () => this.debugCamera.mode,
            setDebugCameraMode: (mode) => this._setDebugCameraMode(mode),

            // --- Phase 4 player / interior debug surface ---
            getCameraMode: () => this.cameraMode,
            enterPlayerMode: () => {
                this._enterPlayerMode();
                return this.cameraMode;
            },
            getPlayerState: () => this.playerController.getDebugState(),
            getPlayerWorldPosition: () => this.playerRig.worldPosition.toArray(),
            getWalkableVolumes: () => this.locomotion.volumes.map((v) => ({ ...v })),
            playerInteract: () => this.playerController.interact(),
            setPlayerShipLocalPosition: (arr) => {
                this.playerRig.setShipLocalPosition(new THREE.Vector3().fromArray(arr));
                this.locomotion.clampInside(this.playerRig.position);
                return this.playerController.getDebugState();
            },
            // Drive the player with synthetic held keys for N seconds, ship-local,
            // to validate relative locomotion + collision without a keyboard.
            walkPlayer: (keyList = [], seconds = 1, step = 1 / 60) => {
                const keys = new Set(keyList);
                let elapsed = 0;
                while (elapsed < seconds) {
                    const dt = Math.min(step, seconds - elapsed);
                    this.playerController.update(dt, keys);
                    elapsed += dt;
                }
                return this.playerController.getDebugState();
            }
        };

        this._syncDebugDomState();
    }

    _onPilotModeChanged() {
        if (this.shipControls.pilotActive) {
            // Remember the free-fly mode so we can restore it on disengage.
            this.debugCamera.freeMode = this.debugCamera.mode === 'interior' ? 'interior' : 'exterior';
            this.debugCamera.mode = 'pilot';
        } else {
            this.debugCamera.mode = this.debugCamera.freeMode;
        }

        this._syncDebugDomState();
    }

    _setDebugCameraMode(mode) {
        if (mode !== 'exterior' && mode !== 'interior') return false;

        // Switching to a free camera also leaves pilot mode so the movement keys
        // are not fought over by the chase cam and the free cam at once, and drops
        // pointer lock so the mouse is free for the debug view (press V to return
        // to the first-person player camera).
        this.cameraMode = 'debug';
        this._exitPointerLock();
        this.shipControls.setPilotActive(false);
        this.camera.up.set(0, 1, 0);
        this.debugCamera.freeMode = mode;
        this.debugCamera.mode = mode;

        if (mode === 'interior') {
            const mount = this.ship.getAnchorLocalPosition('cameraDebugMount');
            if (mount) this.debugCamera.interiorLocalPosition.copy(mount);
        }

        this._syncDebugDomState();
        return true;
    }

    _syncDebugDomState() {
        const state = {
            displayMode: this.displayMode,
            activePreset: this.activePreset,
            vrHudVisible: this.vrHudVisible,
            cameraMode: this.debugCamera.mode,
            scale: this.scaleStack?.getState(this.ship.position) ?? null,
            pilotActive: this.shipControls.pilotActive,
            dampeners: this.shipControls.dampeners,
            hyperdriveEngaged: this.shipControls.hyperdriveEngaged,
            hyperdriveLevel: this.ship.getHyperdriveLevel(),
            audio: this.audio
                ? {
                    enabled: this.audio.enabled,
                    unlocked: this.audio.unlocked,
                    contextState: this.audio.context.state,
                    loadedBufferCount: this.audio.buffers.size,
                    activeLoops: [...this.audio.loops.values()]
                        .filter((loop) => loop.started || loop.starting || loop.stopping)
                        .map((loop) => loop.entry.id)
                }
                : null,
            xr: this.xr?.getDebugState?.(),
            renderPipeline: this.renderPipeline?.getState?.(),
            gamepad: this.input.gamepad.getDebugState(),
            shipAnchors: this.ship.getAnchorNames(),
            anchorValidation: this.ship.validateAnchors(),
            shipDimensions: this.ship.dimensions,
            shipAnchorSummary: this.ship.getAnchorSummary()
        };

        let node = document.querySelector('#deep-space-debug-state');
        if (!node) {
            node = document.createElement('script');
            node.id = 'deep-space-debug-state';
            node.type = 'application/json';
            document.head.appendChild(node);
        }

        node.textContent = JSON.stringify(state);
    }
}

function mergeConfig(target, source) {
    for (const [key, value] of Object.entries(source)) {
        if (value && typeof value === 'object' && !Array.isArray(value) && target[key]) {
            mergeConfig(target[key], value);
        } else {
            target[key] = value;
        }
    }
}

function replaceConfig(target, source) {
    for (const key of Object.keys(target)) delete target[key];
    mergeConfig(target, structuredClone(source));
}
