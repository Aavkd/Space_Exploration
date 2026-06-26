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
import { DiegeticNavigationPanel } from '../ui/DiegeticNavigationPanel.js';
import { DiegeticRadioPanel } from '../ui/DiegeticRadioPanel.js';
import { UniverseNavigation } from '../ui/UniverseNavigation.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { AudioDirector } from '../audio/AudioDirector.js';
import { createRpgRuntime, LocalRpgPersistence } from '../rpg/index.js';

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
            locomotion: this.locomotion,
            getSurfaceProvider: () => this.environment?.getSurfaceSample ? this.environment : null,
            getSurfaceParent: () => this.environment?.getSurfaceSample ? this.environment.group : null
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

        this.diegeticNavPanel = new DiegeticNavigationPanel();
        const navAnchor = this.ship.getAnchor('navigationStation');
        if (navAnchor) {
            navAnchor.add(this.diegeticNavPanel.object3D);
            this.diegeticNavPanel.object3D.position.set(0, 0, -0.4);
            const marker = navAnchor.getObjectByName('navigationStationMarker');
            if (marker) {
                marker.visible = false;
            }
        }

        this.diegeticRadioPanel = new DiegeticRadioPanel();
        const radioAnchor = this.ship.getAnchor('radioStation');
        if (radioAnchor) {
            radioAnchor.add(this.diegeticRadioPanel.object3D);
            this.diegeticRadioPanel.object3D.position.set(0, 0, -0.4);
            const marker = radioAnchor.getObjectByName('radioStationMarker');
            if (marker) {
                marker.visible = false;
            }
        }
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
        this.activeUniversePreset = 'default';
        this.commsPanelOpen = false;
        this.selectedNavigationTarget = null;
        this.navigationPanelOpen = false;
        this.radioOpen = false;
        this.radioPower = true;
        this.radioVolume = 0.5;
        this.activeRadioStationIndex = 0;
        this.radioStations = [
            { frequency: '89.5 MHz', name: 'Cosmic Static', loopId: 'spaceBedB', baseGain: 1.0, isStatic: true },
            { frequency: '95.4 MHz', name: 'Deep Space Chords', loopId: 'spaceChords', baseGain: 2.0, isStatic: false },
            { frequency: '101.2 MHz', name: 'Alien Beacon', loopId: 'longSignal', baseGain: 1.2, isStatic: false },
            { frequency: '106.8 MHz', name: 'Pulsar Beep', loopId: 'signal2', baseGain: 1.2, isStatic: false }
        ];
        this._createTelemetryHud();
        this._bindEvents();
        this.rpgError = null;
        this.rpg = this._createRpgRuntimeSafely();
        this._installDebugHooks();
        this._applyRuntimeConfig();
        this._loadInitialJsonPreset();
        this._syncActiveRpgSystem();
        this._loadCustomRadioStations();
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
            displayMode: this.displayMode,
            pilotActive: this.shipControls.pilotActive,
            selectedTarget: this.selectedNavigationTarget,
            ship: this.ship
        });
        this.diegeticNavPanel.update({
            pois: this.environment.getPOIs(this.ship.position, 8),
            selectedTarget: this.selectedNavigationTarget
        });
        this.diegeticRadioPanel.update({
            power: this.radioPower,
            currentStation: this.radioStations[this.activeRadioStationIndex],
            volume: this.radioVolume,
            dt
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
                if (action === 'openComms') this._openCommsPanel();
                else if (action === 'openNavigation') this._openNavigationPanel();
                else if (action === 'openRadio') this._openRadioPanel();
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

    // Floating-origin rebase: pin the active traversal entity near the scene
    // origin. In flight/interior modes that is the ship; on foot it is the
    // surface player feet while the parked ship shifts with the rest of the
    // scene.
    _maybeRebaseOrigin({ force = false } = {}) {
        const surfaceActive = this.playerController.getState() === PLAYER_STATE.SURFACE;
        const offset = surfaceActive
            ? this.playerRig.object3D.getWorldPosition(new THREE.Vector3())
            : this.ship.position.clone();
        if (!force && offset.lengthSq() < FLOAT_ORIGIN_THRESHOLD_SQ) return false;

        if (surfaceActive) {
            this._moveObjectWorldBy(this.playerRig.object3D, offset.clone().negate());
            this.ship.object3D.position.sub(offset);
        } else {
            this.ship.object3D.position.set(0, 0, 0);
        }

        // Shift the active navigation target coordinate by the rebase offset
        if (this.selectedNavigationTarget && this.selectedNavigationTarget.position) {
            this.selectedNavigationTarget.position.sub(offset);
        }

        // Rebase runs in the active level's frame only (dormant ancestors keep
        // their frozen frame so an ascent can restore the ship there).
        this.scaleStack.rebaseOrigin(offset);
        this.gravityField.setAttractors(this.environment.getAttractors());
        return true;
    }

    _moveObjectWorldBy(object, delta) {
        const world = object.getWorldPosition(new THREE.Vector3()).add(delta);
        const parent = object.parent;
        if (parent) {
            parent.updateWorldMatrix(true, false);
            object.position.copy(parent.worldToLocal(world));
        } else {
            object.position.copy(world);
        }
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
        this._syncActiveRpgSystem();
        this._syncDebugDomState();
    }

    _syncActiveRpgSystem() {
        if (!this.rpg || !this.scaleStack) return false;
        try {
            this.rpg.setActiveNamedSystem(this._findActiveRpgNamedSystemId());
            return true;
        } catch (error) {
            this._recordRpgError('named-system sync', error);
            return false;
        }
    }

    _findActiveRpgNamedSystemId() {
        for (let i = this.scaleStack.stack.length - 1; i >= 0; i--) {
            const rpg = this.scaleStack.stack[i]?.universe?.anchor?.rpg;
            if (rpg?.namedSystemId) return rpg.namedSystemId;
        }
        return null;
    }

    _createRpgRuntimeSafely() {
        try {
            return createRpgRuntime();
        } catch (error) {
            this._recordRpgError('persistent runtime initialization', error);
        }

        try {
            return createRpgRuntime({
                persistence: new LocalRpgPersistence({ storage: null })
            });
        } catch (error) {
            this._recordRpgError('in-memory runtime initialization', error);
            return null;
        }
    }

    _recordRpgError(context, error) {
        const message = error instanceof Error ? error.message : String(error);
        this.rpgError = {
            context,
            message,
            occurredAt: new Date().toISOString()
        };
        console.error(`RPG ${context} failed; core simulation will continue.`, error);
        return this.rpgError;
    }

    _getRpgDebugState() {
        if (!this.rpg) {
            return {
                available: false,
                error: this.rpgError
            };
        }

        try {
            return {
                available: true,
                ...this.rpg.getSummary(),
                comms: this.rpg.getCommsState(),
                error: this.rpgError
            };
        } catch (error) {
            return {
                available: false,
                error: this._recordRpgError('debug-state sync', error)
            };
        }
    }

    // Debug: jump the ship to a given altitude over a quadtree planet, then rebase
    // so it sits back near the scene origin (the §4 working state). No-op on
    // levels without a quadtree planet.
    _teleportShipAltitude(metres = 1000) {
        const state = this.environment.teleportShipAltitude?.(this.ship, metres);
        if (!state) return null;
        this._maybeRebaseOrigin();
        this._syncDebugDomState();
        return state;
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
            if (action === 'openComms') this._openCommsPanel();
            else if (action === 'openNavigation') this._openNavigationPanel();
            else if (action === 'openRadio') this._openRadioPanel();
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

        this._createCommsPanel();
        this._createNavigationPanel();
        this._createRadioPanel();
    }

    _createCommsPanel() {
        const panel = document.createElement('div');
        panel.id = 'cockpit-comms-panel';
        panel.innerHTML = `
            <style>
                #cockpit-comms-panel {
                    position: fixed;
                    right: 18px;
                    top: 72px;
                    width: min(420px, calc(100vw - 36px));
                    max-height: calc(100vh - 116px);
                    overflow: auto;
                    padding: 14px;
                    background: rgba(3, 9, 20, 0.9);
                    border: 1px solid rgba(135, 210, 255, 0.42);
                    border-radius: 4px;
                    color: #dff0ff;
                    font: 13px/1.45 "Consolas", "Courier New", monospace;
                    letter-spacing: 0;
                    text-shadow: 0 0 10px rgba(120, 180, 255, 0.45);
                    box-shadow: 0 0 28px rgba(70, 150, 255, 0.16);
                    pointer-events: auto;
                    z-index: 12;
                    display: none;
                }
                #cockpit-comms-panel .comms-head {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    margin-bottom: 10px;
                }
                #cockpit-comms-panel .comms-title {
                    color: #9bdcff;
                    font-size: 13px;
                    font-weight: bold;
                    letter-spacing: 0.06em;
                    text-transform: uppercase;
                }
                #cockpit-comms-panel .comms-subtle {
                    color: rgba(210, 232, 255, 0.68);
                    font-size: 12px;
                }
                #cockpit-comms-panel .comms-contact {
                    margin: 10px 0;
                    padding: 10px;
                    border: 1px solid rgba(135, 210, 255, 0.22);
                    border-radius: 4px;
                    background: rgba(15, 35, 62, 0.42);
                }
                #cockpit-comms-panel .comms-speaker {
                    color: #74ffb0;
                    font-weight: bold;
                    margin-bottom: 6px;
                }
                #cockpit-comms-panel .comms-text {
                    margin: 8px 0 12px;
                    color: #e9f5ff;
                }
                #cockpit-comms-panel button {
                    color: #dff0ff;
                    background: rgba(36, 74, 112, 0.72);
                    border: 1px solid rgba(155, 220, 255, 0.42);
                    border-radius: 4px;
                    padding: 7px 9px;
                    font: inherit;
                    text-align: left;
                    cursor: pointer;
                }
                #cockpit-comms-panel button:hover,
                #cockpit-comms-panel button:focus {
                    background: rgba(54, 105, 150, 0.88);
                    outline: none;
                }
                #cockpit-comms-panel .comms-close {
                    min-width: 32px;
                    text-align: center;
                    padding: 5px 8px;
                }
                #cockpit-comms-panel .comms-actions {
                    display: grid;
                    gap: 8px;
                    margin-top: 10px;
                }
                #cockpit-comms-panel .comms-status {
                    margin-top: 10px;
                    color: #ffcf8c;
                }
            </style>
            <div data-comms-content></div>
        `;
        document.body.appendChild(panel);
        this.commsPanel = panel;
        this.commsContentNode = panel.querySelector('[data-comms-content]');
        panel.addEventListener('click', (event) => {
            const target = event.target.closest('[data-comms-action]');
            if (!target) return;
            event.preventDefault();
            const action = target.dataset.commsAction;
            const id = target.dataset.commsId;
            if (action === 'close') this._closeCommsPanel();
            else if (action === 'start') this._startCommsConversation(id);
            else if (action === 'choose') this._chooseCommsDialogue(id);
        });
    }

    _openCommsPanel(contactId = null) {
        this.commsPanelOpen = true;
        if (contactId) this.rpg.startConversation(contactId);
        this._exitPointerLock();
        this._updateCommsPanel();
        this._syncDebugDomState();
        return this.rpg.getCommsState();
    }

    _closeCommsPanel() {
        this.commsPanelOpen = false;
        this.rpg.exitConversation();
        this._updateCommsPanel();
        this._syncDebugDomState();
        return this.rpg.getCommsState();
    }

    _startCommsConversation(contactId) {
        const state = this.rpg.startConversation(contactId);
        this.commsPanelOpen = true;
        this._updateCommsPanel();
        this._syncDebugDomState();
        return state;
    }

    _chooseCommsDialogue(choiceId) {
        const state = this.rpg.chooseDialogue(choiceId);
        this.commsPanelOpen = true;
        this._updateCommsPanel();
        this._syncDebugDomState();
        return state;
    }

    _handleCommsKeydown(event) {
        if (!this.commsPanelOpen) return false;
        if (event.code === 'Escape' || event.code === 'KeyC') {
            event.preventDefault();
            this._closeCommsPanel();
            return true;
        }
        if (event.code === 'Enter') {
            const state = this.rpg.getCommsState();
            const first = state.availableContacts[0];
            if (!state.activeContact && first) {
                event.preventDefault();
                this._startCommsConversation(first.id);
                return true;
            }
        }
        if (/^Digit[1-9]$/.test(event.code)) {
            const index = Number(event.code.slice(5)) - 1;
            const choice = this.rpg.getCommsState().visibleChoices[index];
            if (choice) {
                event.preventDefault();
                this._chooseCommsDialogue(choice.id);
                return true;
            }
        }
        return false;
    }

    _updateCommsPanel() {
        if (!this.commsPanel || !this.commsContentNode) return;
        this.commsPanel.style.display = this.commsPanelOpen ? 'block' : 'none';
        if (!this.commsPanelOpen) return;

        const state = this.rpg.getCommsState();
        const active = state.activeContact;
        const available = state.availableContacts;
        const systemLabel = state.activeNamedSystemId ?? 'no authored system';
        const lines = [
            '<div class="comms-head">',
            '<div>',
            '<div class="comms-title">Cockpit Comms</div>',
            `<div class="comms-subtle">Context: ${escapeHtml(systemLabel)}</div>`,
            '</div>',
            '<button class="comms-close" data-comms-action="close" title="Close comms">X</button>',
            '</div>'
        ];

        if (!active) {
            if (available.length === 0) {
                lines.push('<div class="comms-status">No reachable contacts on this frequency.</div>');
            } else {
                lines.push('<div class="comms-subtle">Reachable contacts</div>');
                for (const contact of available) {
                    lines.push(
                        '<div class="comms-contact">',
                        `<div class="comms-speaker">${escapeHtml(contact.name)}</div>`,
                        `<div class="comms-subtle">${escapeHtml(contact.title)} / ${escapeHtml(contact.factionId)}</div>`,
                        '<div class="comms-actions">',
                        `<button data-comms-action="start" data-comms-id="${escapeHtml(contact.id)}">Open hail</button>`,
                        '</div>',
                        '</div>'
                    );
                }
                lines.push('<div class="comms-subtle">Press Enter to hail the first contact.</div>');
            }
            this.commsContentNode.innerHTML = lines.join('');
            return;
        }

        lines.push(
            '<div class="comms-contact">',
            `<div class="comms-speaker">${escapeHtml(active.name)}</div>`,
            `<div class="comms-subtle">${escapeHtml(active.title)} / ${escapeHtml(active.factionId)}</div>`,
            `<div class="comms-text">${escapeHtml(active.node.text)}</div>`,
            '</div>'
        );

        lines.push('<div class="comms-actions">');
        state.visibleChoices.forEach((choice, index) => {
            lines.push(
                `<button data-comms-action="choose" data-comms-id="${escapeHtml(choice.id)}">`,
                `${index + 1}. ${escapeHtml(choice.label)}`,
                '</button>'
            );
        });
        lines.push('</div>');

        const llm = state.llmFlavor;
        lines.push(
            '<div class="comms-status">',
            `LLM flavor gate: ${llm.enabled ? 'stub enabled' : 'disabled'} / ${escapeHtml(llm.source)} / no authority`,
            '</div>'
        );
        this.commsContentNode.innerHTML = lines.join('');
    }

    _createNavigationPanel() {
        const panel = document.createElement('div');
        panel.id = 'cockpit-navigation-panel';
        panel.innerHTML = `
            <style>
                #cockpit-navigation-panel {
                    position: fixed;
                    left: 18px;
                    top: 72px;
                    width: min(420px, calc(100vw - 36px));
                    max-height: calc(100vh - 116px);
                    overflow: auto;
                    padding: 14px;
                    background: rgba(3, 9, 20, 0.9);
                    border: 1px solid rgba(135, 210, 255, 0.42);
                    border-radius: 4px;
                    color: #dff0ff;
                    font: 13px/1.45 "Consolas", "Courier New", monospace;
                    letter-spacing: 0;
                    text-shadow: 0 0 10px rgba(120, 180, 255, 0.45);
                    box-shadow: 0 0 28px rgba(70, 150, 255, 0.16);
                    pointer-events: auto;
                    z-index: 12;
                    display: none;
                }
                #cockpit-navigation-panel .nav-head {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    margin-bottom: 12px;
                    border-bottom: 1px solid rgba(135, 210, 255, 0.22);
                    padding-bottom: 6px;
                }
                #cockpit-navigation-panel .nav-title {
                    color: #9bdcff;
                    font-size: 13px;
                    font-weight: bold;
                    letter-spacing: 0.06em;
                    text-transform: uppercase;
                }
                #cockpit-navigation-panel .nav-item {
                    margin: 8px 0;
                    padding: 8px 10px;
                    border: 1px solid rgba(135, 210, 255, 0.22);
                    border-radius: 4px;
                    background: rgba(15, 35, 62, 0.42);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                #cockpit-navigation-panel .nav-item.active {
                    border-color: rgba(116, 255, 176, 0.6);
                    background: rgba(20, 70, 45, 0.52);
                }
                #cockpit-navigation-panel .nav-name {
                    color: #e9f5ff;
                    font-weight: bold;
                }
                #cockpit-navigation-panel .nav-item.active .nav-name {
                    color: #74ffb0;
                }
                #cockpit-navigation-panel button {
                    color: #dff0ff;
                    background: rgba(36, 74, 112, 0.72);
                    border: 1px solid rgba(155, 220, 255, 0.42);
                    border-radius: 4px;
                    padding: 5px 8px;
                    font: inherit;
                    cursor: pointer;
                }
                #cockpit-navigation-panel button:hover,
                #cockpit-navigation-panel button:focus {
                    background: rgba(54, 105, 150, 0.88);
                    outline: none;
                }
                #cockpit-navigation-panel button.active-btn {
                    background: rgba(40, 140, 80, 0.88);
                    border-color: rgba(116, 255, 176, 0.6);
                    color: #74ffb0;
                }
                #cockpit-navigation-panel .nav-close {
                    min-width: 32px;
                    text-align: center;
                    padding: 5px 8px;
                }
                #cockpit-navigation-panel .nav-list {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    margin-top: 10px;
                }
            </style>
            <div data-nav-content></div>
        `;
        document.body.appendChild(panel);
        this.navigationPanel = panel;
        this.navigationContentNode = panel.querySelector('[data-nav-content]');
        panel.addEventListener('click', (event) => {
            const target = event.target.closest('[data-nav-action]');
            if (!target) return;
            event.preventDefault();
            const action = target.dataset.navAction;
            const index = Number(target.dataset.navIndex);
            if (action === 'close') this._closeNavigationPanel();
            else if (action === 'select') this._selectNavigationTargetByIndex(index);
        });
    }

    _createRadioPanel() {
        const panel = document.createElement('div');
        panel.id = 'cockpit-radio-panel';
        panel.innerHTML = `
            <style>
                #cockpit-radio-panel {
                    position: fixed;
                    left: 18px;
                    top: 72px;
                    width: min(420px, calc(100vw - 36px));
                    max-height: calc(100vh - 116px);
                    overflow: auto;
                    padding: 14px;
                    background: rgba(18, 9, 0, 0.92);
                    border: 1px solid rgba(255, 140, 0, 0.42);
                    border-radius: 4px;
                    color: #ffd08c;
                    font: 13px/1.45 "Consolas", "Courier New", monospace;
                    letter-spacing: 0;
                    text-shadow: 0 0 10px rgba(255, 120, 0, 0.45);
                    box-shadow: 0 0 28px rgba(255, 100, 0, 0.16);
                    pointer-events: auto;
                    z-index: 12;
                    display: none;
                }
                #cockpit-radio-panel .radio-head {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    margin-bottom: 12px;
                    border-bottom: 1px solid rgba(255, 140, 0, 0.22);
                    padding-bottom: 6px;
                }
                #cockpit-radio-panel .radio-title {
                    color: #ff9c00;
                    font-size: 14px;
                    font-weight: bold;
                    text-transform: uppercase;
                    letter-spacing: 0.06em;
                }
                #cockpit-radio-panel .radio-close {
                    min-width: 32px;
                    text-align: center;
                    padding: 5px 8px;
                }
                #cockpit-radio-panel .radio-body {
                    display: flex;
                    flex-direction: column;
                    gap: 14px;
                    margin-top: 10px;
                }
                #cockpit-radio-panel .radio-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 6px 10px;
                    border: 1px solid rgba(255, 140, 0, 0.15);
                    border-radius: 4px;
                    background: rgba(30, 15, 0, 0.32);
                }
                #cockpit-radio-panel .radio-label {
                    font-weight: bold;
                    color: #ffb000;
                }
                #cockpit-radio-panel .radio-controls {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                #cockpit-radio-panel .radio-value {
                    font-weight: bold;
                    min-width: 90px;
                    text-align: center;
                    color: #fff0d0;
                }
                #cockpit-radio-panel button {
                    color: #fff0d0;
                    background: rgba(80, 35, 0, 0.6);
                    border: 1px solid rgba(255, 140, 0, 0.42);
                    border-radius: 4px;
                    padding: 5px 10px;
                    font: inherit;
                    cursor: pointer;
                    text-transform: uppercase;
                }
                #cockpit-radio-panel button:hover,
                #cockpit-radio-panel button:focus {
                    background: rgba(120, 50, 0, 0.8);
                    outline: none;
                }
                #cockpit-radio-panel button.power-active {
                    background: rgba(140, 60, 0, 0.88);
                    border-color: rgba(255, 156, 0, 0.8);
                    color: #fff;
                }
                #cockpit-radio-panel button.power-inactive {
                    background: rgba(40, 20, 0, 0.6);
                    border-color: rgba(255, 100, 0, 0.3);
                    color: #ff7000;
                }
            </style>
            <div data-radio-content></div>
        `;
        document.body.appendChild(panel);
        this.radioPanel = panel;
        this.radioContentNode = panel.querySelector('[data-radio-content]');
        panel.addEventListener('click', (event) => {
            const target = event.target.closest('[data-radio-action]');
            if (!target) return;
            event.preventDefault();
            const action = target.dataset.radioAction;
            if (action === 'close') this._closeRadioPanel();
            else if (action === 'power') this._toggleRadioPower();
            else if (action === 'tune-prev') this._tuneRadio(-1);
            else if (action === 'tune-next') this._tuneRadio(1);
            else if (action === 'vol-down') this._adjustRadioVolume(-0.1);
            else if (action === 'vol-up') this._adjustRadioVolume(0.1);
        });
    }

    _openRadioPanel() {
        this.radioOpen = true;
        this._exitPointerLock();
        this._updateRadioPanel();
        this._syncRadioAudio();
        this._syncDebugDomState();
    }

    _closeRadioPanel() {
        this.radioOpen = false;
        this._updateRadioPanel();
        this._syncDebugDomState();
    }

    _toggleRadioPower() {
        this.radioPower = !this.radioPower;
        this._updateRadioPanel();
        this._syncRadioAudio();
    }

    _tuneRadio(dir) {
        if (!this.radioPower) return;
        this.activeRadioStationIndex = (this.activeRadioStationIndex + dir + this.radioStations.length) % this.radioStations.length;
        this._updateRadioPanel();
        this._syncRadioAudio();
    }

    _adjustRadioVolume(amount) {
        if (!this.radioPower) return;
        this.radioVolume = Math.max(0, Math.min(1, this.radioVolume + amount));
        this._updateRadioPanel();
        this._syncRadioAudio();
    }

    _syncRadioAudio() {
        if (!this.audio || !this.audio.enabled) return;
        const activeStation = this.radioStations[this.activeRadioStationIndex];

        if (this.radioPower) {
            // First stop any loop-based stations that are not active
            this.radioStations.forEach((station, idx) => {
                if (idx !== this.activeRadioStationIndex) {
                    if (station.loopId) {
                        this.audio.stopLoop(station.loopId, { fadeSeconds: 0.5 });
                    }
                }
            });

            // Now handle the active station
            if (activeStation.loopId) {
                // Stop playlist player if it's active
                if (this.audio.playlistPlayer) {
                    this.audio.playlistPlayer.stop();
                }
                const gain = this.radioVolume * activeStation.baseGain;
                this.audio.startLoop(activeStation.loopId, { gain, fadeSeconds: 0.5 });
                this.audio.setLoopGain(activeStation.loopId, gain, 0.15);
            } else if (activeStation.isCustom) {
                // Play custom station
                if (this.audio.playlistPlayer) {
                    this.audio.playlistPlayer.playStation(activeStation, this.radioVolume);
                }
            }
        } else {
            // Stop all loops
            this.radioStations.forEach((station) => {
                if (station.loopId) {
                    this.audio.stopLoop(station.loopId, { fadeSeconds: 0.5 });
                }
            });
            // Stop custom playlist player
            if (this.audio.playlistPlayer) {
                this.audio.playlistPlayer.stop();
            }
        }
    }

    async _loadCustomRadioStations() {
        try {
            const response = await fetch('./assets/audio/custom_radios/manifest.json');
            if (!response.ok) {
                console.warn('Custom radio manifest.json not found. Continuing with default stations.');
                return;
            }
            const data = await response.json();
            if (Array.isArray(data)) {
                const validCustomStations = data.filter(station => station.tracks && station.tracks.length > 0);
                const nowTime = this.audio && this.audio.context ? this.audio.context.currentTime : 0;

                validCustomStations.forEach((station) => {
                    const freq = this._generateStationFrequency(station.name || station.folder);
                    
                    const randomTrackIndex = Math.floor(Math.random() * station.tracks.length);
                    const randomPlayhead = Math.random() * 60; // random start offset between 0-60s
                    
                    this.radioStations.push({
                        frequency: `${freq.toFixed(1)} MHz`,
                        name: station.name || station.folder,
                        folder: station.folder,
                        tracks: station.tracks,
                        isCustom: true,
                        isStatic: false,
                        baseGain: 1.0,
                        currentTrackIndex: randomTrackIndex,
                        trackStartTime: nowTime - randomPlayhead,
                        trackDurations: {},
                        playhead: randomPlayhead
                    });
                });

                // Keep the current station active if possible, or default to 0
                const currentStation = this.radioStations[this.activeRadioStationIndex];

                // Sort stations by frequency so tuning moves in order across the dial
                this.radioStations.sort((a, b) => parseFloat(a.frequency) - parseFloat(b.frequency));

                if (currentStation) {
                    const newIndex = this.radioStations.findIndex(s => s.frequency === currentStation.frequency);
                    if (newIndex !== -1) {
                        this.activeRadioStationIndex = newIndex;
                    } else {
                        this.activeRadioStationIndex = 0;
                    }
                } else {
                    this.activeRadioStationIndex = 0;
                }

                // Sync the UI if it's currently open
                if (this.radioOpen) {
                    this._updateRadioPanel();
                }
            }
        } catch (error) {
            console.error('Failed to load custom radio stations manifest:', error);
        }
    }

    _generateStationFrequency(name) {
        // Deterministically map a string to a frequency between 88.0 and 108.0 MHz
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }

        const range = 108.0 - 88.0;
        const steps = Math.floor(range / 0.2); // 100 steps of 0.2 MHz
        const step = Math.abs(hash) % (steps + 1);
        let freq = 88.0 + step * 0.2;

        // Prevent collisions with existing frequencies
        let attempt = 0;
        while (attempt < 50) {
            const freqStr = `${freq.toFixed(1)} MHz`;
            const exists = this.radioStations.some(s => s.frequency === freqStr);
            if (!exists) {
                break;
            }
            freq = 88.0 + ((step + attempt * 2) % (steps + 1)) * 0.2;
            attempt++;
        }

        return freq;
    }

    _updateRadioPanel() {
        if (!this.radioPanel || !this.radioContentNode) return;
        this.radioPanel.style.display = this.radioOpen ? 'block' : 'none';
        if (!this.radioOpen) return;

        const station = this.radioStations[this.activeRadioStationIndex];
        const lines = [
            '<div class="radio-head">',
            '  <div class="radio-title">TRANSCEIVER RX-90</div>',
            '  <button data-radio-action="close" class="radio-close">X</button>',
            '</div>',
            '<div class="radio-body">',
            '  <div class="radio-row">',
            '    <div class="radio-label">POWER</div>',
            `    <button data-radio-action="power" class="${this.radioPower ? 'power-active' : 'power-inactive'}">${this.radioPower ? 'ON' : 'STANDBY'}</button>`,
            '  </div>'
        ];

        if (this.radioPower) {
            lines.push(
                '  <div class="radio-row">',
                '    <div class="radio-label">FREQUENCY</div>',
                '    <div class="radio-controls">',
                '      <button data-radio-action="tune-prev">&lt; TUNE</button>',
                `      <div class="radio-value">${station.frequency}</div>`,
                '      <button data-radio-action="tune-next">TUNE &gt;</button>',
                '    </div>',
                '  </div>',
                '  <div class="radio-row">',
                '    <div class="radio-label">STATION</div>',
                `    <div class="radio-value" style="text-align: right; color: #ffb000;">${station.name.toUpperCase()}</div>`,
                '  </div>',
                '  <div class="radio-row">',
                '    <div class="radio-label">VOLUME</div>',
                '    <div class="radio-controls">',
                '      <button data-radio-action="vol-down">VOL -</button>',
                `      <div class="radio-value">${(this.radioVolume * 100).toFixed(0)}%</div>`,
                '      <button data-radio-action="vol-up">VOL +</button>',
                '    </div>',
                '  </div>'
            );
        } else {
            lines.push(
                '  <div class="radio-row" style="justify-content: center; padding: 20px; color: #ff5400; font-weight: bold;">',
                '    [ SYSTEM STANDBY ]',
                '  </div>'
            );
        }

        lines.push('</div>');
        this.radioContentNode.innerHTML = lines.join('');
    }

    _handleRadioKeydown(event) {
        if (!this.radioOpen) return false;
        if (event.code === 'Escape' || event.code === 'KeyC') {
            event.preventDefault();
            this._closeRadioPanel();
            return true;
        }
        if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
            event.preventDefault();
            this._tuneRadio(-1);
            return true;
        }
        if (event.code === 'ArrowRight' || event.code === 'KeyD') {
            event.preventDefault();
            this._tuneRadio(1);
            return true;
        }
        if (event.code === 'ArrowUp' || event.code === 'KeyW') {
            event.preventDefault();
            this._adjustRadioVolume(0.1);
            return true;
        }
        if (event.code === 'ArrowDown' || event.code === 'KeyS') {
            event.preventDefault();
            this._adjustRadioVolume(-0.1);
            return true;
        }
        if (event.code === 'Space' || event.code === 'KeyP') {
            event.preventDefault();
            this._toggleRadioPower();
            return true;
        }
        return false;
    }

    _openNavigationPanel() {
        this.navigationPanelOpen = true;
        this._exitPointerLock();
        this._updateNavigationPanel();
        this._syncDebugDomState();
    }

    _closeNavigationPanel() {
        this.navigationPanelOpen = false;
        this._updateNavigationPanel();
        this._syncDebugDomState();
    }

    _selectNavigationTargetByIndex(index) {
        const pois = this.environment.getPOIs(this.ship.position, 8);
        const poi = pois[index];
        if (poi) {
            if (this.selectedNavigationTarget && this.selectedNavigationTarget.name === poi.name) {
                this.selectedNavigationTarget = null;
            } else {
                this.selectedNavigationTarget = poi;
            }
            this._updateNavigationPanel();
            this._syncDebugDomState();
        }
    }

    _handleNavigationKeydown(event) {
        if (!this.navigationPanelOpen) return false;
        if (event.code === 'Escape' || event.code === 'KeyC') {
            event.preventDefault();
            this._closeNavigationPanel();
            return true;
        }
        if (/^Digit[1-8]$/.test(event.code)) {
            const index = Number(event.code.slice(5)) - 1;
            event.preventDefault();
            this._selectNavigationTargetByIndex(index);
            return true;
        }
        return false;
    }

    _updateNavigationPanel() {
        if (!this.navigationPanel || !this.navigationContentNode) return;
        this.navigationPanel.style.display = this.navigationPanelOpen ? 'block' : 'none';
        if (!this.navigationPanelOpen) return;

        const pois = this.environment.getPOIs(this.ship.position, 8);
        const lines = [
            '<div class="nav-head">',
            '<div>',
            '<div class="nav-title">Cockpit Navigation Computer</div>',
            '</div>',
            '<button class="nav-close" data-nav-action="close" title="Close console">X</button>',
            '</div>',
            '<div class="nav-list">'
        ];

        pois.forEach((poi, index) => {
            const isSelected = this.selectedNavigationTarget && this.selectedNavigationTarget.name === poi.name;
            const activeClass = isSelected ? ' active' : '';
            const btnClass = isSelected ? ' class="active-btn"' : '';
            const btnLabel = isSelected ? 'LOCKED' : 'LOCK TARGET';
            
            let distStr = '';
            const distance = this.ship.position.distanceTo(poi.position);
            if (distance > 100000) distStr = `${(distance / 1000).toFixed(0)}k`;
            else if (distance > 1000) distStr = `${(distance / 1000).toFixed(1)}k`;
            else distStr = `${distance.toFixed(0)}m`;

            lines.push(
                `<div class="nav-item${activeClass}">`,
                `<div>`,
                `<span style="color: rgba(135,210,255,0.6); margin-right: 8px;">[${index + 1}]</span>`,
                `<span class="nav-name">${escapeHtml(poi.name)}</span>`,
                `<div style="font-size: 11px; color: rgba(210,232,255,0.6); margin-top: 2px;">Distance: ${distStr}</div>`,
                `</div>`,
                `<button${btnClass} data-nav-action="select" data-nav-index="${index}">${btnLabel}</button>`,
                `</div>`
            );
        });

        lines.push('</div>');
        this.navigationContentNode.innerHTML = lines.join('\n');
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
        lines.push(`<b>ANCHOR</b> ${this.playerController.getState() === PLAYER_STATE.SURFACE ? 'PLAYER' : 'SHIP'}`);

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

        const surfaceEva = this.playerController.getSurfaceEvaState?.() ?? null;
        if (surfaceEva) {
            const altitude = surfaceEva.altitude ?? 0;
            const footAlt = Math.abs(altitude) >= 1000
                ? `${(altitude / 1000).toFixed(2)} km`
                : `${altitude.toFixed(2)} m`;
            lines.push(`<b>ON FOOT</b> <span class="on">SURFACE EVA</span>   <b>FEET</b> ${footAlt}`);
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
            xrActive,
            radioPower: this.radioPower
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

            if (this._handleCommsKeydown(event)) return;
            if (this._handleNavigationKeydown(event)) return;
            if (this._handleRadioKeydown(event)) return;

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
                    const action = this.playerController.interact();
                    if (action === 'openComms') this._openCommsPanel();
                    else if (action === 'openNavigation') this._openNavigationPanel();
                    else if (action === 'openRadio') this._openRadioPanel();
                    this._syncDebugDomState();
                }
                return;
            }

            // Phase 5: direct testing shortcut for inside <-> outside EVA.
            if (event.code === 'KeyT') {
                event.preventDefault();
                if (!event.repeat && this.cameraMode === 'player') {
                    this.playerController.teleportEvaToggle?.();
                    this.playerController.updateCamera(this.camera);
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
            if (this.cameraMode === 'player' && !this.postPanel.visible && !this.universePanel.visible && !this.commsPanelOpen && !this.navigationPanelOpen && !this.radioOpen) {
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
        this.playerController.surfaceLocomotion?.setConfig?.({
            walkSpeed: this.postFxConfig.vrComfort?.walkSpeed ?? 3.2,
            runSpeed: Math.max((this.postFxConfig.vrComfort?.walkSpeed ?? 3.2) * 1.7, 1.4)
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
        // A true-radius quadtree planet (Tier 3 rework) needs a far plane sized to
        // its radius, far beyond the universe region; the log depth buffer keeps
        // the 0.1 m near plane usable alongside it (§4). Other levels fall back to
        // the region-derived far.
        const envFar = this.environment?.cameraFar;
        this.camera.far = Math.max(
            DEEP_SPACE_PRESET.cameraFar,
            envFar ?? activeConfig.global.regionRadius * 2.4
        );
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
            getRpgState: () => this.rpg.getState(),
            getActiveNamedSystem: () => this.rpg.getActiveNamedSystem(),
            resetRpgState: () => {
                const state = this.rpg.reset();
                this._syncDebugDomState();
                return state;
            },
            rpg: {
                getState: () => this.rpg.getState(),
                getNamedSystem: (id) => this.rpg.getNamedSystem(id),
                getActiveNamedSystem: () => this.rpg.getActiveNamedSystem(),
                getContacts: () => this.rpg.getContacts(),
                getCommsState: () => this.rpg.getCommsState(),
                getMissions: () => this.rpg.getMissions(),
                getMission: (id) => this.rpg.getMission(id),
                offerMission: (id) => {
                    const result = this.rpg.offerMission(id);
                    this._updateCommsPanel();
                    this._syncDebugDomState();
                    return result;
                },
                acceptMission: (id) => {
                    const result = this.rpg.acceptMission(id);
                    this._updateCommsPanel();
                    this._syncDebugDomState();
                    return result;
                },
                failMission: (id, outcomeId) => {
                    const result = this.rpg.failMission(id, outcomeId);
                    this._updateCommsPanel();
                    this._syncDebugDomState();
                    return result;
                },
                resolveMission: (id, branchId) => {
                    const result = this.rpg.resolveMission(id, branchId);
                    this._updateCommsPanel();
                    this._syncDebugDomState();
                    return result;
                },
                openComms: (contactId = null) => this._openCommsPanel(contactId),
                chooseComms: (choiceId) => this._chooseCommsDialogue(choiceId),
                closeComms: () => this._closeCommsPanel(),
                setCommsLlmFlavorEnabled: (enabled) => {
                    const state = this.rpg.setCommsLlmFlavorEnabled(enabled);
                    this._updateCommsPanel();
                    this._syncDebugDomState();
                    return state;
                },
                getFaction: (id) => this.rpg.getFaction(id),
                getReputation: (id) => this.rpg.getReputation(id),
                setReputation: (id, value, reason) => {
                    const event = this.rpg.setReputation(id, value, reason);
                    this._syncDebugDomState();
                    return event;
                },
                adjustReputation: (id, delta, reason) => {
                    const event = this.rpg.adjustReputation(id, delta, reason);
                    this._syncDebugDomState();
                    return event;
                },
                appendEvent: (type, payload) => {
                    const event = this.rpg.appendEvent(type, payload);
                    this._syncDebugDomState();
                    return event;
                },
                save: () => {
                    const state = this.rpg.save();
                    this._syncDebugDomState();
                    return state;
                },
                reload: () => {
                    const state = this.rpg.reload();
                    this._syncDebugDomState();
                    return state;
                },
                reset: () => {
                    const state = this.rpg.reset();
                    this._syncDebugDomState();
                    return state;
                }
            },
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

            // --- True-radius quadtree planet (Tier 3 rework) debug surface ---
            // (docs/surface-eva-tier.md §13). No-ops on non-quadtree levels.
            getPlanetState: () => this.environment.getPlanetState?.(this.ship.position) ?? null,
            // Run the §4 flat-horizon jitter test at the given altitudes (metres).
            // Default samples ground level and high altitude; returns per-altitude
            // camera-relative vs naive-absolute residual error in metres.
            runPlanetJitterTest: (altitudes) =>
                this.environment.runJitterTest?.(altitudes ? { altitudes } : undefined) ?? null,
            // Jump the ship to a given altitude over the sub-ship point for fast
            // LOD / precision verification on a quadtree planet.
            teleportAltitude: (metres) => this._teleportShipAltitude(metres),
            teleportLatLon: (lat, lon, metres = 1000) =>
                this.environment.teleportShipLatLon?.(this.ship, lat, lon, metres) ?? null,
            findLandingSite: (kind = 'plain') =>
                this.environment.findLandingSite?.(kind) ?? null,
            teleportLandingSite: (kind = 'plain', metres = 1000) =>
                this.environment.teleportLandingSite?.(this.ship, kind, metres) ?? null,
            disembark: (options = {}) => {
                const result = this.playerController.disembark?.(options) ?? false;
                this.playerController.updateCamera(this.camera);
                this._syncDebugDomState();
                return result ? this.playerController.getDebugState() : false;
            },
            boardShip: () => {
                const result = this.playerController.boardShip?.() ?? false;
                this.playerController.updateCamera(this.camera);
                this._syncDebugDomState();
                return result ? this.playerController.getDebugState() : false;
            },
            teleportEvaToggle: () => {
                const action = this.playerController.teleportEvaToggle?.() ?? false;
                this.playerController.updateCamera(this.camera);
                this._syncDebugDomState();
                return { action, player: this.playerController.getDebugState() };
            },
            getSurfaceEvaState: () => this.playerController.getSurfaceEvaState?.() ?? null,
            forceRebaseActiveAnchor: () => {
                const rebased = this._maybeRebaseOrigin({ force: true });
                this.playerController.updateCamera(this.camera);
                this._syncDebugDomState();
                return { rebased, anchor: this._getActiveAnchorState() };
            },
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

        // Short console alias — same object, easier to type during manual testing.
        // Use __deepSpaceDebug or __deepSpaceApp for the full surfaces.
        window.deepSpace = window.__deepSpaceDebug;

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
            // Mirror the true-radius quadtree planet's live state (tile count, max
            // LOD, altitude, centre magnitude) for headless §4 precision checks.
            planet: this.environment?.getPlanetState?.(this.ship.position) ?? null,
            activeAnchor: this._getActiveAnchorState(),
            player: this.playerController.getDebugState?.() ?? null,
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
            rpg: this._getRpgDebugState(),
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

    _getActiveAnchorState() {
        const surfaceActive = this.playerController.getState() === PLAYER_STATE.SURFACE;
        const position = surfaceActive
            ? this.playerRig.object3D.getWorldPosition(new THREE.Vector3())
            : this.ship.position.clone();
        return {
            kind: surfaceActive ? 'player' : 'ship',
            position: position.toArray(),
            distanceFromOrigin: position.length()
        };
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

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
