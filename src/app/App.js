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
import {
    HyperdriveAutopilot,
    isHyperdriveAutopilotTier
} from '../ship/HyperdriveAutopilot.js';
import { PlayerRig } from '../player/PlayerRig.js';
import { RelativeLocomotion } from '../player/RelativeLocomotion.js';
import { PlayerController, PLAYER_STATE } from '../player/PlayerController.js';
import { GamepadInput } from '../input/GamepadInput.js';
import {
    SURFACE_COMBAT_GAMEPAD_FIRE_BUTTON,
    canEquipSurfaceWeaponInPlayerState,
    canToggleCombatModeInPlayerState
} from '../input/combatModeInput.js';
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
import {
    findAuthoredNavigationReplacement,
    findLiveNavigationReplacement,
    navigationTargetBelongsToDepth
} from '../ui/navigationTargetFrame.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { AudioDirector } from '../audio/AudioDirector.js';
import {
    createRpgRuntime,
    BOARDING_DERELICT_ID,
    BOARDING_LIMITS,
    BOARDING_LOG_ID,
    BOARDING_SYSTEM_ID,
    CombatRuntime,
    CrewRuntime,
    DialogueRuntime,
    createConversationVoiceProvider,
    DeliveryRuntime,
    EvaBoardingRuntime,
    EconomyRuntime,
    WorldRuntime,
    MARKET_DEFINITIONS,
    TRADE_GOOD_IDS,
    getCargoDefinition,
    PatrolRuntime,
    ShipConditionRuntime,
    SurfaceCombatRuntime,
    SurfaceOutpostRuntime,
    SURFACE_COMBAT_SITE_ID,
    SURFACE_OUTPOST_ID,
    isMeteredAuthoredRoute,
    LocalRpgPersistence
} from '../rpg/index.js';
import { CombatPresentation } from '../rpg/CombatPresentation.js';
import { BoardingPresentation } from '../rpg/BoardingPresentation.js';
import { SurfaceCombatPresentation } from '../rendering/SurfaceCombatPresentation.js';
import { GameClock, LocalSaveSlots, SlotRpgPersistence } from '../save/index.js';

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
        this.autopilot = new HyperdriveAutopilot();
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
        this.boardingPresentation = new BoardingPresentation({ scene: this.scene });

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
            getSurfaceParent: () => this.environment?.getSurfaceSample ? this.environment.group : null,
            getSurfaceInteraction: (position) => this.environment?.getSurfaceInteraction?.(position) ?? null,
            getBoardingContext: () => this._getBoardingContext()
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
        this.gameClock = new GameClock();
        this.saveSlots = new LocalSaveSlots();
        this.gameClock.restore(this.saveSlots.getActiveEnvelope().simulation.gameTime);
        this._lastClockCheckpoint = this.gameClock.getTime();
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
            onSelect: (input) => this._handleXrSelect(input)
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
        this.selectedNavigationTargetDepth = null;
        this.navigationPanelOpen = false;
        this.radioOpen = false;
        this.shipComputerOpen = false;
        this.shipComputerMessage = '';
        this.shipComputerPreview = null;
        this.shipComputerTransferText = '';
        this.cargoTerminalOpen = false;
        this.cargoTerminalMessage = '';
        this.crewPanelOpen = false;
        this.surfaceOutpostPanelOpen = false;
        this.surfaceOutpostMessage = '';
        this.patrolHailOpen = false;
        this.patrolHailDismissedId = null;
        this.patrolPanelEncounter = null;
        this.combatWarningOpen = false;
        this.combatWarningShown = false;
        this.patrolPanelRenderKey = null;
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
        this.crew = new CrewRuntime({ rpg: this.rpg });
        this._syncCrewPresence();
        this.dialogueError = null;
        // Live voice/LLM is opt-in: the adapter points at the Phase 09 service
        // but the runtime degrades to authored/canned if it is down or disabled.
        this.dialogueServiceBaseUrl = 'http://localhost:8000';
        this.dialogueServiceEnabled = false;
        this.dialogueVoiceProvider = this._createDialogueVoiceProviderSafely();
        this.dialogue = this._createDialogueRuntimeSafely();
        this.dialogue?.setServiceOnline(this.dialogueServiceEnabled);
        this.deliveryError = null;
        this.delivery = this._createDeliveryRuntimeSafely();
        this.economyError = null;
        this.economy = this._createEconomyRuntimeSafely();
        this.worldError = null;
        this.world = this._createWorldRuntimeSafely();
        this.conditionError = null;
        this.condition = this._createConditionRuntimeSafely();
        this._shipCapabilities = this.condition?.getState().capabilities ?? null;
        this.surfaceOutpostError = null;
        this.surfaceOutpost = this._createSurfaceOutpostRuntimeSafely();
        this.surfaceCombatError = null;
        this.surfaceCombat = this._createSurfaceCombatRuntimeSafely();
        this.surfaceCombatPresentation = this._createSurfaceCombatPresentationSafely();
        this.boardingError = null;
        this.boarding = this._createBoardingRuntimeSafely();
        this.patrolError = null;
        this.patrol = this._createPatrolRuntimeSafely();
        this.patrolAgentVisual = null;
        this.patrolVisualState = null;
        this._observedPatrolSystemId = undefined;
        this.combatError = null;
        this.combat = this._createCombatRuntimeSafely();
        this.combatPresentation = new CombatPresentation({ scene: this.scene });
        this._restoreBoardingSession();
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
        const clockActive = !this.paused
            && document.visibilityState === 'visible'
            && (typeof document.hasFocus !== 'function' || document.hasFocus());
        this.gameClock.update(clockActive);
        if (this.gameClock.getTime() - this._lastClockCheckpoint >= 5) {
            this._checkpointGameClock('play-time-checkpoint');
        }
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
        if (
            controlInput?.buttons?.dpadDown?.justPressed
            && canToggleCombatModeInPlayerState(this.playerController.getState())
        ) {
            this._toggleCombatMode();
            if (controlInput.source === 'webxr') this.xr.pulse({ duration: 90, strength: 0.36 });
            else this.input.gamepad.pulse({ duration: 90, weak: 0.24, strong: 0.4 });
        }
        if (
            controlInput?.source === 'webxr'
            && controlInput.buttons?.l2?.justPressed
            && this.shipControls.pilotActive
        ) {
            this._cycleCombatTarget();
            this.xr.pulse({ duration: 75, strength: 0.3 });
        }

        // Ship is simulated every frame whether or not anyone is piloting: when
        // pilot mode is off the command is inactive and it coasts on inertia +
        // gravity. So it keeps moving and keeps being bent by attractors.
        // `paused` freezes only the live simulation so manual/automated stepping
        // through the debug hooks is deterministic; rendering keeps running.
        if (!this.paused) {
            const boardingSecured = this._boardingSessionActive();
            if (this.autopilot.isActive()) {
                const target = this.selectedNavigationTarget;
                const tier = this.scaleStack.active.tier;
                const transitioning = this.scaleStack.isTransitioning;

                if (target === null || !isHyperdriveAutopilotTier(tier) || transitioning) {
                    this.shipControls.hyperdriveEngaged = false;
                    if (transitioning) {
                        this.selectedNavigationTarget = null;
                        this.selectedNavigationTargetDepth = null;
                    }
                    this.autopilot.disengage();
                    this.shipControls.autopilotActive = false;
                    this._syncDebugDomState();
                } else {
                    let manualOverride = false;
                    if (this.shipControls.pilotActive) {
                        const k = this.shipControls.heldKeys;
                        const keyboardOverride = Object.values(k).some(code => this.input.keys.has(code));

                        let gamepadOverride = false;
                        if (gamepad && gamepad.connected) {
                            const threshold = 0.15;
                            const sticks = Math.abs(gamepad.axes.leftX) > threshold ||
                                           Math.abs(gamepad.axes.leftY) > threshold ||
                                           Math.abs(gamepad.axes.rightX) > threshold ||
                                           Math.abs(gamepad.axes.rightY) > threshold;

                            const buttonsToIgnore = ['l3', 'share', 'options', 'ps'];
                            const buttonPressed = Object.entries(gamepad.buttons).some(([name, btn]) => {
                                if (buttonsToIgnore.includes(name)) return false;
                                return btn.pressed || btn.value > 0.5;
                            });
                            gamepadOverride = sticks || buttonPressed;
                        }

                        if (keyboardOverride || gamepadOverride) {
                            manualOverride = true;
                        }
                    }

                    if (manualOverride) {
                        this.autopilot.disengage();
                        this.shipControls.autopilotActive = false;
                        this._syncDebugDomState();
                    } else {
                        this.autopilot.update(this.ship, target, dt);

                        if (this.autopilot.state === 'DECELERATE') {
                            // Synchronize the manual latch with the injected
                            // braking command so handback stays in precision.
                            this.shipControls.hyperdriveEngaged = false;
                        } else if (this.autopilot.state === 'HANDOFF') {
                            // Keep the lock and autopilot alive for this frame so
                            // ScaleStack can select the locked descent candidate.
                            // The transition branch above clears both next frame.
                            this.shipControls.hyperdriveEngaged = false;
                            this._syncDebugDomState();
                        }
                    }
                }
            }

            const flightInput = this.combat?.getState().combatMode && controlInput?.buttons
                ? {
                    ...controlInput,
                    buttons: {
                        ...controlInput.buttons,
                        cross: {
                            ...controlInput.buttons.cross,
                            pressed: false,
                            value: 0
                        }
                    }
                }
                : controlInput;
            const command = boardingSecured
                ? { active: false }
                : this.autopilot.isActive()
                ? this.autopilot.buildCommand(this.ship, this.selectedNavigationTarget, dt)
                : this.shipControls.getCommand(this.input.keys, flightInput);
            const capabilities = this._shipCapabilities;
            if (capabilities) {
                this.ship.capabilityEffects = {
                    engineThrust: capabilities.engineThrust,
                    hyperdriveAuthority: capabilities.hyperdriveAuthority
                };
            }
            this.debrisHazardState = boardingSecured
                ? this._emptyDebrisHazard()
                : this.environment.getHazardState?.(this.ship.position, this.ship.velocity) ?? this._emptyDebrisHazard();
            if (boardingSecured) this.ship.physics?.halt?.();
            else this.ship.update(dt, command, this.gravityField, this.debrisHazardState.acceleration);
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
            if (!this.paused) this._updateBoarding();
            if (!xrActive) this.playerController.updateCamera(this.camera);
        } else {
            this._updateDebugCamera(dt);
        }

        this.playerRig.update(dt);
        // Updates the active level and evaluates the descend/ascend transition
        // rule (entry shell + PRECISION speed gate to sink in, exit shell to
        // climb back out), running the reparent/rescale handoff under a veil.
        const activeNavigationTarget = navigationTargetBelongsToDepth(
            this.selectedNavigationTargetDepth,
            this.scaleStack.depth
        )
            ? this.selectedNavigationTarget
            : null;
        const scaleContext = {
            shipPosition: this.ship.position,
            dt,
            cameraPosition: this.camera.position,
            hyperdriveLevel: this.ship.getHyperdriveLevel(),
            lockedTargetId: activeNavigationTarget ? (activeNavigationTarget.id ?? activeNavigationTarget.name) : null,
            lockedTargetPosition: activeNavigationTarget?.position ?? null,
            autopilotActive: this.autopilot.isActive()
        };
        if (this._boardingSessionActive()) {
            this.scaleStack.active.update(
                scaleContext.shipPosition,
                scaleContext.dt,
                scaleContext.cameraPosition
            );
        } else {
            this.scaleStack.update(scaleContext);
        }
        this._syncPatrolFromSettledScale();
        this._syncSurfaceOutpostProgress();
        this._syncSurfaceCombatProgress();
        if (clockActive) this._updateSurfaceCombat(dt);
        if (clockActive) this._updateEconomySafely();
        // The autonomous world simulation ticks on a 60 s cadence, so it is
        // advanced from the 5 s clock checkpoint (see _checkpointGameClock)
        // rather than on the hot render frame.
        if (!this.paused) this.patrol?.update(this.gameClock.getTime());
        this._syncPatrolPresentation();
        if (clockActive && this.combat) {
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.ship.object3D.quaternion);
            this.combat.update(dt, {
                playerPosition: this.ship.position.toArray(),
                playerVelocity: this.ship.velocity.toArray(),
                playerForward: forward.toArray()
            });
            this._refreshShipCapabilities();
        }
        this.combatPresentation?.update(this.combat?.getState());
        this._syncCombatNavigationTarget();
        this._refreshSelectedNavigationTarget();
        this._syncCombatWarning();
        this.sky.update(dt, this.camera.position);

        this._updateSpeedFx(dt, xrActive);

        this._updateTelemetry();
        this.universeNavigation.update({
            shipPosition: this.ship.position,
            camera: this.camera,
            displayMode: this.displayMode,
            pilotActive: this.shipControls.pilotActive,
            selectedTarget: this.selectedNavigationTarget,
            ship: this.ship,
            autopilotActive: this.autopilot.isActive()
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

        if (
            buttons[SURFACE_COMBAT_GAMEPAD_FIRE_BUTTON].justPressed
            && this._surfaceWeaponEquipped()
        ) {
            this._fireSurfaceWeapon();
            this.input.gamepad.pulse({ duration: 55, weak: 0.2, strong: 0.35 });
            return;
        }

        if (
            buttons.triangle.justPressed
            && this.cameraMode === 'player'
            && this.shipControls.pilotActive
            && this.combat?.getState().active
            && this.combat?.getState().combatMode
        ) {
            this._cycleCombatTarget();
            this.input.gamepad.pulse({ duration: 75, weak: 0.2, strong: 0.35 });
            return;
        }

        if (
            buttons.cross.justPressed
            && this.shipControls.pilotActive
            && this.combat?.getState().active
            && this.combat?.getState().combatMode
        ) {
            this._fireCombatWeapon();
            this.input.gamepad.pulse({ duration: 55, weak: 0.18, strong: 0.32 });
        }

        if (buttons.triangle.justPressed && this.cameraMode === 'player') {
            if (this.surfaceOutpostPanelOpen) {
                this._closeSurfaceOutpostPanel();
                this.input.gamepad.pulse({ duration: 70, weak: 0.18, strong: 0.28 });
                return;
            }
            if (this.patrolHailOpen) {
                this._closePatrolHailPanel();
                if (this.shipControls.pilotActive) {
                    const action = this.playerController.interact();
                    if (action) this._handlePlayerInteraction(action);
                }
                this.input.gamepad.pulse({ duration: 70, weak: 0.18, strong: 0.28 });
                return;
            }
            if (this.crewPanelOpen) {
                this._closeCrewPanel();
                this.input.gamepad.pulse({ duration: 70, weak: 0.18, strong: 0.28 });
                return;
            }
            const action = this.playerController.interact();
            if (action) {
                this._handlePlayerInteraction(action);
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

        if (buttons.circle.justPressed && this._boardingSessionActive()) {
            this._recoverBoarding('explicit');
            this.input.gamepad.pulse({ duration: 110, weak: 0.28, strong: 0.5 });
            this._syncDebugDomState();
            return;
        }

        if (buttons.circle.pressed && this.shipControls.pilotActive) {
            this.input.gamepad.pulse({
                duration: 90,
                weak: 0.18,
                strong: 0.12,
                minInterval: 120
            });
        }

        if (buttons.l3.justPressed && this.shipControls.pilotActive) {
            if (this.shipControls.handleToggleKey('KeyU') === 'autopilot') {
                const shouldActive = this.shipControls.autopilotActive;
                if (shouldActive) {
                    const engaged = this.selectedNavigationTarget?.rpg?.combatTargetId
                        ? false
                        : this.autopilot.engage(this.ship, this.selectedNavigationTarget, this.scaleStack.active.tier, this.scaleStack.isTransitioning);
                    if (!engaged) {
                        this.shipControls.autopilotActive = false;
                    } else {
                        this.input.gamepad.pulse({ duration: 90, weak: 0.25, strong: 0.45 });
                    }
                } else {
                    this.autopilot.disengage();
                }
                this._syncDebugDomState();
            }
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
        if (this._boardingSessionActive()) {
            this._recoverBoarding('explicit');
            return;
        }
        if (!this.shipControls.pilotActive) return;
        if (this.shipControls.handleToggleKey('Space') === 'hyperdrive') {
            this._onHyperdriveToggled(input.source === 'webxr');
        }
    }

    // Tactile feedback + state sync on engage/disengage. A punchy pulse on
    // engage, a softer one on disengage.
    _onHyperdriveToggled(fromXr = false) {
        let engaged = this.shipControls.hyperdriveEngaged;
        const targetSystemId = this.selectedNavigationTarget?.rpg?.namedSystemId ?? null;
        const currentSystemId = this.delivery?.getState().ship.travel.currentSystemId ?? null;
        if (
            engaged
            && isMeteredAuthoredRoute(currentSystemId, targetSystemId)
            && this.delivery
        ) {
            try {
                const result = this.delivery.beginAuthoredJump(targetSystemId);
                this.cargoTerminalMessage = result.changed
                    ? `Authored route charged ${result.fuelCost} fuel.`
                    : `Authored route already charged ${result.fuelCost} fuel.`;
            } catch (error) {
                this.shipControls.hyperdriveEngaged = false;
                engaged = false;
                this.cargoTerminalMessage = error instanceof Error ? error.message : String(error);
            }
        }
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
        const boardingActive = this._boardingSessionActive();
        const offset = surfaceActive || boardingActive
            ? this.playerRig.object3D.getWorldPosition(new THREE.Vector3())
            : this.ship.position.clone();
        if (!force && offset.lengthSq() < FLOAT_ORIGIN_THRESHOLD_SQ) return false;

        if (surfaceActive) {
            this._moveObjectWorldBy(this.playerRig.object3D, offset.clone().negate());
            this.ship.object3D.position.sub(offset);
        } else if (boardingActive) {
            this.boardingPresentation.frame.position.sub(offset);
            this.ship.object3D.position.sub(offset);
        } else {
            this.ship.object3D.position.set(0, 0, 0);
        }
        if (!boardingActive) this.boardingPresentation?.rebaseOrigin(offset);

        // Shift the active navigation target coordinate by the rebase offset
        if (
            this.selectedNavigationTarget
            && this.selectedNavigationTarget.position
            && navigationTargetBelongsToDepth(
                this.selectedNavigationTargetDepth,
                this.scaleStack.depth
            )
        ) {
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
        this._syncAuthoredNavigationTarget();
        this._syncSurfaceNavigationTarget();
        this._syncSurfaceOutpostProgress();
        this._syncDebugDomState();
    }

    _syncActiveRpgSystem() {
        if (!this.rpg || !this.scaleStack) return false;
        try {
            const systemId = this._findActiveRpgNamedSystemId();
            this.rpg.setActiveNamedSystem(systemId);
            this.delivery?.syncSystem(systemId);
            this.economy?.syncSystem(systemId);
            this.condition?.syncSystem(systemId);
            this.combat?.syncSystem(systemId);
            this.boarding?.syncSystem(systemId);
            this._syncBoardingPresentation();
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

    _syncPatrolFromSettledScale() {
        if (!this.patrol || this.scaleStack?.isTransitioning) return false;
        const systemId = this._findActiveRpgNamedSystemId();
        if (
            this._observedPatrolSystemId === undefined
            && systemId === null
            && this.patrol.getState().activeEncounter
        ) {
            this._observedPatrolSystemId = systemId;
            return false;
        }
        if (this._observedPatrolSystemId === systemId) return false;
        try {
            this.patrol.syncSystem(systemId);
            this._observedPatrolSystemId = systemId;
            this._syncPatrolPresentation();
            return true;
        } catch (error) {
            this.patrolError = {
                context: 'patrol system synchronization',
                message: error instanceof Error ? error.message : String(error)
            };
            console.warn('Patrol system synchronization failed; scale traversal remains active.', error);
            return false;
        }
    }

    _createRpgRuntimeSafely() {
        try {
            return createRpgRuntime({
                persistence: new SlotRpgPersistence({
                    slots: this.saveSlots,
                    getGameTime: () => this.gameClock.getTime()
                })
            });
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

    _createDeliveryRuntimeSafely() {
        try {
            return new DeliveryRuntime({
                slots: this.saveSlots,
                rpg: this.rpg,
                getGameTime: () => this.gameClock.getTime()
            });
        } catch (error) {
            this.deliveryError = {
                context: 'delivery runtime initialization',
                message: error instanceof Error ? error.message : String(error)
            };
            console.warn('Phase 14 delivery runtime unavailable; flight remains active.', error);
            return null;
        }
    }

    _createConditionRuntimeSafely() {
        try {
            return new ShipConditionRuntime({
                slots: this.saveSlots,
                rpg: this.rpg,
                getGameTime: () => this.gameClock.getTime()
            });
        } catch (error) {
            this.conditionError = {
                context: 'ship condition runtime initialization',
                message: error instanceof Error ? error.message : String(error)
            };
            console.warn('Phase 18 ship condition runtime unavailable; flight remains active.', error);
            return null;
        }
    }

    _refreshShipCapabilities() {
        this._shipCapabilities = this.condition?.getState().capabilities ?? null;
        return this._shipCapabilities;
    }

    _createSurfaceOutpostRuntimeSafely() {
        try {
            return new SurfaceOutpostRuntime({
                slots: this.saveSlots,
                rpg: this.rpg,
                getGameTime: () => this.gameClock.getTime()
            });
        } catch (error) {
            this.surfaceOutpostError = {
                context: 'surface outpost runtime initialization',
                message: error instanceof Error ? error.message : String(error)
            };
            console.warn('Phase 16 surface outpost runtime unavailable; flight remains active.', error);
            return null;
        }
    }

    _createPatrolRuntimeSafely() {
        try {
            return new PatrolRuntime({
                slots: this.saveSlots,
                rpg: this.rpg,
                getGameTime: () => this.gameClock.getTime()
            });
        } catch (error) {
            this.patrolError = {
                context: 'patrol runtime initialization',
                message: error instanceof Error ? error.message : String(error)
            };
            console.warn('Phase 17 patrol runtime unavailable; flight remains active.', error);
            return null;
        }
    }

    _createSurfaceCombatRuntimeSafely() {
        try {
            return new SurfaceCombatRuntime({
                slots: this.saveSlots,
                rpg: this.rpg,
                getGameTime: () => this.gameClock.getTime()
            });
        } catch (error) {
            this.surfaceCombatError = {
                context: 'surface combat runtime initialization',
                message: error instanceof Error ? error.message : String(error)
            };
            console.warn('Phase 22 surface combat unavailable; flight and surface walking remain active.', error);
            return null;
        }
    }

    _createSurfaceCombatPresentationSafely() {
        try {
            return new SurfaceCombatPresentation({ scene: this.scene });
        } catch (error) {
            this.surfaceCombatError = {
                context: 'surface combat presentation initialization',
                message: error instanceof Error ? error.message : String(error)
            };
            console.warn('Phase 22 surface-combat presentation unavailable; simulation and flight remain active.', error);
            return null;
        }
    }

    _createBoardingRuntimeSafely() {
        try {
            return new EvaBoardingRuntime({
                slots: this.saveSlots,
                rpg: this.rpg,
                getGameTime: () => this.gameClock.getTime()
            });
        } catch (error) {
            this.boardingError = {
                context: 'EVA boarding runtime initialization',
                message: error instanceof Error ? error.message : String(error)
            };
            console.warn('Phase 21 EVA boarding unavailable; flight and tethered EVA remain active.', error);
            this.boardingPresentation?.hide();
            return null;
        }
    }

    _createEconomyRuntimeSafely() {
        try {
            return new EconomyRuntime({
                slots: this.saveSlots,
                getGameTime: () => this.gameClock.getTime()
            });
        } catch (error) {
            this.economyError = {
                context: 'economy runtime initialization',
                message: error instanceof Error ? error.message : String(error)
            };
            console.warn('Phase 20 economy runtime unavailable; flight remains active.', error);
            return null;
        }
    }

    _updateEconomySafely() {
        if (!this.economy) return false;
        try {
            const result = this.economy.update(this.gameClock.getTime());
            if (result.changed && this.cargoTerminalOpen) this._renderCargoTerminalPanel();
            return result.changed;
        } catch (error) {
            this.economyError = {
                context: 'economy tick',
                message: error instanceof Error ? error.message : String(error)
            };
            console.warn('Economy tick failed; flight remains active.', error);
            return false;
        }
    }

    _createDialogueVoiceProviderSafely() {
        try {
            return createConversationVoiceProvider({ baseUrl: this.dialogueServiceBaseUrl });
        } catch (error) {
            console.warn('Phase 24 voice provider unavailable; dialogue uses authored/canned replies.', error);
            return null;
        }
    }

    _createDialogueRuntimeSafely() {
        try {
            // Phase 24 hybrid dialogue. No live voice provider is wired by
            // default: the deterministic authored track is the acceptance path,
            // and open turns degrade to canned replies until a provider is set
            // (owner T5 live-service check). LOD tier defaults to embodied for
            // the active conversation.
            return new DialogueRuntime({
                rpg: this.rpg,
                voiceProvider: this.dialogueVoiceProvider ?? null,
                getGameTime: () => this.gameClock.getTime()
            });
        } catch (error) {
            this.dialogueError = {
                context: 'dialogue runtime initialization',
                message: error instanceof Error ? error.message : String(error)
            };
            console.warn('Phase 24 dialogue unavailable; flight and comms remain active.', error);
            return null;
        }
    }

    _createWorldRuntimeSafely() {
        try {
            return new WorldRuntime({
                slots: this.saveSlots,
                getGameTime: () => this.gameClock.getTime()
            });
        } catch (error) {
            this.worldError = {
                context: 'world simulation runtime initialization',
                message: error instanceof Error ? error.message : String(error)
            };
            console.warn('Phase 23 world simulation unavailable; flight remains active.', error);
            return null;
        }
    }

    _updateWorldSafely() {
        if (!this.world) return false;
        try {
            return this.world.update(this.gameClock.getTime()).changed;
        } catch (error) {
            this.worldError = {
                context: 'world simulation tick',
                message: error instanceof Error ? error.message : String(error)
            };
            console.warn('World simulation tick failed; flight remains active.', error);
            return false;
        }
    }

    _createCombatRuntimeSafely() {
        try {
            return new CombatRuntime({
                slots: this.saveSlots,
                rpg: this.rpg,
                getGameTime: () => this.gameClock.getTime()
            });
        } catch (error) {
            this.combatError = {
                context: 'combat runtime initialization',
                message: error instanceof Error ? error.message : String(error)
            };
            console.warn('Phase 19 combat runtime unavailable; flight remains active.', error);
            return null;
        }
    }

    _toggleCombatMode() {
        try {
            const result = this.combat?.toggleCombatMode() ?? null;
            this.combatError = null;
            this.combatPresentation?.update(result);
            this._syncSurfaceWeaponPresentation(this.surfaceCombat?.getState());
            this._syncCombatNavigationTarget();
            return result;
        } catch (error) {
            this.combatError = {
                context: 'combat mode toggle',
                message: error instanceof Error ? error.message : String(error)
            };
            return null;
        }
    }

    _cycleCombatTarget() {
        try {
            const result = this.combat?.cycleTarget() ?? null;
            this._syncCombatNavigationTarget();
            return result;
        } catch (error) {
            this.combatError = {
                context: 'combat target selection',
                message: error instanceof Error ? error.message : String(error)
            };
            return null;
        }
    }

    _syncCombatNavigationTarget() {
        const state = this.combat?.getState();
        const combatTargetId = state?.targetId ?? null;
        const selectedCombatId = this.selectedNavigationTarget?.rpg?.combatTargetId ?? null;
        if (!combatTargetId || !state?.enemy) {
            if (selectedCombatId) {
                this.selectedNavigationTarget = null;
                this.selectedNavigationTargetDepth = null;
            }
            return null;
        }
        if (!this.selectedNavigationTarget || selectedCombatId !== combatTargetId) {
            this.selectedNavigationTarget = {
                id: `combat-target:${combatTargetId}`,
                type: 'hostile ship',
                name: 'Red Knife [HOSTILE]',
                position: new THREE.Vector3(),
                rpg: {
                    combatTargetId,
                    encounterId: state.encounterId
                }
            };
        }
        this.selectedNavigationTarget.position.fromArray(state.enemy.position);
        this.selectedNavigationTargetDepth = this.scaleStack.depth;
        return this.selectedNavigationTarget;
    }

    _fireCombatWeapon() {
        try {
            const result = this.combat?.fire() ?? null;
            this._refreshShipCapabilities();
            return result;
        } catch (error) {
            this.combatError = {
                context: 'combat weapon fire',
                message: error instanceof Error ? error.message : String(error)
            };
            return null;
        }
    }

    _rescueCombatDefeat() {
        try {
            const result = this.combat?.rescueAfterDefeat() ?? null;
            this._refreshShipCapabilities();
            return result;
        } catch (error) {
            this.combatError = {
                context: 'combat rescue',
                message: error instanceof Error ? error.message : String(error)
            };
            return null;
        }
    }

    _handlePlayerInteraction(action) {
        if (action === 'openComms') {
            const encounter = this.patrol?.getState().activeEncounter;
            if (encounter && ['hail', 'wait'].includes(encounter.phase)) this._openPatrolHailPanel();
            else this._openCommsPanel();
        }
        else if (action === 'openNavigation') this._openNavigationPanel();
        else if (action === 'openRadio') this._openRadioPanel();
        else if (action === 'openShipComputer') this._openShipComputerPanel();
        else if (action === 'openCargoTerminal') this._openCargoTerminalPanel();
        else if (action === 'openCrew') this._openCrewPanel();
        else if (action === 'openSurfaceOutpost') this._openSurfaceOutpostPanel();
        else if (action === 'recoverSurfaceCombatObjective') this._recoverSurfaceCombatObjective();
        else if (action === 'beginBoardingEva') this._beginBoardingEva();
        else if (action === 'enterDerelict') this._enterBoardingDerelict();
        else if (action === 'recoverDerelictLog') this._recoverBoardingLog();
        else if (action === 'exitDerelict') this._exitBoardingDerelict();
        else if (action === 'returnBoardingShip') this._completeBoardingReturn();
        else if (action === 'takeControls' || action === 'leaveControls') this._onPilotModeChanged();
        else if (action === 'boardSurface') {
            const checkpoint = this.surfaceOutpost?.getState().progress.checkpoint;
            if (checkpoint === 'objective_complete') this.surfaceOutpost.recordBoarded();
            if (this.surfaceCombat?.getState().saved.checkpoint === 'objective_recovered') {
                this.surfaceCombat.recordBoarded();
            }
        }
        return action;
    }

    _getBoardingContext() {
        if (!this.boarding || !this.boardingPresentation) {
            return {
                available: false,
                error: this.boardingError,
                departure: { allowed: false, reason: this.boardingError?.message ?? 'EVA boarding is unavailable.' }
            };
        }
        const state = this.boarding.getState();
        const placement = this.environment?.getBoardingPlacement?.() ?? null;
        const activeSession = state.player.location !== 'ship';
        if (!this.boardingPresentation.frame.visible && (placement || activeSession)) {
            if (activeSession) this.boardingPresentation.restoreSecured(this.ship);
            else this.boardingPresentation.showAtWorldPosition(placement.position);
        }
        const derelictWorld = this.boardingPresentation.frame.visible
            ? this.boardingPresentation.getDerelictWorldPosition(new THREE.Vector3())
            : placement?.position ?? null;
        const shipAirlockWorld = this.ship.getAnchorWorldPosition?.('exteriorSpawn', new THREE.Vector3())
            ?? this.ship.position.clone();
        const systemId = activeSession
            ? BOARDING_SYSTEM_ID
            : this._findActiveRpgNamedSystemId();
        const distanceMetres = derelictWorld ? this.ship.position.distanceTo(derelictWorld) : Infinity;
        const departure = this.boarding.evaluateDeparture({
            systemId,
            distanceMetres,
            speedMetresPerSecond: this.ship.speed
        });
        return {
            available: true,
            state,
            placement,
            activeSession,
            departure,
            derelictWorld,
            shipAirlockWorld,
            hatchWorld: this.boardingPresentation.getHatchWorldPosition(new THREE.Vector3()),
            interiorHatchWorld: this.boardingPresentation.getInteriorHatchWorldPosition(new THREE.Vector3()),
            logWorld: this.boardingPresentation.getLogWorldPosition(new THREE.Vector3()),
            logRecovered: Boolean(state.progress.logRecoveredAt)
        };
    }

    _beginBoardingEva() {
        const context = this._getBoardingContext();
        if (!context?.departure?.allowed) {
            this.boardingError = {
                context: 'EVA departure',
                message: context?.departure?.reason ?? 'EVA departure is unavailable.'
            };
            return false;
        }
        try {
            this.ship.physics?.halt?.();
            this.shipControls.hyperdriveEngaged = false;
            this.autopilot.disengage();
            this.shipControls.autopilotActive = false;
            this.boardingPresentation.secureToShip(this.ship, context.derelictWorld);
            const spawn = this.ship.getAnchorWorldPosition?.('exteriorSpawn', new THREE.Vector3())
                ?? this.ship.position.clone();
            this.playerController.enterUntetheredEva(this.boardingPresentation.frame, spawn);
            const player = this.playerController.getPersistentPlayerState(
                this.gameClock.getTime(),
                BOARDING_LIMITS.oxygenSeconds
            );
            this.boarding.depart(player, {
                systemId: BOARDING_SYSTEM_ID,
                distanceMetres: context.derelictWorld.distanceTo(this.ship.position),
                speedMetresPerSecond: 0
            });
            this.boardingError = null;
            this._flashBoardingVeil();
            return true;
        } catch (error) {
            this.playerController.returnFromBoarding();
            this._syncBoardingPresentation();
            this.boardingError = {
                context: 'EVA departure',
                message: error instanceof Error ? error.message : String(error)
            };
            return false;
        }
    }

    _enterBoardingDerelict() {
        const context = this._getBoardingContext();
        try {
            const playerWorld = this.playerRig.object3D.getWorldPosition(new THREE.Vector3());
            const distanceMetres = playerWorld.distanceTo(context.hatchWorld);
            this.boardingPresentation.setInteriorActive(true);
            this.playerController.enterDerelictInterior(
                this.boardingPresentation.getInteriorRoot(),
                this.boardingPresentation.getInteriorSpawn()
            );
            this.boarding.enterDerelict(
                this._captureBoardingPlayer(),
                { distanceMetres }
            );
            this.boardingError = null;
            this._flashBoardingVeil();
            return true;
        } catch (error) {
            this.boardingPresentation.setInteriorActive(false);
            if (this.playerController.getState() === PLAYER_STATE.DERELICT_INTERIOR) {
                this.playerController.exitDerelictInterior(
                    this.boardingPresentation.frame,
                    this.boardingPresentation.getEvaHatchSpawnWorld(new THREE.Vector3())
                );
            }
            this.boardingError = {
                context: 'derelict entry',
                message: error instanceof Error ? error.message : String(error)
            };
            return false;
        }
    }

    _recoverBoardingLog() {
        const context = this._getBoardingContext();
        try {
            const distanceMetres = this.playerRig.object3D
                .getWorldPosition(new THREE.Vector3())
                .distanceTo(context.logWorld);
            const result = this.boarding.recoverLog(
                this._captureBoardingPlayer(),
                BOARDING_LOG_ID,
                { distanceMetres }
            );
            this.boardingError = null;
            return result;
        } catch (error) {
            this.boardingError = {
                context: 'operations log recovery',
                message: error instanceof Error ? error.message : String(error)
            };
            return false;
        }
    }

    _exitBoardingDerelict() {
        const context = this._getBoardingContext();
        const previousPosition = this.playerRig.position.clone();
        try {
            const distanceMetres = this.playerRig.object3D
                .getWorldPosition(new THREE.Vector3())
                .distanceTo(context.interiorHatchWorld);
            this.boardingPresentation.setInteriorActive(false);
            this.playerController.exitDerelictInterior(
                this.boardingPresentation.frame,
                this.boardingPresentation.getEvaHatchSpawnWorld(new THREE.Vector3())
            );
            const result = this.boarding.exitDerelict(
                this._captureBoardingPlayer(),
                { distanceMetres }
            );
            this.boardingError = null;
            this._flashBoardingVeil();
            return result;
        } catch (error) {
            this.boardingPresentation.setInteriorActive(true);
            if (this.playerController.getState() === PLAYER_STATE.EVA) {
                this.playerController.enterDerelictInterior(
                    this.boardingPresentation.getInteriorRoot(),
                    previousPosition
                );
            }
            this.boardingError = {
                context: 'derelict exit',
                message: error instanceof Error ? error.message : String(error)
            };
            return false;
        }
    }

    _completeBoardingReturn() {
        try {
            this.playerController.returnFromBoarding();
            const result = this.boarding.boardShip(this._captureBoardingPlayer());
            this.boardingError = null;
            this._syncBoardingPresentation();
            this._flashBoardingVeil();
            return result;
        } catch (error) {
            const savedPlayer = this.boarding?.getState().player;
            if (savedPlayer && savedPlayer.location !== 'ship') {
                this.playerController.restoreBoardingPlayer(savedPlayer, this.boardingPresentation);
            }
            this.boardingError = {
                context: 'boarding return',
                message: error instanceof Error ? error.message : String(error)
            };
            return false;
        }
    }

    _recoverBoarding(reason = 'explicit') {
        if (!this._boardingSessionActive()) return false;
        try {
            this.playerController.returnFromBoarding();
            const result = this.boarding.recover(reason, this._captureBoardingPlayer());
            this.boardingError = null;
            this._syncBoardingPresentation();
            this._flashBoardingVeil();
            return result;
        } catch (error) {
            const savedPlayer = this.boarding?.getState().player;
            if (savedPlayer && savedPlayer.location !== 'ship') {
                this.playerController.restoreBoardingPlayer(savedPlayer, this.boardingPresentation);
            }
            this.boardingError = {
                context: 'boarding recovery',
                message: error instanceof Error ? error.message : String(error)
            };
            return false;
        }
    }

    _captureBoardingPlayer() {
        const live = this.boarding?.getState().player;
        return this.playerController.getPersistentPlayerState(
            live?.oxygenUpdatedAtGameTime ?? this.gameClock.getTime(),
            live?.oxygenRemaining ?? BOARDING_LIMITS.oxygenSeconds
        );
    }

    _updateBoarding() {
        if (!this._boardingSessionActive()) return false;
        const context = this._getBoardingContext();
        const player = this._captureBoardingPlayer();
        const playerWorld = this.playerRig.object3D.getWorldPosition(new THREE.Vector3());
        const distanceFromShip = playerWorld.distanceTo(context.shipAirlockWorld);
        try {
            const result = this.boarding.updatePlayer(player, {
                gameTime: this.gameClock.getTime(),
                distanceFromShip
            });
            if (result.recovered) {
                this.playerController.returnFromBoarding();
                this._syncBoardingPresentation();
                this._flashBoardingVeil();
            }
            return result;
        } catch (error) {
            this.boardingError = {
                context: 'boarding update',
                message: error instanceof Error ? error.message : String(error)
            };
            return false;
        }
    }

    _boardingSessionActive() {
        return Boolean(this.boarding && this.boarding.getState().player.location !== 'ship');
    }

    _restoreBoardingSession() {
        if (!this.boarding || !this.boardingPresentation) return false;
        try {
            const state = this.boarding.reload();
            if (state.player.location === 'ship') {
                this.boardingPresentation.hide();
                return false;
            }
            this.ship.physics?.halt?.();
            this.boardingPresentation.restoreSecured(this.ship);
            this.boardingPresentation.setInteriorActive(state.player.location === 'derelict');
            this.playerController.restoreBoardingPlayer(state.player, this.boardingPresentation);
            return true;
        } catch (error) {
            this.boardingError = {
                context: 'boarding checkpoint restore',
                message: error instanceof Error ? error.message : String(error)
            };
            this.boardingPresentation.hide();
            return false;
        }
    }

    _syncBoardingPresentation() {
        if (!this.boardingPresentation || !this.boarding) return null;
        if (this._boardingSessionActive()) return this.boardingPresentation.getState();
        const placement = this.environment?.getBoardingPlacement?.() ?? null;
        if (placement) return this.boardingPresentation.showAtWorldPosition(placement.position);
        this.boardingPresentation.hide();
        return this.boardingPresentation.getState();
    }

    _flashBoardingVeil() {
        let veil = document.querySelector('#boarding-transfer-veil');
        if (!veil) {
            veil = document.createElement('div');
            veil.id = 'boarding-transfer-veil';
            veil.style.cssText = [
                'position:fixed',
                'inset:0',
                'background:#000',
                'opacity:0',
                'pointer-events:none',
                'z-index:22',
                'transition:opacity 140ms ease-out'
            ].join(';');
            document.body.appendChild(veil);
        }
        veil.style.opacity = '0.94';
        requestAnimationFrame(() => requestAnimationFrame(() => { veil.style.opacity = '0'; }));
    }

    _syncSurfaceOutpostProgress() {
        if (!this.surfaceOutpost) return null;
        const planet = this.environment?.descriptor?.rpg ?? null;
        const landing = this.environment?.getLandingState?.(this.ship.position) ?? null;
        return this.surfaceOutpost.syncContext({
            systemId: planet?.namedSystemId ?? this._findActiveRpgNamedSystemId(),
            planetId: planet?.planetId ?? null,
            landed: Boolean(landing?.landed),
            withinLandingArea: Boolean(this.environment?.isWithinSurfaceOutpostLandingArea?.(this.ship.position)),
            playerState: this.playerController.getState()
        });
    }

    _syncSurfaceNavigationTarget() {
        const surfacePoiId = this.selectedNavigationTarget?.rpg?.surfacePoiId;
        if (!surfacePoiId) return false;
        const replacement = this.environment.getPOIs(this.ship.position, 18)
            .find((poi) => poi.rpg?.surfacePoiId === surfacePoiId);
        if (!replacement) return false;
        this.selectedNavigationTarget = replacement;
        this.selectedNavigationTargetDepth = this.scaleStack.depth;
        return true;
    }

    _syncAuthoredNavigationTarget() {
        const namedSystemId = this.selectedNavigationTarget?.rpg?.namedSystemId;
        if (!namedSystemId || this.selectedNavigationTarget?.rpg?.surfacePoiId) return false;
        const authored = this.environment.getAuthoredSystemPOIs?.(this.ship.position) ?? [];
        const visible = this.environment.getPOIs?.(this.ship.position, 64) ?? [];
        const replacement = findAuthoredNavigationReplacement(
            [...authored, ...visible],
            namedSystemId
        );
        if (!replacement) return false;
        this.selectedNavigationTarget = replacement;
        this.selectedNavigationTargetDepth = this.scaleStack.depth;
        return true;
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
        if (this.autopilot.isActive()) {
            if (this.autopilot.state === 'CRUISE') {
                return `AUTOPILOT ◈ ${this.autopilot.alignmentPercent}%`;
            }
            if (this.autopilot.state === 'DECELERATE') {
                return 'AUTOPILOT ▼ BRAKE';
            }
            if (this.autopilot.state === 'HANDOFF') {
                return 'AUTOPILOT ✓ ARRIVE';
            }
        }
        const engaged = this.shipControls.hyperdriveEngaged;
        const level = this.ship.getHyperdriveLevel();
        if (!engaged && level < 0.01) return 'PRECISION';
        if (engaged && level > 0.99) return 'HYPERDRIVE';
        return `HYPERDRIVE ⟳ ${Math.round(level * 100)}%`;
    }

    _handleXrSelect(input = {}) {
        this._unlockAudioFromGesture();
        if (this.cameraMode !== 'player') return false;
        if (
            input.handedness === 'right'
            && this._surfaceWeaponEquipped()
        ) {
            const shot = this._fireSurfaceWeapon({ controller: input.controller });
            this.xr.pulse({ duration: 55, strength: 0.32 });
            return shot ? 'surfaceCombatFire' : false;
        }
        if (
            this.shipControls.pilotActive
            && this.combat?.getState().active
            && this.combat?.getState().combatMode
        ) {
            const shot = this._fireCombatWeapon();
            this.xr.pulse({ duration: 55, strength: 0.32 });
            return shot ? 'combatFire' : false;
        }
        if (this.surfaceOutpostPanelOpen) {
            this._closeSurfaceOutpostPanel();
            this.xr.pulse({ duration: 70, strength: 0.25 });
            return 'closeSurfaceOutpost';
        }
        if (this.patrolHailOpen) {
            this._closePatrolHailPanel();
            if (this.shipControls.pilotActive) {
                const action = this.playerController.interact();
                if (action) this._handlePlayerInteraction(action);
            }
            this.xr.pulse({ duration: 70, strength: 0.25 });
            return 'closePatrolHail';
        }
        if (this.crewPanelOpen) {
            this._closeCrewPanel();
            this.xr.pulse({ duration: 70, strength: 0.25 });
            return 'closeCrew';
        }
        const action = this.playerController.interact();
        if (action) {
            this._handlePlayerInteraction(action);
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
        const crosshair = document.createElement('div');
        crosshair.id = 'surface-combat-crosshair';
        crosshair.textContent = '+';
        crosshair.style.cssText = [
            'position:fixed',
            'left:50%',
            'top:50%',
            'transform:translate(-50%,-50%)',
            'color:#ffded2',
            'font:22px/1 monospace',
            'text-shadow:0 0 7px #ff4f35',
            'pointer-events:none',
            'z-index:10',
            'display:none'
        ].join(';');
        document.body.appendChild(crosshair);
        this.surfaceCombatCrosshair = crosshair;

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
        this._createShipComputerPanel();
        this._createCargoTerminalPanel();
        this._createCrewPanel();
        this._createSurfaceOutpostPanel();
        this._createPatrolHailPanel();
        this._createCombatWarningPanel();
        this._createNavigationPanel();
        this._createRadioPanel();
    }

    _createShipComputerPanel() {
        const panel = document.createElement('div');
        panel.id = 'ship-computer-panel';
        panel.innerHTML = `
            <style>
                #ship-computer-panel {
                    position: fixed; inset: 7% 8%; z-index: 24; display: none;
                    overflow: auto; padding: 18px; color: #dff7ff;
                    background: rgba(2, 10, 18, 0.96); border: 1px solid #4ccbe8;
                    font: 12px/1.45 "Consolas", "Courier New", monospace;
                }
                #ship-computer-panel .computer-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
                #ship-computer-panel .computer-card { border: 1px solid rgba(76,203,232,.35); padding: 10px; }
                #ship-computer-panel button { margin: 3px; padding: 6px 9px; color: #dff7ff; background: #092332; border: 1px solid #4ccbe8; }
                #ship-computer-panel textarea { box-sizing: border-box; width: 100%; min-height: 150px; color: #dff7ff; background: #020a12; border: 1px solid #347486; }
                #ship-computer-panel .active-slot { color: #8dffbf; }
                #ship-computer-panel .computer-error { color: #ff9d9d; }
                @media (max-width: 780px) { #ship-computer-panel .computer-grid { grid-template-columns: 1fr; } }
            </style>
            <div data-ship-computer-content></div>
        `;
        document.body.appendChild(panel);
        this.shipComputerPanel = panel;
        this.shipComputerContentNode = panel.querySelector('[data-ship-computer-content]');
        panel.addEventListener('click', (event) => {
            const target = event.target.closest('[data-computer-action]');
            if (!target) return;
            this._handleShipComputerAction(target.dataset.computerAction, target.dataset.slotId);
        });
    }

    _openShipComputerPanel() {
        this.shipComputerOpen = true;
        this.shipComputerMessage = '';
        this._exitPointerLock();
        this._renderShipComputerPanel();
        return this.saveSlots.getStatus();
    }

    _closeShipComputerPanel() {
        this.shipComputerOpen = false;
        if (this.shipComputerPanel) this.shipComputerPanel.style.display = 'none';
        return false;
    }

    _handleShipComputerKeydown(event) {
        if (!this.shipComputerOpen) return false;
        if (event.code === 'Escape') {
            event.preventDefault();
            this._closeShipComputerPanel();
        }
        return true;
    }

    _handleShipComputerAction(action, slotId) {
        try {
            const textarea = this.shipComputerPanel.querySelector('[data-save-json]');
            if (textarea) this.shipComputerTransferText = textarea.value;
            if (action === 'close') return this._closeShipComputerPanel();
            if (action === 'new') {
                this.saveSlots.createSlot(`Flight ${this.saveSlots.listSlots().length + 1}`);
                this._reloadActiveSlot();
                this.shipComputerMessage = 'Created and loaded a new isolated slot.';
            } else if (action === 'load') {
                this._checkpointGameClock('slot-switch');
                this.saveSlots.loadSlot(slotId);
                this._reloadActiveSlot();
                this.shipComputerMessage = `Loaded ${slotId}.`;
            } else if (action === 'delete') {
                this.saveSlots.deleteSlot(slotId);
                this._reloadActiveSlot();
                this.shipComputerMessage = `Deleted ${slotId}.`;
            } else if (action === 'export') {
                this.shipComputerTransferText = this.saveSlots.exportSlot(slotId);
                this.shipComputerPreview = null;
                this.shipComputerMessage = `Exported ${slotId} below. Copy the JSON to preserve it.`;
            } else if (action === 'preview') {
                this.shipComputerPreview = this.saveSlots.previewImport(this.shipComputerTransferText);
                this.shipComputerMessage = 'Import validated. Review the preview, then create a new slot.';
            } else if (action === 'import') {
                const token = this.shipComputerPreview?.token;
                this.saveSlots.importPreviewed(this.shipComputerTransferText, token);
                this._reloadActiveSlot();
                this.shipComputerPreview = null;
                this.shipComputerMessage = 'Imported into a new slot; no existing slot was overwritten.';
            } else if (action === 'reset') {
                this.saveSlots.resetActiveSlot();
                this._reloadActiveSlot();
                this.shipComputerMessage = 'Reset only the active slot.';
            } else if (action === 'report-surface') {
                if (!this.surfaceOutpost) {
                    throw new Error(this.surfaceOutpostError?.message ?? 'Surface outpost runtime unavailable.');
                }
                const checkpoint = this.surfaceOutpost.getState().progress.checkpoint;
                // The physical ship log is reachable only after boarding. If an
                // older live build missed the board edge, recover that checkpoint
                // here before reporting instead of leaving a valid save stuck.
                if (
                    checkpoint === 'objective_complete'
                    && this.playerController.getState() === PLAYER_STATE.WALKING
                ) {
                    this.surfaceOutpost.recordBoarded(SURFACE_OUTPOST_ID);
                }
                const result = this.surfaceOutpost.report(SURFACE_OUTPOST_ID);
                if (!result) throw new Error(this.surfaceOutpostError?.message ?? 'Surface outpost runtime unavailable.');
                this.shipComputerMessage = result.changed
                    ? 'K-7 surface verification reported and saved.'
                    : 'K-7 surface verification was already reported.';
            } else {
                throw new Error(`Unknown ship-computer action: ${action}`);
            }
        } catch (error) {
            this.shipComputerMessage = error instanceof Error ? error.message : String(error);
        }
        this._renderShipComputerPanel();
        return true;
    }

    _reloadActiveSlot() {
        const envelope = this.saveSlots.getActiveEnvelope();
        this.gameClock.restore(envelope.simulation.gameTime);
        this._lastClockCheckpoint = this.gameClock.getTime();
        this.rpg.reload();
        this.delivery?.reload();
        this.economy?.reload();
        this.world?.reload();
        this.condition?.reload();
        this._refreshShipCapabilities();
        this.surfaceOutpost?.reload();
        this.surfaceCombat?.reload();
        this.boarding?.reload();
        this.patrol?.reload();
        this.combat?.reload();
        this._observedPatrolSystemId = undefined;
        this.patrolHailOpen = false;
        this.patrolHailDismissedId = null;
        this.patrolPanelEncounter = null;
        this.combatWarningShown = false;
        this._closeCombatWarning();
        this._syncActiveRpgSystem();
        this._restoreBoardingSession();
        this._syncCrewPresence();
        this._syncDebugDomState();
    }

    _checkpointGameClock(reason = 'clock-checkpoint') {
        if (!this.saveSlots || !this.rpg) return null;
        if (this._boardingSessionActive()) {
            this.boarding.checkpoint(this._captureBoardingPlayer(), reason);
            const envelope = this.saveSlots.getActiveEnvelope();
            this._lastClockCheckpoint = envelope.simulation.gameTime;
            return envelope;
        }
        const envelope = this.saveSlots.saveDomains(
            {
                player: this.saveSlots.getActiveEnvelope().player,
                rpg: this.rpg.getState(),
                gameTime: this.gameClock.getTime()
            },
            { kind: 'auto', reason }
        );
        this._lastClockCheckpoint = envelope.simulation.gameTime;
        // Advance the autonomous world here (off the render frame); its own 60 s
        // tick guard means most checkpoints are a cheap no-op.
        this._updateWorldSafely();
        return envelope;
    }

    _renderShipComputerPanel() {
        if (!this.shipComputerPanel || !this.shipComputerContentNode) return;
        this.shipComputerPanel.style.display = this.shipComputerOpen ? 'block' : 'none';
        if (!this.shipComputerOpen) return;

        const slots = this.saveSlots.listSlots();
        const envelope = this.saveSlots.getActiveEnvelope();
        const mission = this.rpg.getMission('port_meridian_route_packet');
        const deliveryMission = this.rpg.getMission('index_archive_delivery');
        const deliveryState = this.delivery?.getState() ?? null;
        const surfaceState = this.surfaceOutpost?.getState() ?? null;
        const canReportSurface = surfaceState?.progress.checkpoint === 'returned'
            || (
                surfaceState?.progress.checkpoint === 'objective_complete'
                && this.playerController.getState() === PLAYER_STATE.WALKING
            );
        const events = this.rpg.queryEvents({ missionId: mission.id, newestFirst: true, limit: 20 });
        const storageError = this.saveSlots.getStatus().lastError;
        const slotRows = slots.map((slot) => `
            <div class="${slot.active ? 'active-slot' : ''}">
                ${escapeHtml(slot.name)} — ${escapeHtml(slot.id)} ${slot.active ? '[ACTIVE]' : ''}
                <button data-computer-action="load" data-slot-id="${escapeHtml(slot.id)}">Load</button>
                <button data-computer-action="export" data-slot-id="${escapeHtml(slot.id)}">Export</button>
                ${slots.length > 1 ? `<button data-computer-action="delete" data-slot-id="${escapeHtml(slot.id)}">Delete</button>` : ''}
                <small>${escapeHtml(slot.autosave.kind)} / ${escapeHtml(slot.autosave.reason)} / ${escapeHtml(slot.autosave.savedAt)}</small>
            </div>
        `).join('');
        const eventRows = events.map((event) => `
            <li>${escapeHtml(event.createdAt)} — ${escapeHtml(event.type)} — ${escapeHtml(event.payload?.branchId ?? event.payload?.outcomeId ?? '')}</li>
        `).join('') || '<li>No A Clean Copy history yet.</li>';
        const preview = this.shipComputerPreview
            ? `<pre>${escapeHtml(JSON.stringify(this.shipComputerPreview, null, 2))}</pre><button data-computer-action="import">Import as new slot</button>`
            : '';

        this.shipComputerContentNode.innerHTML = `
            <div style="display:flex;justify-content:space-between"><h2>SHIP LOG / LOCAL ARCHIVE</h2><button data-computer-action="close">Close</button></div>
            <div class="computer-grid">
                <section class="computer-card">
                    <h3>Save slots (${slots.length}/3)</h3>${slotRows}
                    <button data-computer-action="new" ${slots.length >= 3 ? 'disabled' : ''}>New slot</button>
                    <button data-computer-action="reset">Reset active slot</button>
                    <p>Play time: ${formatGameTime(this.gameClock.getTime())}</p>
                </section>
                <section class="computer-card">
                    <h3>A Clean Copy</h3>
                    <p>Status: ${escapeHtml(mission.state.status)} / Outcome: ${escapeHtml(mission.state.outcomeId ?? 'none')}</p>
                    <ol>${eventRows}</ol>
                </section>
                <section class="computer-card">
                    <h3>The Weight of a Copy</h3>
                    <p>Status: ${escapeHtml(deliveryMission.state.status)} / Outcome: ${escapeHtml(deliveryMission.state.outcomeId ?? 'none')}</p>
                    <p>Credits: ${deliveryState?.ship.credits ?? 'unavailable'} / Fuel: ${deliveryState?.ship.fuel.current ?? 'unavailable'} / Cargo mass: ${deliveryState?.usedCargoMass ?? 'unavailable'}</p>
                </section>
                <section class="computer-card">
                    <h3>K-7 Surface Verification</h3>
                    <p>Status: ${escapeHtml(surfaceState?.mission.state.status ?? 'unavailable')} / Checkpoint: ${escapeHtml(surfaceState?.progress.checkpoint ?? 'unavailable')}</p>
                    <button data-computer-action="report-surface" ${canReportSurface ? '' : 'disabled'}>Report surface survey</button>
                    ${surfaceState?.progress.checkpoint === 'objective_complete' && canReportSurface
                        ? '<small>Return checkpoint will be recovered from your physical ship-log access.</small>'
                        : ''}
                </section>
                <section class="computer-card" style="grid-column:1/-1">
                    <h3>Validated export / import</h3>
                    <textarea data-save-json aria-label="Save JSON">${escapeHtml(this.shipComputerTransferText)}</textarea>
                    <button data-computer-action="preview">Validate & preview import</button>
                    ${preview}
                </section>
            </div>
            <p class="${storageError ? 'computer-error' : ''}">${escapeHtml(storageError?.message ?? this.shipComputerMessage ?? '')}</p>
            <small>Envelope v${envelope.version}; imports always create a new slot.</small>
        `;
    }

    _createPatrolHailPanel() {
        const panel = document.createElement('div');
        panel.id = 'patrol-hail-panel';
        panel.innerHTML = `
            <style>
                #patrol-hail-panel {
                    position: fixed; right: 5%; top: 14%; width: min(430px, 86vw);
                    z-index: 27; display: none; overflow: auto; padding: 18px;
                    pointer-events: auto; isolation: isolate;
                    color: #fff0cf; background: rgba(15, 10, 4, 0.96);
                    border: 1px solid #f0b866;
                    font: 13px/1.5 "Consolas", "Courier New", monospace;
                    box-shadow: 0 0 28px rgba(240, 184, 102, 0.16);
                }
                #patrol-hail-panel button {
                    margin: 5px 5px 0 0; padding: 7px 10px; color: #fff0cf;
                    background: #33200b; border: 1px solid #f0b866;
                }
                #patrol-hail-panel .patrol-warn { color: #ff9f86; }
                #patrol-hail-panel .patrol-ok { color: #8dffc2; }
            </style>
            <div data-patrol-hail-content></div>
        `;
        document.body.appendChild(panel);
        panel.tabIndex = -1;
        this.patrolHailPanel = panel;
        this.patrolHailContentNode = panel.querySelector('[data-patrol-hail-content]');
        panel.addEventListener('click', (event) => {
            const target = event.target.closest('[data-patrol-action]');
            if (!target) return;
            this._handlePatrolAction(target.dataset.patrolAction);
        });
    }

    _syncSurfaceCombatProgress() {
        if (!this.surfaceCombat) return null;
        const planet = this.environment?.descriptor?.rpg ?? null;
        const landing = this.environment?.getLandingState?.(this.ship.position) ?? null;
        const playerPosition = this.playerRig.object3D.getWorldPosition(new THREE.Vector3());
        const withinLandingArea = Boolean(
            this.environment?.isWithinSurfacePoiLandingArea?.(SURFACE_COMBAT_SITE_ID, this.ship.position)
        );
        try {
            return this.surfaceCombat.syncContext({
                systemId: planet?.namedSystemId ?? this._findActiveRpgNamedSystemId(),
                planetId: planet?.planetId ?? null,
                siteId: withinLandingArea ? SURFACE_COMBAT_SITE_ID : null,
                landed: Boolean(landing?.landed),
                withinLandingArea,
                playerState: this.playerController.getState(),
                playerPosition: playerPosition.toArray(),
                shipPosition: this.ship.position.toArray(),
                placement: this.environment?.getSurfaceCombatPlacement?.() ?? null
            });
        } catch (error) {
            this.surfaceCombatError = {
                context: 'surface combat context',
                message: error instanceof Error ? error.message : String(error)
            };
            return null;
        }
    }

    _updateSurfaceCombat(dt) {
        if (!this.surfaceCombat) return null;
        try {
            const playerPosition = this.camera.getWorldPosition(new THREE.Vector3());
            const previousSuit = this.surfaceCombat.getState().saved.suitIntegrity;
            const state = this.surfaceCombat.update(dt, {
                playerPosition: playerPosition.toArray()
            });
            if (state.saved.suitIntegrity < previousSuit) {
                if (this.xr.isPresenting) this.xr.pulse({ duration: 100, strength: 0.55 });
                else this.input.gamepad.pulse({ duration: 100, weak: 0.35, strong: 0.62 });
            }
            this._syncSurfaceWeaponPresentation(state);
            if (this.surfaceCombat.consumeRecoveryRequest()) {
                this._flashBoardingVeil();
                this.playerController.boardShip();
                this.playerController.updateCamera(this.camera);
            }
            return state;
        } catch (error) {
            this.surfaceCombatError = {
                context: 'surface combat update',
                message: error instanceof Error ? error.message : String(error)
            };
            this.surfaceCombat?.cleanup('runtime-failure');
            this.surfaceCombatPresentation?.update(null);
            return null;
        }
    }

    _getSurfaceAimRay({ controller = null } = {}) {
        const source = controller ?? this.camera;
        source.updateWorldMatrix?.(true, false);
        const origin = source.getWorldPosition(new THREE.Vector3());
        const direction = new THREE.Vector3(0, 0, -1)
            .applyQuaternion(source.getWorldQuaternion(new THREE.Quaternion()))
            .normalize();
        return { origin: origin.toArray(), direction: direction.toArray() };
    }

    _fireSurfaceWeapon(options = {}) {
        try {
            if (!this._surfaceWeaponEquipped()) return false;
            const aim = this._getSurfaceAimRay(options);
            const muzzle = this.surfaceCombatPresentation?.getMuzzleWorldPosition?.(
                new THREE.Vector3()
            );
            const result = this.surfaceCombat.fire({
                ...aim,
                visualOrigin: muzzle?.toArray() ?? aim.origin
            });
            this.surfaceCombatError = null;
            return result;
        } catch (error) {
            this.surfaceCombatError = {
                context: 'surface pulse carbine',
                message: error instanceof Error ? error.message : String(error)
            };
            return false;
        }
    }

    _surfaceWeaponEquipped() {
        return Boolean(
            this.cameraMode === 'player'
            && this.combat?.getState().combatMode
            && canEquipSurfaceWeaponInPlayerState(this.playerController.getState())
        );
    }

    _syncSurfaceWeaponPresentation(state = null) {
        const xrActive = this.xr.isPresenting;
        const weaponParent = xrActive
            ? this.xr.getController('right') ?? this.camera
            : this.camera;
        return this.surfaceCombatPresentation?.update(state, {
            weaponParent,
            xr: xrActive,
            equipped: this._surfaceWeaponEquipped()
        }) ?? null;
    }

    _recoverSurfaceCombatObjective() {
        try {
            const position = this.playerRig.object3D.getWorldPosition(new THREE.Vector3());
            const result = this.surfaceCombat?.recoverObjective({
                playerPosition: position.toArray()
            });
            this.surfaceCombatError = null;
            return result;
        } catch (error) {
            this.surfaceCombatError = {
                context: 'surface objective recovery',
                message: error instanceof Error ? error.message : String(error)
            };
            return null;
        }
    }

    _createCombatWarningPanel() {
        const panel = document.createElement('div');
        panel.id = 'combat-warning-panel';
        panel.innerHTML = `
            <style>
                #combat-warning-panel {
                    position: fixed; right: 5%; top: 14%; width: min(430px, 86vw);
                    z-index: 28; display: none; padding: 18px; pointer-events: auto;
                    color: #ffd7d2; background: rgba(18, 3, 5, 0.96);
                    border: 1px solid #ff695e;
                    font: 13px/1.5 "Consolas", "Courier New", monospace;
                    box-shadow: 0 0 30px rgba(255, 70, 60, 0.2);
                }
                #combat-warning-panel button {
                    padding: 7px 10px; color: #ffd7d2;
                    background: #351014; border: 1px solid #ff695e;
                }
                #combat-warning-panel strong { color: #ff8b82; }
            </style>
            <h3>INCOMING TRANSMISSION — RED KNIFE</h3>
            <p><strong>“Unidentified vessel. Cut thrust and surrender your hold.”</strong></p>
            <p>Weapons signature rising. Hostile fire expected in 5 seconds.</p>
            <button data-combat-warning-close>Keep channel open / return to controls</button>
        `;
        panel.querySelector('[data-combat-warning-close]').addEventListener('click', () => {
            this._closeCombatWarning();
        });
        document.body.appendChild(panel);
        this.combatWarningPanel = panel;
    }

    _openCombatWarning() {
        this.combatWarningOpen = true;
        this.combatWarningShown = true;
        if (this.combatWarningPanel) this.combatWarningPanel.style.display = 'block';
    }

    _closeCombatWarning() {
        this.combatWarningOpen = false;
        if (this.combatWarningPanel) this.combatWarningPanel.style.display = 'none';
    }

    _syncCombatWarning() {
        const state = this.combat?.getState();
        if (!state?.active) {
            this.combatWarningShown = false;
            this._closeCombatWarning();
            return;
        }
        if (state.warningIssued && !this.combatWarningShown) this._openCombatWarning();
    }

    _handleCombatWarningKeydown(event) {
        if (!this.combatWarningOpen || event.code !== 'Escape') return false;
        event.preventDefault();
        this._closeCombatWarning();
        return true;
    }

    _refreshSelectedNavigationTarget() {
        if (
            !this.selectedNavigationTarget
            || this.selectedNavigationTarget.rpg?.combatTargetId
            || !navigationTargetBelongsToDepth(
                this.selectedNavigationTargetDepth,
                this.scaleStack.depth
            )
        ) {
            return false;
        }
        const visible = this.environment.getPOIs?.(this.ship.position, 64) ?? [];
        const authored = this.environment.getAuthoredSystemPOIs?.(this.ship.position) ?? [];
        const replacement = findLiveNavigationReplacement(
            [...authored, ...visible],
            this.selectedNavigationTarget
        );
        if (!replacement?.position) return false;
        this.selectedNavigationTarget = replacement;
        this.selectedNavigationTargetDepth = this.scaleStack.depth;
        return true;
    }

    _openPatrolHailPanel() {
        const encounter = this.patrol?.getState().activeEncounter ?? this.patrolPanelEncounter;
        if (!encounter) return null;
        this.patrolHailOpen = true;
        this.patrolHailDismissedId = null;
        this.patrolPanelEncounter = structuredClone(encounter);
        this.patrolPanelRenderKey = null;
        this._exitPointerLock();
        this._renderPatrolHailPanel();
        this.patrolHailPanel.focus({ preventScroll: true });
        return encounter;
    }

    _closePatrolHailPanel() {
        const encounter = this.patrol?.getState().activeEncounter;
        this.patrolHailOpen = false;
        this.patrolPanelRenderKey = null;
        this.patrolHailDismissedId = encounter?.id ?? this.patrolPanelEncounter?.id ?? null;
        if (this.patrolHailPanel) this.patrolHailPanel.style.display = 'none';
        this._syncPatrolPresentation();
        return false;
    }

    _handlePatrolKeydown(event) {
        if (!this.patrolHailOpen) return false;
        if (event.code === 'Escape') {
            event.preventDefault();
            this._closePatrolHailPanel();
            return true;
        }
        if (event.code === 'KeyC') {
            event.preventDefault();
            this._closePatrolHailPanel();
            if (this.shipControls.pilotActive) {
                const action = this.playerController.interact();
                if (action) this._handlePlayerInteraction(action);
            }
            return true;
        }
        return false;
    }

    _handlePatrolAction(action) {
        try {
            if (action === 'close') {
                return this._closePatrolHailPanel();
            }
            if (!this.patrol) throw new Error(this.patrolError?.message ?? 'Patrol runtime is unavailable.');
            if (action === 'acknowledge') this.patrol.acknowledgeHail();
            else if (action === 'scan') this.patrol.submitCargoScan();
            else if (action === 'ignore') this.patrol.ignoreHail();
            else throw new Error(`Unknown patrol hail action: ${action}`);
            this.patrolPanelEncounter = this.patrol.getState().activeEncounter;
        } catch (error) {
            this.patrolError = {
                context: 'patrol hail action',
                message: error instanceof Error ? error.message : String(error)
            };
        }
        this._syncPatrolPresentation();
        this._renderPatrolHailPanel();
        this._syncDebugDomState();
        return true;
    }

    _renderPatrolHailPanel() {
        if (!this.patrolHailPanel || !this.patrolHailContentNode) return;
        this.patrolHailPanel.style.display = this.patrolHailOpen ? 'block' : 'none';
        if (!this.patrolHailOpen) return;
        const live = this.patrol?.getState().activeEncounter ?? null;
        const encounter = live ?? this.patrolPanelEncounter;
        if (!encounter) {
            this.patrolHailContentNode.innerHTML = '<p>Patrol channel closed.</p>';
            return;
        }
        this.patrolPanelEncounter = structuredClone(encounter);
        this.patrolPanelRenderKey = patrolPanelRenderKey(encounter, this.patrolError);
        const outcome = patrolOutcomeText(encounter.outcomeId);
        const waiting = ['hail', 'wait'].includes(encounter.phase);
        const manifest = encounter.cargoScan.matches.length
            ? encounter.cargoScan.matches.map((entry) => (
                `${entry.cargoId} × ${entry.quantity} @ ${entry.unitValue} cr = ${entry.totalValue} cr`
            )).join(', ')
            : 'no flagged cargo';
        const controls = encounter.scanPending
            ? '<button data-patrol-action="scan">Transmit cargo manifest</button><button data-patrol-action="close">Hide channel</button>'
            : waiting
                ? '<button data-patrol-action="acknowledge">Answer hail</button><button data-patrol-action="ignore">Ignore hail</button>'
                : '<button data-patrol-action="close">Close channel</button>';
        this.patrolHailContentNode.innerHTML = `
            <div style="display:flex;justify-content:space-between;gap:12px">
                <h2>MERIDIAN WATCH ONE</h2>
                <small>${escapeHtml(encounter.phase.toUpperCase())}</small>
            </div>
            <p>Commonwealth local patrol. Hold course and identify.</p>
            <p>Transponder band: ${escapeHtml(encounter.reputationBand)} /
               manifest policy: ${escapeHtml(encounter.cargoScan.status)}</p>
            <p>Appraised prohibited value: ${encounter.cargoScan.contrabandValue} credits</p>
            ${encounter.scanPending ? `<p>Inspection requested: ${escapeHtml(manifest)}</p>` : ''}
            ${outcome ? `<p class="${encounter.outcomeId === 'warning_refusal' || encounter.outcomeId === 'safe_hostility' ? 'patrol-warn' : 'patrol-ok'}">${escapeHtml(outcome)}</p>` : ''}
            ${this.patrolError?.context === 'patrol hail action' ? `<p class="patrol-warn">${escapeHtml(this.patrolError.message)}</p>` : ''}
            <div>${controls}</div>
            <small>Hide preserves the encounter. Use the physical cockpit comms station to resume it.</small>
        `;
    }

    _syncPatrolPresentation() {
        if (!this.patrol) {
            this._removePatrolAgentVisual();
            return null;
        }
        const encounter = this.patrol.getState().activeEncounter;
        if (encounter) {
            this._updatePatrolAgentVisual(encounter);
            if (
                this.shipControls.pilotActive
                && ['hail', 'wait'].includes(encounter.phase)
                && this.patrolHailDismissedId !== encounter.id
            ) {
                if (!this.patrolHailOpen) this._openPatrolHailPanel();
            }
            if (this.patrolHailOpen) {
                this.patrolPanelEncounter = structuredClone(encounter);
                const renderKey = patrolPanelRenderKey(encounter, this.patrolError);
                if (renderKey !== this.patrolPanelRenderKey) this._renderPatrolHailPanel();
            }
        } else {
            this._removePatrolAgentVisual();
        }
        return encounter;
    }

    _updatePatrolAgentVisual(encounter) {
        if (!this.patrolAgentVisual) {
            const group = new THREE.Group();
            group.name = 'commonwealth-meridian-watch-placeholder';
            const hull = new THREE.Mesh(
                new THREE.ConeGeometry(3.6, 11, 6),
                new THREE.MeshStandardMaterial({
                    color: 0x98652f,
                    emissive: 0x5b280d,
                    emissiveIntensity: 0.55,
                    metalness: 0.72,
                    roughness: 0.34
                })
            );
            hull.rotation.x = Math.PI / 2;
            group.add(hull);
            const beacon = new THREE.PointLight(0xffb45d, 5.5, 70);
            beacon.position.set(0, 2.6, 0);
            group.add(beacon);
            const runningLight = new THREE.Mesh(
                new THREE.SphereGeometry(0.65, 10, 8),
                new THREE.MeshBasicMaterial({ color: 0xffd08a })
            );
            runningLight.position.set(0, 2.6, 0);
            group.add(runningLight);
            this.scene.add(group);
            this.patrolAgentVisual = group;
        }
        const gameTime = this.gameClock.getTime();
        const elapsed = Math.max(0, gameTime - encounter.phaseStartedAtGameTime);
        if (this.patrolVisualState?.encounterId !== encounter.id) {
            this.patrolVisualState = {
                encounterId: encounter.id,
                lastGameTime: gameTime,
                terminalPhase: null,
                terminalOrigin: null,
                terminalDirection: null
            };
            this.patrolAgentVisual.position.copy(
                this.ship.localToWorld(new THREE.Vector3(0, 4, -75))
            );
        }
        const visual = this.patrolVisualState;
        const dt = Math.max(0, Math.min(0.1, gameTime - visual.lastGameTime));
        visual.lastGameTime = gameTime;

        if (['depart', 'abort'].includes(encounter.phase)) {
            if (visual.terminalPhase !== encounter.phase) {
                visual.terminalPhase = encounter.phase;
                visual.terminalOrigin = this.patrolAgentVisual.position.clone();
                visual.terminalDirection = new THREE.Vector3(
                    encounter.phase === 'depart' ? 0.82 : 0.68,
                    encounter.phase === 'depart' ? 0.24 : 0.36,
                    encounter.phase === 'depart' ? 0.52 : 0.64
                ).applyQuaternion(this.ship.object3D.quaternion).normalize();
            }
            const speed = encounter.phase === 'depart' ? 24 : 42;
            this.patrolAgentVisual.position.copy(visual.terminalOrigin)
                .addScaledVector(visual.terminalDirection, elapsed * speed);
        } else {
            const stationKeeping = new THREE.Vector3(
                8 + Math.sin(gameTime * 0.43) * 2.2,
                5 + Math.sin(gameTime * 0.71) * 1.1,
                -30 + Math.cos(gameTime * 0.37) * 2.8
            );
            const desiredLocal = encounter.phase === 'spawn'
                ? new THREE.Vector3(0, 4, -75)
                : encounter.phase === 'approach'
                    ? new THREE.Vector3(2, 5, -56).lerp(stationKeeping, Math.min(1, elapsed / 5))
                    : stationKeeping;
            const desiredWorld = this.ship.localToWorld(desiredLocal);
            const response = encounter.phase === 'approach' ? 0.75 : 0.32;
            this.patrolAgentVisual.position.lerp(
                desiredWorld,
                1 - Math.exp(-response * Math.max(dt, 1 / 120))
            );
        }
        this.patrolAgentVisual.lookAt(this.ship.position);
        this.patrolAgentVisual.rotateY(Math.PI);
        this.patrolAgentVisual.visible = true;
    }

    _removePatrolAgentVisual() {
        if (!this.patrolAgentVisual) return false;
        this.scene.remove(this.patrolAgentVisual);
        this.patrolAgentVisual.traverse((node) => {
            node.geometry?.dispose?.();
            if (Array.isArray(node.material)) node.material.forEach((material) => material.dispose?.());
            else node.material?.dispose?.();
        });
        this.patrolAgentVisual = null;
        this.patrolVisualState = null;
        return true;
    }

    _createCargoTerminalPanel() {
        const panel = document.createElement('div');
        panel.id = 'cargo-terminal-panel';
        panel.innerHTML = `
            <style>
                #cargo-terminal-panel {
                    position: fixed; inset: 12% 18%; z-index: 24; display: none;
                    overflow: auto; padding: 18px; color: #e5fff3;
                    background: rgba(3, 15, 15, 0.96); border: 1px solid #68e0ad;
                    font: 13px/1.5 "Consolas", "Courier New", monospace;
                }
                #cargo-terminal-panel .cargo-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
                #cargo-terminal-panel section { border:1px solid rgba(104,224,173,.35); padding:12px; }
                #cargo-terminal-panel button { margin:4px; padding:7px 10px; color:#e5fff3; background:#0b3028; border:1px solid #68e0ad; }
                #cargo-terminal-panel .terminal-error { color:#ffaaaa; }
                @media (max-width:780px) { #cargo-terminal-panel { inset:6%; } #cargo-terminal-panel .cargo-grid { grid-template-columns:1fr; } }
            </style>
            <div data-cargo-terminal-content></div>
        `;
        document.body.appendChild(panel);
        this.cargoTerminalPanel = panel;
        this.cargoTerminalContentNode = panel.querySelector('[data-cargo-terminal-content]');
        panel.addEventListener('click', (event) => {
            const target = event.target.closest('[data-cargo-action]');
            if (!target) return;
            this._handleCargoTerminalAction(target.dataset.cargoAction);
        });
    }

    _openCargoTerminalPanel() {
        this.cargoTerminalOpen = true;
        this.cargoTerminalMessage = '';
        this._exitPointerLock();
        this._renderCargoTerminalPanel();
        return this.delivery?.getState() ?? null;
    }

    _closeCargoTerminalPanel() {
        this.cargoTerminalOpen = false;
        if (this.cargoTerminalPanel) this.cargoTerminalPanel.style.display = 'none';
        return false;
    }

    _handleCargoTerminalKeydown(event) {
        if (!this.cargoTerminalOpen) return false;
        if (event.code === 'Escape' || event.code === 'KeyC') {
            event.preventDefault();
            this._closeCargoTerminalPanel();
        }
        return true;
    }

    _handleCargoTerminalAction(action) {
        try {
            if (action === 'close') return this._closeCargoTerminalPanel();
            let result;
            if (action === 'salvage') {
                if (!this.condition) throw new Error(this.conditionError?.message ?? 'Ship condition runtime is unavailable.');
                result = this.condition.claimSalvage();
            } else if (action === 'stabilize') {
                if (!this.condition) throw new Error(this.conditionError?.message ?? 'Ship condition runtime is unavailable.');
                result = this.condition.stabilizeCriticalState();
            } else if (action.startsWith('repair-')) {
                if (!this.condition) throw new Error(this.conditionError?.message ?? 'Ship condition runtime is unavailable.');
                result = this.condition.repair(action.slice('repair-'.length));
            } else if (action.startsWith('market:')) {
                if (!this.economy) throw new Error(this.economyError?.message ?? 'Economy runtime is unavailable.');
                const [, side, cargoId, rawQuantity] = action.split(':');
                const quantity = Number(rawQuantity);
                if (side === 'buy') result = this.economy.buy(cargoId, quantity);
                else if (side === 'sell') result = this.economy.sell(cargoId, quantity);
                else throw new Error(`Unknown market transaction side: ${side}`);
            } else {
                if (!this.delivery) throw new Error(this.deliveryError?.message ?? 'Cargo runtime is unavailable.');
                if (action === 'load') result = this.delivery.loadMissionCargo();
                else if (action === 'deliver') result = this.delivery.deliverMissionCargo();
                else if (action === 'abandon') result = this.delivery.abandonMission();
                else if (action === 'lose') result = this.delivery.loseMissionCargo();
                else if (action === 'refuel') result = this.delivery.refuel();
                else if (action === 'rescue') result = this.delivery.emergencyRescue();
                else throw new Error(`Unknown cargo-terminal action: ${action}`);
            }
            if (action === 'salvage' || action === 'stabilize' || action.startsWith('repair-')) {
                this._refreshShipCapabilities();
            }
            this.cargoTerminalMessage = result?.changed === false
                ? `No change: ${result.reason ?? 'already applied'}.`
                : 'Authoritative ship state saved.';
        } catch (error) {
            this.cargoTerminalMessage = error instanceof Error ? error.message : String(error);
        }
        this._updateCommsPanel();
        this._renderCargoTerminalPanel();
        this._syncDebugDomState();
        return true;
    }

    _renderCargoTerminalPanel() {
        if (!this.cargoTerminalPanel || !this.cargoTerminalContentNode) return;
        this.cargoTerminalPanel.style.display = this.cargoTerminalOpen ? 'block' : 'none';
        if (!this.cargoTerminalOpen) return;
        if (!this.delivery) {
            this.cargoTerminalContentNode.innerHTML = `
                <h2>CARGO / FUEL TERMINAL</h2>
                <p class="terminal-error">${escapeHtml(this.deliveryError?.message ?? 'Phase 14 runtime unavailable.')}</p>
                <button data-cargo-action="close">Close</button>
            `;
            return;
        }
        const state = this.delivery.getState();
        const ship = state.ship;
        const mission = state.mission;
        const conditionState = this.condition?.getState() ?? null;
        const economyState = this.economy?.getState() ?? null;
        const stacks = ship.cargo.stacks.map((stack) => (
            `<li>${escapeHtml(stack.cargoId)} × ${stack.quantity}</li>`
        )).join('') || '<li>Empty</li>';
        const objectives = Object.values(mission.state.objectives.byId).map((objective) => (
            `<li>${escapeHtml(objective.id)} — ${escapeHtml(objective.status)}</li>`
        )).join('');
        const pending = ship.travel.pendingJump
            ? `${escapeHtml(ship.travel.pendingJump.originSystemId)} → ${escapeHtml(ship.travel.pendingJump.targetSystemId)} / ${ship.travel.pendingJump.fuelCost} fuel`
            : 'none';
        const conditionRows = conditionState
            ? [
                ['hull', conditionState.condition.hull.current],
                ...Object.entries(conditionState.condition.systems)
                    .map(([id, record]) => [id, record.condition])
            ].map(([id, value]) => (
                `<li>${escapeHtml(id)}: ${Number(value).toFixed(0)} / 100 `
                + `<button data-cargo-action="repair-${escapeHtml(id)}">Repair</button></li>`
            )).join('')
            : '<li>Condition runtime unavailable</li>';
        const capabilityRows = conditionState
            ? Object.entries(conditionState.capabilities).map(([id, value]) => (
                `<li>${escapeHtml(id)}: ${(value * 100).toFixed(0)}%</li>`
            )).join('')
            : '';
        const marketReports = economyState
            ? economyState.reports.map((report) => {
                const rows = TRADE_GOOD_IDS.map((cargoId) => {
                    const quote = report.goods[cargoId];
                    const listing = MARKET_DEFINITIONS[report.marketId].goods[cargoId];
                    const cargoName = getCargoDefinition(cargoId).name;
                    const balance = quote.stock > listing.targetStock
                        ? 'SURPLUS'
                        : quote.stock < listing.targetStock
                            ? 'SHORTAGE'
                            : 'BALANCED';
                    const controls = report.local
                        ? `${listing.buyAllowed ? `<button data-cargo-action="market:buy:${escapeHtml(cargoId)}:1">Buy 1</button><button data-cargo-action="market:buy:${escapeHtml(cargoId)}:5">Buy 5</button>` : ''}
                           ${listing.sellAllowed ? `<button data-cargo-action="market:sell:${escapeHtml(cargoId)}:1">Sell 1</button><button data-cargo-action="market:sell:${escapeHtml(cargoId)}:5">Sell 5</button>` : ''}`
                        : '';
                    return `<li>${escapeHtml(cargoName)} (${escapeHtml(cargoId)}): ${balance}, stock ${quote.stock}, buy ${quote.buyPrice}, sell ${quote.sellPrice} ${controls}</li>`;
                }).join('');
                return `
                    <section>
                        <h3>${escapeHtml(report.name)} ${report.local ? '[LOCAL / LIVE]' : '[REMOTE]'}</h3>
                        <p>Observed at ${formatGameTime(report.observedAtGameTime)}; age ${formatGameTime(report.ageSeconds)}</p>
                        <ul>${rows}</ul>
                    </section>
                `;
            }).join('')
            : `<section><h3>Markets unavailable</h3><p class="terminal-error">${escapeHtml(this.economyError?.message ?? 'Economy runtime unavailable.')}</p></section>`;
        this.cargoTerminalContentNode.innerHTML = `
            <div style="display:flex;justify-content:space-between"><h2>CARGO / FUEL / MAINTENANCE</h2><button data-cargo-action="close">Close</button></div>
            <div class="cargo-grid">
                <section>
                    <h3>Ship stores</h3>
                    <p>Credits: ${ship.credits}</p>
                    <p>Fuel: ${ship.fuel.current} / ${ship.fuel.capacity} (reserve ${ship.fuel.reserve})</p>
                    <p>Cargo mass: ${state.usedCargoMass} / ${ship.cargo.capacityMass}</p>
                    <ul>${stacks}</ul>
                    <button data-cargo-action="refuel">Buy 10 fuel / 25 credits</button>
                    <button data-cargo-action="rescue">Emergency rescue / up to 50 credits</button>
                </section>
                <section>
                    <h3>The Weight of a Copy</h3>
                    <p>Status: ${escapeHtml(mission.state.status)} / ${escapeHtml(mission.state.outcomeId ?? 'none')}</p>
                    <p>Active system: ${escapeHtml(state.activeSystemId ?? 'none')}</p>
                    <p>Pending jump: ${pending}</p>
                    <ol>${objectives}</ol>
                    <button data-cargo-action="load">Load mission cargo</button>
                    <button data-cargo-action="deliver">Deliver mission cargo</button>
                    <button data-cargo-action="abandon">Abandon job</button>
                    <button data-cargo-action="lose">Jettison / report cargo lost</button>
                </section>
                <section>
                    <h3>Ship condition</h3>
                    <p>Repair parts: ${conditionState?.inventory.repairParts ?? 'unavailable'}</p>
                    <p>Hull plates: ${conditionState?.inventory.hullPlates ?? 'unavailable'}</p>
                    <ul>${conditionRows}</ul>
                    <h3>Bounded capability</h3>
                    <ul>${capabilityRows}</ul>
                    <p>Derelict cache: ${
                        conditionState?.maintenance.salvageSources.index_k7_derelict_cache.claimed
                            ? 'recovered'
                            : conditionState?.salvageAvailable
                                ? 'in range'
                                : 'not in range'
                    }</p>
                    <button data-cargo-action="salvage">Recover K-7 derelict cache</button>
                    <button data-cargo-action="stabilize">Emergency stabilization</button>
                </section>
                ${marketReports}
            </div>
            <p>${escapeHtml(this.cargoTerminalMessage)}</p>
            <small>Local trades settle atomically at integer prices. Remote reports are age-stamped. No crafting, finance, autonomous budgets, or cargo confiscation.</small>
        `;
    }

    _createSurfaceOutpostPanel() {
        const panel = document.createElement('div');
        panel.id = 'surface-outpost-panel';
        panel.innerHTML = `
            <style>
                #surface-outpost-panel {
                    position: fixed; left: 50%; bottom: 42px; transform: translateX(-50%);
                    width: min(560px, calc(100vw - 36px)); max-height: 58vh; overflow: auto;
                    z-index: 25; display: none; padding: 15px; color: #dff9ff;
                    background: rgba(2, 15, 20, .96); border: 1px solid #66d9ee;
                    font: 13px/1.5 "Consolas", "Courier New", monospace;
                    box-shadow: 0 0 28px rgba(70, 210, 235, .18);
                }
                #surface-outpost-panel .surface-head { display:flex; justify-content:space-between; gap:12px; }
                #surface-outpost-panel .surface-status { color:#8ff3dd; text-transform:uppercase; }
                #surface-outpost-panel .surface-error { color:#ffaaa2; }
                #surface-outpost-panel button { margin:4px; padding:7px 9px; color:#e5fbff; background:#10313a; border:1px solid #559ca4; }
            </style>
            <div data-surface-outpost-content></div>
        `;
        document.body.appendChild(panel);
        this.surfaceOutpostPanel = panel;
        this.surfaceOutpostContentNode = panel.querySelector('[data-surface-outpost-content]');
        panel.addEventListener('click', (event) => {
            const target = event.target.closest('[data-surface-action]');
            if (!target) return;
            event.preventDefault();
            if (target.dataset.surfaceAction === 'close') this._closeSurfaceOutpostPanel();
            else if (target.dataset.surfaceAction === 'verify') this._verifySurfaceOutpostTerminal();
        });
    }

    _openSurfaceOutpostPanel() {
        if (!this.surfaceOutpost) {
            this.surfaceOutpostMessage = this.surfaceOutpostError?.message ?? 'Surface outpost runtime unavailable.';
        }
        this.surfaceOutpostPanelOpen = true;
        this._exitPointerLock();
        this._renderSurfaceOutpostPanel();
        return this.surfaceOutpost?.getState() ?? null;
    }

    _closeSurfaceOutpostPanel() {
        this.surfaceOutpostPanelOpen = false;
        if (this.surfaceOutpostPanel) this.surfaceOutpostPanel.style.display = 'none';
        return false;
    }

    _handleSurfaceOutpostKeydown(event) {
        if (!this.surfaceOutpostPanelOpen) return false;
        if (event.code === 'Escape' || event.code === 'KeyC') {
            event.preventDefault();
            this._closeSurfaceOutpostPanel();
            return true;
        }
        if (event.code === 'Enter') {
            event.preventDefault();
            this._verifySurfaceOutpostTerminal();
            return true;
        }
        return false;
    }

    _verifySurfaceOutpostTerminal() {
        try {
            if (!this.surfaceOutpost) throw new Error(this.surfaceOutpostError?.message ?? 'Surface outpost runtime unavailable.');
            const playerPosition = this.playerRig.object3D.getWorldPosition(new THREE.Vector3());
            const interaction = this.environment?.getSurfaceInteraction?.(playerPosition);
            const result = this.surfaceOutpost.interact(SURFACE_OUTPOST_ID, {
                playerState: this.playerController.getState(),
                distanceMetres: interaction?.distance
            });
            this.surfaceOutpostMessage = result.changed
                ? 'Archive beacon verified. Return to the ship.'
                : 'Archive beacon was already verified.';
        } catch (error) {
            this.surfaceOutpostMessage = error instanceof Error ? error.message : String(error);
        }
        this._renderSurfaceOutpostPanel();
        this._syncDebugDomState();
        return true;
    }

    _renderSurfaceOutpostPanel() {
        if (!this.surfaceOutpostPanel || !this.surfaceOutpostContentNode) return;
        this.surfaceOutpostPanel.style.display = this.surfaceOutpostPanelOpen ? 'block' : 'none';
        if (!this.surfaceOutpostPanelOpen) return;
        const state = this.surfaceOutpost?.getState() ?? null;
        this.surfaceOutpostContentNode.innerHTML = `
            <div class="surface-head"><div><h2>K-7 CARTOGRAPHY ANNEX</h2>
            <div class="surface-status">${escapeHtml(state?.progress.checkpoint ?? 'unavailable')}</div></div>
            <button data-surface-action="close">Close</button></div>
            <p>Index survey terminal / beacon channel 07. This deterministic terminal records one verification only.</p>
            <button data-surface-action="verify">Verify archive beacon</button>
            <p class="surface-error">${escapeHtml(this.surfaceOutpostMessage)}</p>
            <small>No market, interior, combat, or generated authority is connected.</small>
        `;
    }

    _createCrewPanel() {
        const panel = document.createElement('div');
        panel.id = 'crew-dialogue-panel';
        panel.innerHTML = `
            <style>
                #crew-dialogue-panel {
                    position: fixed; left: 50%; bottom: 42px; transform: translateX(-50%);
                    width: min(620px, calc(100vw - 36px)); max-height: 62vh; overflow: auto;
                    z-index: 25; display: none; padding: 15px; color: #e5fbff;
                    background: rgba(3, 12, 18, .95); border: 1px solid #6ccbd1;
                    font: 13px/1.5 "Consolas", "Courier New", monospace;
                    box-shadow: 0 0 28px rgba(54, 184, 194, .18);
                }
                #crew-dialogue-panel .crew-head { display:flex; justify-content:space-between; gap:12px; }
                #crew-dialogue-panel .crew-name { color:#8ff3dd; font-weight:bold; }
                #crew-dialogue-panel .crew-status { color:#ffc982; text-transform:uppercase; }
                #crew-dialogue-panel .crew-text { margin:12px 0; padding:10px; border-left:2px solid #6ccbd1; }
                #crew-dialogue-panel .crew-error { color:#ffaaa2; }
                #crew-dialogue-panel button { margin:4px; padding:7px 9px; color:#e5fbff; background:#10313a; border:1px solid #559ca4; }
                #crew-dialogue-panel .dlg-reply { margin:10px 0; padding:9px 10px; border-left:2px solid #74ffb0; background:rgba(20,50,40,.3); }
                #crew-dialogue-panel .dlg-input-row { display:flex; gap:6px; margin:10px 4px 4px; }
                #crew-dialogue-panel .dlg-input-row input { flex:1 1 auto; min-width:0; padding:7px 9px; color:#e5fbff; background:rgba(8,22,30,.9); border:1px solid #559ca4; font:inherit; }
                #crew-dialogue-panel .dlg-status { margin:6px 4px; color:rgba(210,232,255,.55); font-size:11px; }
            </style>
            <div data-crew-content></div>
        `;
        document.body.appendChild(panel);
        this.crewPanel = panel;
        this.crewContentNode = panel.querySelector('[data-crew-content]');
        panel.addEventListener('click', (event) => {
            const target = event.target.closest('[data-crew-action]');
            if (!target) return;
            event.preventDefault();
            const action = target.dataset.crewAction;
            if (action === 'close') this._closeCrewPanel();
            else if (action === 'interrupt') {
                this.crew.interrupt();
                this._updateCrewPanel();
            } else if (action === 'voice') {
                this.crew.requestPresentation().finally(() => this._updateCrewPanel());
                this._updateCrewPanel();
            } else if (action === 'listen') {
                this.crew.beginListening();
                this._updateCrewPanel();
            } else if (action === 'choose') {
                this.crew.chooseRelationship(target.dataset.crewId);
                this._syncCrewPresence();
                this._updateCrewPanel();
            } else if (action === 'llm-toggle') {
                this._setDialogueServiceEnabled(!this.dialogueServiceEnabled);
            } else if (action === 'say') {
                const input = panel.querySelector('[data-crew-freetext]');
                const value = input?.value ?? '';
                if (input) input.value = '';
                this._sayDialogueFreeText(this.crew.getState().npc.id, value, () => this._updateCrewPanel());
            }
        });
        panel.addEventListener('keydown', (event) => {
            const input = event.target.closest?.('[data-crew-freetext]');
            if (!input || event.key !== 'Enter') return;
            event.preventDefault();
            event.stopPropagation();
            const value = input.value;
            input.value = '';
            this._sayDialogueFreeText(this.crew.getState().npc.id, value, () => this._updateCrewPanel());
        });
    }

    _openCrewPanel() {
        const state = this.crew.openInteraction();
        this.crewPanelOpen = true;
        this._exitPointerLock();
        this._syncCrewPresence();
        this._updateCrewPanel();
        this._syncDebugDomState();
        return state;
    }

    _closeCrewPanel() {
        const state = this.crew.closeInteraction();
        this.crewPanelOpen = false;
        this._updateCrewPanel();
        this._syncDebugDomState();
        return state;
    }

    _handleCrewKeydown(event) {
        if (!this.crewPanelOpen) return false;
        if (event.code === 'Escape' || event.code === 'KeyC') {
            event.preventDefault();
            this._closeCrewPanel();
            return true;
        }
        if (/^Digit[1-2]$/.test(event.code)) {
            const choice = this.crew.getState().choices[Number(event.code.slice(5)) - 1];
            if (choice) {
                event.preventDefault();
                this.crew.chooseRelationship(choice.id);
                this._updateCrewPanel();
                return true;
            }
        }
        return false;
    }

    _updateCrewPanel() {
        if (!this.crewPanel || !this.crewContentNode) return;
        this.crewPanel.style.display = this.crewPanelOpen ? 'block' : 'none';
        if (!this.crewPanelOpen) return;
        const state = this.crew.getState();
        const text = state.presentationText ?? state.authoredBeat.text;
        const choices = state.choices.map((choice, index) => (
            `<button data-crew-action="choose" data-crew-id="${escapeHtml(choice.id)}">${index + 1}. ${escapeHtml(choice.label)}</button>`
        )).join('');
        this.crewContentNode.innerHTML = `
            <div class="crew-head">
                <div><div class="crew-name">${escapeHtml(state.npc.name)}</div>
                <div>${escapeHtml(state.npc.title)} · relationship ${state.npc.state.relationship.toFixed(2)} · mood ${escapeHtml(state.npc.state.mood)}</div></div>
                <button data-crew-action="close">Close</button>
            </div>
            <div class="crew-status">${escapeHtml(state.status)}</div>
            <div class="crew-text">${escapeHtml(text)}</div>
            <div>${choices}</div>
            <div>
                <button data-crew-action="listen">Listening state</button>
                <button data-crew-action="voice">Optional voice/LLM presentation</button>
                <button data-crew-action="interrupt">Interrupt</button>
            </div>
            ${this._renderDialogueControlsHtml(state.npc.id, 'crew')}
            <div class="crew-error">${escapeHtml(state.error ?? '')}</div>
            <small>Authored text is authoritative and works offline. The optional provider receives read-only context and cannot change game state.</small>
        `;
        if (this._refocusDialogueInput) {
            this.crewContentNode.querySelector('[data-crew-freetext]')?.focus();
            this._refocusDialogueInput = false;
        }
    }

    _syncCrewPresence() {
        const present = Boolean(this.crew?.isPresent?.());
        this.ship.setCrewAvatarVisible?.(present);
        if (!present && this.crewPanelOpen) this._closeCrewPanel();
        return present;
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
                #cockpit-comms-panel .dlg-reply {
                    margin: 10px 0;
                    padding: 9px 10px;
                    border-left: 2px solid #74ffb0;
                    color: #e9f5ff;
                    background: rgba(20, 50, 40, 0.32);
                }
                #cockpit-comms-panel .dlg-input-row {
                    display: flex;
                    gap: 6px;
                    margin-top: 10px;
                }
                #cockpit-comms-panel .dlg-input-row input {
                    flex: 1 1 auto;
                    min-width: 0;
                    padding: 7px 9px;
                    color: #e9f5ff;
                    background: rgba(8, 22, 40, 0.9);
                    border: 1px solid rgba(155, 220, 255, 0.42);
                    border-radius: 4px;
                    font: inherit;
                }
                #cockpit-comms-panel .dlg-status {
                    margin-top: 8px;
                    color: rgba(210, 232, 255, 0.6);
                    font-size: 11px;
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
            else if (action === 'llm-toggle') this._setDialogueServiceEnabled(!this.dialogueServiceEnabled);
            else if (action === 'say') {
                const input = panel.querySelector('[data-comms-freetext]');
                const value = input?.value ?? '';
                if (input) input.value = '';
                const contactId = this.rpg.getCommsState().activeContactId;
                this._sayDialogueFreeText(contactId, value, () => this._updateCommsPanel());
            }
        });
        panel.addEventListener('keydown', (event) => {
            const input = event.target.closest?.('[data-comms-freetext]');
            if (!input || event.key !== 'Enter') return;
            event.preventDefault();
            event.stopPropagation();
            const value = input.value;
            input.value = '';
            const contactId = this.rpg.getCommsState().activeContactId;
            this._sayDialogueFreeText(contactId, value, () => this._updateCommsPanel());
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

    // Phase 24 — route a free-text utterance through the dialogue arbiter. An
    // authored beat is applied via the authoritative comms path (advancing the
    // node); an open turn goes to the LLM/canned reply. Never throws into flight.
    async _sayDialogueFreeText(npcId, rawText, refresh) {
        const text = String(rawText ?? '').trim();
        if (!text || !this.dialogue || !npcId) return;
        try {
            if (this.dialogue.npcId !== npcId || !this.dialogue.open) {
                this.dialogue.openConversation(npcId);
                this.dialogue.setServiceOnline(this.dialogueServiceEnabled);
            }
            this._dialoguePending = true;
            refresh();
            await this.dialogue.say(text);
        } catch (error) {
            console.warn('Dialogue turn failed; conversation remains usable.', error);
        } finally {
            this._dialoguePending = false;
            this._refocusDialogueInput = true;
            refresh();
        }
    }

    _setDialogueServiceEnabled(enabled) {
        this.dialogueServiceEnabled = Boolean(enabled);
        this.dialogue?.setServiceOnline(this.dialogueServiceEnabled);
        if (this.commsPanelOpen) this._updateCommsPanel();
        if (this.crewPanelOpen) this._updateCrewPanel();
        this._syncDebugDomState();
        return this.dialogueServiceEnabled;
    }

    // Shared free-text controls for the comms and crew panels. `ns` is the panel's
    // data-attribute namespace ('comms' | 'crew').
    _renderDialogueControlsHtml(npcId, ns) {
        if (!this.dialogue || !npcId) return '';
        const dlg = this.dialogue.npcId === npcId ? this.dialogue.getState() : null;
        const reply = dlg && dlg.lastTurnKind === 'open_dialogue' ? dlg.presentationText : null;
        const routing = this.dialogue.getRouting?.(npcId) ?? null;
        const budget = this.dialogue.getBudget?.() ?? null;
        const llmLabel = this.dialogueServiceEnabled ? 'LLM: ON' : 'LLM: OFF';
        const status = this._dialoguePending
            ? 'Channel is responding…'
            : `${routing ? `${escapeHtml(routing.model)} · ${escapeHtml(routing.reason)}` : 'authored/canned'}`
                + `${budget ? ` · tokens ${budget.sessionTokens}/${budget.sessionTokenCap}` : ''}`;
        const replyHtml = reply ? `<div class="dlg-reply">${escapeHtml(reply)}</div>` : '';
        return `
            ${replyHtml}
            <div class="dlg-input-row">
                <input type="text" data-${ns}-freetext placeholder="Say anything…" autocomplete="off" />
                <button data-${ns}-action="say">Send</button>
                <button data-${ns}-action="llm-toggle">${llmLabel}</button>
            </div>
            <div class="dlg-status">${status}</div>
        `;
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

        // Phase 24 free-text dialogue: authored choices above stay authoritative;
        // anything typed here is arbitrated and, if open, answered by the LLM.
        lines.push(this._renderDialogueControlsHtml(active.id, 'comms'));
        this.commsContentNode.innerHTML = lines.join('');
        if (this._refocusDialogueInput) {
            this.commsContentNode.querySelector('[data-comms-freetext]')?.focus();
            this._refocusDialogueInput = false;
        }
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
                this.selectedNavigationTargetDepth = null;
            } else {
                this.selectedNavigationTarget = poi;
                this.selectedNavigationTargetDepth = this.scaleStack.depth;
                if (poi.rpg?.surfacePoiId === SURFACE_COMBAT_SITE_ID && this.surfaceCombat) {
                    try {
                        this.surfaceCombat.scan({
                            siteId: poi.rpg.surfacePoiId,
                            systemId: poi.rpg.namedSystemId,
                            planetId: poi.rpg.planetId
                        });
                    } catch (error) {
                        this.surfaceCombatError = {
                            context: 'hostile-site navigation discovery',
                            message: error instanceof Error ? error.message : String(error)
                        };
                    }
                } else if (poi.rpg?.surfacePoiId && this.surfaceOutpost) {
                    try {
                        this.surfaceOutpost.scan(poi.rpg.surfacePoiId, {
                            systemId: poi.rpg.namedSystemId,
                            planetId: poi.rpg.planetId
                        });
                    } catch (error) {
                        this.surfaceOutpostMessage = error instanceof Error ? error.message : String(error);
                    }
                }
                if (poi.rpg?.boardingPoiId && this.boarding) {
                    try {
                        this.boarding.discover(poi.rpg.boardingPoiId, {
                            systemId: poi.rpg.namedSystemId
                        });
                    } catch (error) {
                        this.boardingError = {
                            context: 'boarding navigation discovery',
                            message: error instanceof Error ? error.message : String(error)
                        };
                    }
                }
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
        if (this.surfaceCombatCrosshair) {
            this.surfaceCombatCrosshair.style.display = (
                this.displayMode !== 'vr'
                && this._surfaceWeaponEquipped()
            ) ? 'block' : 'none';
        }
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
        const driveLabel = this.shipControls.hyperdriveEngaged || this.ship.getHyperdriveLevel() > 0.01 || this.autopilot.isActive()
            ? `<span class="on">${this._hyperdriveDriveLabel()}</span>`
            : '<span class="off">PRECISION</span>';
        const padId = gamepad.id && gamepad.id.length > 34 ? `${gamepad.id.slice(0, 31)}...` : gamepad.id;

        const lines = [
            `<b>VIEW</b> ${mode}    <b>PILOT</b> ${flag(controls.pilotActive)} ${brake}`,
            `<b>DAMPENERS</b> ${dampLabel}    <b>DRIVE</b> ${driveLabel}`,
            `<b>PAD</b> ${gamepad.connected ? `<span class="on">${padId || 'CONNECTED'}</span>` : '<span class="off">OFF</span>'}`,
            `<b>SPEED</b> ${speed.toFixed(1)} m/s   <b>ANG</b> ${angSpeed.toFixed(1)} deg/s`
        ];
        if (this.delivery) {
            const delivery = this.delivery.getState();
            lines.push(
                `<b>FUEL</b> ${delivery.ship.fuel.current}/${delivery.ship.fuel.capacity} reserve ${delivery.ship.fuel.reserve}   <b>CARGO</b> ${delivery.usedCargoMass}/${delivery.ship.cargo.capacityMass}`
            );
        }
        if (this.condition) {
            const condition = this.condition.getState();
            lines.push(
                `<b>HULL</b> ${condition.condition.hull.current.toFixed(0)}   `
                + `<b>ENG</b> ${condition.condition.systems.engine.condition.toFixed(0)}   `
                + `<b>SENS</b> ${condition.condition.systems.sensors.condition.toFixed(0)}`
            );
        }
        const combat = this.combat?.getState();
        if (combat) {
            lines.push(
                `<b>COMBAT MODE</b> ${combat.combatMode ? '<span class="warn">ARMED</span>' : '<span class="off">SAFE</span>'}`
                + ' (B / D-PAD DOWN)'
            );
        }
        if (combat?.active) {
            const target = combat.target;
            lines.push(
                `<b>COMBAT</b> ${escapeHtml(combat.phase.toUpperCase())}   `
                + (target
                    ? `<b>LOCK</b> ${escapeHtml(target.id)} ${target.range.toFixed(0)}m ${target.inRange ? '<span class="on">IN RANGE</span>' : '<span class="warn">OUT OF RANGE</span>'}`
                    : combat.combatMode
                        ? '<span class="warn">TAB / TRIANGLE / LEFT TRIGGER TO LOCK</span>'
                        : '<span class="off">WEAPONS SAFE</span>')
            );
            if (!combat.warningIssued) {
                lines.push(`<b>HOSTILE COMMS</b> ${(combat.warningDelayRemaining ?? 0).toFixed(1)}s`);
            } else if ((combat.attackGraceRemaining ?? 0) > 0) {
                lines.push(`<b>ATTACK GRACE</b> <span class="warn">${combat.attackGraceRemaining.toFixed(1)}s</span>`);
            }
            lines.push(
                `<b>HEAT</b> ${combat.hardpoints.map((entry) => `${escapeHtml(entry.id)} ${(entry.heat * 100).toFixed(0)}%`).join(' / ')}`
            );
            if (combat.phase === 'defeated') {
                lines.push('<span class="warn">SHIP DISABLED — PRESS Y FOR TOW / RESCUE</span>');
            }
        }
        if (this.combatError) lines.push(`<span class="warn">${escapeHtml(this.combatError.message)}</span>`);
        const surfaceCombat = this.surfaceCombat?.getState();
        if (surfaceCombat?.active) {
            lines.push(
                `<b>SURFACE COMBAT</b> ${escapeHtml((surfaceCombat.enemy?.phase ?? 'active').toUpperCase())}   `
                + `DRONE ${Math.round(surfaceCombat.enemy?.integrity ?? 0)}   `
                + `SUIT ${Math.round(surfaceCombat.saved.suitIntegrity)}`
            );
            lines.push(
                `<b>PULSE HEAT</b> ${Math.round(surfaceCombat.heat * 100)}%   `
                + (this._surfaceWeaponEquipped()
                    ? `<span class="warn">Mouse / R2 / right select to fire</span>`
                    : '<span class="off">WEAPONS SAFE</span>')
            );
        } else if (surfaceCombat?.saved?.checkpoint === 'objective_recovered') {
            lines.push(`<b>BLACK CACHE</b> Core secured — return aboard`);
        }
        if (this.surfaceCombatError) {
            lines.push(`<span class="warn">${escapeHtml(this.surfaceCombatError.message)}</span>`);
        }
        const boarding = this.boarding?.getState();
        if (boarding && boarding.player.location !== 'ship') {
            const spatial = this.playerController.getBoardingPlayerState?.();
            const oxygen = boarding.player.oxygenRemaining;
            const oxygenClass = oxygen <= 30 ? 'warn' : 'on';
            lines.push(
                `<b>EVA O2</b> <span class="${oxygenClass}">${oxygen.toFixed(0)}s</span>   `
                + `<b>SHIP</b> ${(spatial?.shipDistance ?? 0).toFixed(1)}m   `
                + `<b>WRECK</b> ${(spatial?.hatchDistance ?? 0).toFixed(1)}m`
            );
            lines.push(
                `<b>BOARDING</b> ${escapeHtml(boarding.progress.checkpoint.toUpperCase())}   `
                + '<span class="warn">Y / CIRCLE / A: SAFE RETURN</span>'
            );
        }
        if (this.boardingError) lines.push(`<span class="warn">${escapeHtml(this.boardingError.message)}</span>`);
        if (this.cargoTerminalMessage) lines.push(`<span class="warn">${escapeHtml(this.cargoTerminalMessage)}</span>`);
        const patrolEncounter = this.patrol?.getState().activeEncounter;
        if (patrolEncounter) {
            lines.push(
                `<b>PATROL</b> ${escapeHtml(patrolEncounter.agentId)} / ${escapeHtml(patrolEncounter.phase)}`
            );
        }

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
        lines.push(
            `<b>ANCHOR</b> ${
                this.playerController.getState() === PLAYER_STATE.SURFACE || this._boardingSessionActive()
                    ? 'PLAYER'
                    : 'SHIP'
            }`
        );

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
            boarding: this.boarding?.getState() ?? null,
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
        window.addEventListener('pagehide', () => this._checkpointGameClock('pagehide'));
        window.addEventListener('beforeunload', () => this._checkpointGameClock('beforeunload'));
        document.addEventListener('visibilitychange', () => {
            this.gameClock.setActive(false);
            this._checkpointGameClock('visibility-change');
        });
        this.canvas.addEventListener('mousedown', (event) => {
            if (
                event.button === 0
                && this._surfaceWeaponEquipped()
            ) {
                this._fireSurfaceWeapon();
                return;
            }
            if (
                event.button === 0
                && this.shipControls.pilotActive
                && this.combat?.getState().active
                && this.combat?.getState().combatMode
            ) {
                this._fireCombatWeapon();
            }
        });
        window.addEventListener('keydown', (event) => {
            this._unlockAudioFromGesture();

            // Typing in a text field (e.g. the dialogue free-text input) must
            // never drive the ship or trigger keybinds. Escape still passes
            // through so panels can close.
            const focused = document.activeElement;
            if (focused && typeof focused.matches === 'function'
                && focused.matches('input, textarea') && event.code !== 'Escape') {
                return;
            }

            if (this._handleCombatWarningKeydown(event)) return;
            if (this._handlePatrolKeydown(event)) return;
            if (this._handleSurfaceOutpostKeydown(event)) return;
            if (this._handleCrewKeydown(event)) return;
            if (this._handleCargoTerminalKeydown(event)) return;
            if (this._handleShipComputerKeydown(event)) return;
            if (this._handleCommsKeydown(event)) return;
            if (this._handleNavigationKeydown(event)) return;
            if (this._handleRadioKeydown(event)) return;

            if (event.code === 'Tab' && !event.repeat && this.shipControls.pilotActive) {
                event.preventDefault();
                this._cycleCombatTarget();
                this._syncDebugDomState();
                return;
            }

            if (
                event.code === 'KeyB'
                && !event.repeat
                && canToggleCombatModeInPlayerState(this.playerController.getState())
            ) {
                event.preventDefault();
                this._toggleCombatMode();
                this._syncDebugDomState();
                return;
            }

            if (event.code === 'KeyY' && !event.repeat && this._boardingSessionActive()) {
                event.preventDefault();
                this._recoverBoarding('explicit');
                this._syncDebugDomState();
                return;
            }

            if (event.code === 'KeyY' && !event.repeat && this.combat?.getState().phase === 'defeated') {
                event.preventDefault();
                this._rescueCombatDefeat();
                this._syncDebugDomState();
                return;
            }

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
                    this._handlePlayerInteraction(action);
                    this._syncDebugDomState();
                }
                return;
            }

            // Phase 5: direct testing shortcut for inside <-> outside EVA.
            if (event.code === 'KeyT') {
                event.preventDefault();
                if (!event.repeat && this.cameraMode === 'player') {
                    if (this._boardingSessionActive()) this._recoverBoarding('runtime-recovery');
                    else this.playerController.teleportEvaToggle?.();
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
                if (
                    !event.repeat
                    && !this._boardingSessionActive()
                    && this.shipControls.pilotActive
                    && (this.postFxConfig.hyperdrive?.enabled ?? true)
                ) {
                    if (this.shipControls.handleToggleKey('Space') === 'hyperdrive') {
                        this._onHyperdriveToggled();
                    }
                }
                return;
            }

            // KeyU toggles autopilot.
            if (event.code === 'KeyU') {
                event.preventDefault();
                if (!event.repeat && this.shipControls.pilotActive) {
                    if (this.shipControls.handleToggleKey('KeyU') === 'autopilot') {
                        const shouldActive = this.shipControls.autopilotActive;
                        if (shouldActive) {
                            const engaged = this.selectedNavigationTarget?.rpg?.combatTargetId
                                ? false
                                : this.autopilot.engage(this.ship, this.selectedNavigationTarget, this.scaleStack.active.tier, this.scaleStack.isTransitioning);
                            if (!engaged) {
                                this.shipControls.autopilotActive = false;
                            } else {
                                this.input.gamepad.pulse({ duration: 90, weak: 0.25, strong: 0.45 });
                            }
                        } else {
                            this.autopilot.disengage();
                        }
                        this._syncDebugDomState();
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
            if (this.cameraMode === 'player' && !this.postPanel.visible && !this.universePanel.visible && !this.commsPanelOpen && !this.navigationPanelOpen && !this.radioOpen && !this.shipComputerOpen && !this.cargoTerminalOpen && !this.crewPanelOpen && !this.surfaceOutpostPanelOpen && !this.patrolHailOpen) {
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
                this.rpg.reset();
                this._reloadActiveSlot();
                const state = this.rpg.getState();
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
                queryEvents: (query) => this.rpg.queryEvents(query),
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
                    this.rpg.reset();
                    this._reloadActiveSlot();
                    const state = this.rpg.getState();
                    this._syncDebugDomState();
                    return state;
                }
            },
            delivery: {
                getState: () => this.delivery?.getState() ?? { unavailable: this.deliveryError },
                syncSystem: (id) => this.delivery?.syncSystem(id),
                loadCargo: () => this.delivery?.loadMissionCargo(),
                beginJump: (targetSystemId) => this.delivery?.beginAuthoredJump(targetSystemId),
                deliver: () => this.delivery?.deliverMissionCargo(),
                abandon: () => this.delivery?.abandonMission(),
                loseCargo: () => this.delivery?.loseMissionCargo(),
                refuel: () => this.delivery?.refuel(),
                emergencyRescue: () => this.delivery?.emergencyRescue(),
                setFuelForDebug: (value) => this.delivery?.setFuelForDebug(value),
                addCargoForDebug: (cargoId, quantity) => this.delivery?.addCargoForDebug(cargoId, quantity),
                openTerminal: () => this._openCargoTerminalPanel(),
                closeTerminal: () => this._closeCargoTerminalPanel()
            },
            economy: {
                getState: () => this.economy?.getState() ?? { unavailable: this.economyError },
                getMarket: (marketId) => this.economy?.getMarket(marketId),
                getReports: () => this.economy?.getReports(),
                syncSystem: (systemId) => this.economy?.syncSystem(systemId),
                update: (gameTime = this.gameClock.getTime()) => this.economy?.update(gameTime),
                buy: (cargoId, quantity = 1) => this.economy?.buy(cargoId, quantity),
                sell: (cargoId, quantity = 1) => this.economy?.sell(cargoId, quantity),
                openTerminal: () => this._openCargoTerminalPanel(),
                closeTerminal: () => this._closeCargoTerminalPanel()
            },
            world: {
                getState: () => this.world?.getState() ?? { unavailable: this.worldError },
                getFaction: (id) => this.world?.getFaction(id),
                getRelationships: () => this.world?.getRelationships(),
                getTerritory: () => this.world?.getTerritory(),
                getLod: (id) => (id ? this.world?.getLod(id) : this.world?.getLodMap()),
                getEvents: (query) => this.world?.getEvents(query),
                promote: (id, tier) => this.world?.promote(id, tier),
                demote: (id, tier) => this.world?.demote(id, tier),
                materialize: (id) => this.world?.materialize(id),
                enqueueCommand: (command) => this.world?.enqueueCommand(command),
                step: () => this.world?.update(this.gameClock.getTime()),
                soak: (ticks = 1000000) => this.world?.soak(ticks)
            },
            condition: {
                getState: () => this.condition?.getState() ?? { unavailable: this.conditionError },
                getCapabilities: () => this.condition?.getState().capabilities ?? null,
                syncSystem: (systemId) => this.condition?.syncSystem(systemId),
                claimSalvage: () => {
                    const result = this.condition?.claimSalvage();
                    this._refreshShipCapabilities();
                    return result;
                },
                repair: (targetId) => {
                    const result = this.condition?.repair(targetId);
                    this._refreshShipCapabilities();
                    return result;
                },
                stabilize: () => {
                    const result = this.condition?.stabilizeCriticalState();
                    this._refreshShipCapabilities();
                    return result;
                },
                setConditionForDebug: (targetId, value) => {
                    const result = this.condition?.setConditionForDebug(targetId, value);
                    this._refreshShipCapabilities();
                    return result;
                },
                setInventoryForDebug: (inventory) => {
                    const result = this.condition?.setInventoryForDebug(inventory);
                    this._refreshShipCapabilities();
                    return result;
                },
                openTerminal: () => this._openCargoTerminalPanel(),
                closeTerminal: () => this._closeCargoTerminalPanel()
            },
            crew: {
                getState: () => this.crew.getState(),
                getContext: () => this.crew.getState(),
                isPresent: () => this._syncCrewPresence(),
                open: () => this._openCrewPanel(),
                close: () => this._closeCrewPanel(),
                interrupt: () => {
                    const state = this.crew.interrupt();
                    this._updateCrewPanel();
                    return state;
                },
                beginListening: () => {
                    const state = this.crew.beginListening();
                    this._updateCrewPanel();
                    return state;
                },
                requestPresentation: () => this.crew.requestPresentation(),
                chooseRelationship: (choiceId) => {
                    const state = this.crew.chooseRelationship(choiceId);
                    this._updateCrewPanel();
                    return state;
                },
                syncPresence: () => this._syncCrewPresence()
            },
            // --- Phase 24 hybrid dialogue debug surface ---
            dialogue: {
                getState: (npcId) => (npcId && this.dialogue?.npcId !== npcId
                    ? this.dialogue?.openConversation(npcId)
                    : this.dialogue?.getState()) ?? { unavailable: this.dialogueError },
                open: (npcId) => this.dialogue?.openConversation(npcId) ?? { unavailable: this.dialogueError },
                close: () => this.dialogue?.closeConversation(),
                resolveTurn: (npcId, text) => {
                    if (npcId && this.dialogue?.npcId !== npcId) this.dialogue?.openConversation(npcId);
                    return this.dialogue?.resolveTurn(text);
                },
                say: (npcId, text) => {
                    if (npcId && this.dialogue?.npcId !== npcId) this.dialogue?.openConversation(npcId);
                    return this.dialogue?.say(text);
                },
                setServiceOnline: (online) => this._setDialogueServiceEnabled(online),
                getBudget: () => this.dialogue?.getBudget(),
                getRouting: (npcId) => this.dialogue?.getRouting(npcId),
                getMemory: (npcId) => this.dialogue?.getMemory(npcId),
                injectRawResponse: (npcId, raw) => this.dialogue?.injectRawResponse(npcId, raw),
                clearMemory: (npcId) => this.dialogue?.clearMemory(npcId)
            },
            surfaceOutpost: {
                getState: () => this.surfaceOutpost?.getState() ?? {
                    available: false,
                    error: this.surfaceOutpostError
                },
                getDefinition: () => this.surfaceOutpost?.getState().definition ?? null,
                scan: () => this.surfaceOutpost?.scan(SURFACE_OUTPOST_ID, {
                    systemId: 'index_hq',
                    planetId: 'index_hq_planet_1'
                }),
                sync: () => this._syncSurfaceOutpostProgress(),
                interact: () => {
                    const position = this.playerRig.object3D.getWorldPosition(new THREE.Vector3());
                    const interaction = this.environment?.getSurfaceInteraction?.(position);
                    return this.surfaceOutpost?.interact(SURFACE_OUTPOST_ID, {
                        playerState: this.playerController.getState(),
                        distanceMetres: interaction?.distance
                    });
                },
                recordBoarded: () => this.surfaceOutpost?.recordBoarded(SURFACE_OUTPOST_ID),
                report: () => this.surfaceOutpost?.report(SURFACE_OUTPOST_ID),
                getPlacement: () => this.environment?.getSurfaceOutpostPlacement?.() ?? null,
                openTerminal: () => this._openSurfaceOutpostPanel(),
                closeTerminal: () => this._closeSurfaceOutpostPanel()
            },
            surfaceCombat: {
                getState: () => this.surfaceCombat?.getState() ?? {
                    available: false,
                    error: this.surfaceCombatError
                },
                getPlacement: () => {
                    const placement = this.environment?.getSurfaceCombatPlacement?.() ?? null;
                    if (!placement) return null;
                    return {
                        id: placement.id,
                        objectivePosition: placement.objectivePosition,
                        landingPoint: placement.landingPoint,
                        structures: placement.structures,
                        spawnCandidates: placement.spawnCandidates,
                        patrolPoints: placement.patrolPoints
                    };
                },
                getPerformance: () => ({
                    runtime: this.surfaceCombat?.getPerformance() ?? null,
                    presentation: this.surfaceCombatPresentation?.getState() ?? null
                }),
                scan: () => this.surfaceCombat?.scan({
                    siteId: SURFACE_COMBAT_SITE_ID,
                    systemId: 'index_hq',
                    planetId: 'index_hq_planet_1'
                }),
                sync: () => this._syncSurfaceCombatProgress(),
                fire: () => this._fireSurfaceWeapon(),
                recoverObjective: () => this._recoverSurfaceCombatObjective(),
                recordBoarded: () => this.surfaceCombat?.recordBoarded(),
                recoverFromDefeat: () => this.surfaceCombat?.recoverFromDefeat(),
                queryEvents: (query) => this.surfaceCombat?.queryEvents(query),
                getPresentationState: () => this.surfaceCombatPresentation?.getState() ?? null
            },
            boarding: {
                getState: () => this.boarding?.getState() ?? {
                    available: false,
                    error: this.boardingError
                },
                getDefinition: () => this.boarding?.getState().definition ?? null,
                getPlacement: () => {
                    const placement = this.environment?.getBoardingPlacement?.();
                    return placement
                        ? {
                            definition: placement.definition,
                            position: placement.position.toArray()
                        }
                        : null;
                },
                discover: () => this.boarding?.discover(BOARDING_DERELICT_ID, {
                    systemId: BOARDING_SYSTEM_ID
                }),
                recover: (reason = 'runtime-recovery') => this._recoverBoarding(reason),
                setOxygen: (seconds) => this.boarding?.setOxygenForDebug(seconds),
                checkpoint: (reason = 'debug-boarding-checkpoint') => (
                    this.boarding?.checkpoint(this._captureBoardingPlayer(), reason)
                ),
                getPresentationState: () => this.boardingPresentation?.getState() ?? null
            },
            patrol: {
                getState: () => this.patrol?.getState() ?? { unavailable: this.patrolError },
                getInfluence: (systemId = 'entry_hub') => this.patrol?.getInfluence(systemId),
                syncSystem: (systemId) => {
                    const state = this.patrol?.syncSystem(systemId);
                    this._syncPatrolPresentation();
                    return state;
                },
                update: (gameTime = this.gameClock.getTime()) => {
                    const state = this.patrol?.update(gameTime);
                    this._syncPatrolPresentation();
                    return state;
                },
                acknowledge: () => this._handlePatrolAction('acknowledge'),
                submitScan: () => this._handlePatrolAction('scan'),
                ignore: () => this._handlePatrolAction('ignore'),
                abort: () => {
                    const state = this.patrol?.abort('debug-abort');
                    this._syncPatrolPresentation();
                    return state;
                },
                restartVisit: (systemId = 'entry_hub') => {
                    this.patrol?.syncSystem(null);
                    const state = this.patrol?.syncSystem(systemId);
                    this.patrolHailDismissedId = null;
                    this._syncPatrolPresentation();
                    return state;
                },
                openHail: () => this._openPatrolHailPanel(),
                closeHail: () => this._closePatrolHailPanel()
            },
            combat: {
                getState: () => this.combat?.getState() ?? { unavailable: this.combatError },
                toggleMode: () => this._toggleCombatMode(),
                setMode: (enabled) => this.combat?.setCombatMode(enabled),
                syncSystem: (systemId) => {
                    const state = this.combat?.syncSystem(systemId);
                    this.combatPresentation?.update(state);
                    return state;
                },
                update: (dt = 1 / 60, input = {}) => {
                    const state = this.combat?.update(dt, input);
                    this.combatPresentation?.update(state);
                    this._refreshShipCapabilities();
                    return state;
                },
                cycleTarget: () => this._cycleCombatTarget(),
                fire: () => this._fireCombatWeapon(),
                rescue: () => this._rescueCombatDefeat(),
                claimSalvage: () => this.combat?.claimWreckSalvage(),
                cleanup: (reason = 'debug') => {
                    const result = this.combat?.cleanup(reason);
                    this.combatPresentation?.cleanup();
                    return result;
                },
                addTarget: (target) => this.combat?.addTargetForDebug(target),
                applyHit: (hit) => this.combat?.applyHitForDebug(hit),
                queryEvents: (query) => this.combat?.queryCombatEvents(query),
                getPresentationState: () => this.combatPresentation?.getState(),
                runPerformanceScene: (seconds = 10) => {
                    const duration = Math.max(0, Math.min(120, Number(seconds) || 0));
                    const start = performance.now();
                    let steps = 0;
                    while (steps < duration * 60) {
                        this.combat?.update(1 / 60, {
                            playerPosition: this.ship.position.toArray(),
                            playerVelocity: this.ship.velocity.toArray(),
                            playerForward: new THREE.Vector3(0, 0, -1)
                                .applyQuaternion(this.ship.object3D.quaternion)
                                .toArray()
                        });
                        steps += 1;
                    }
                    const elapsedMs = performance.now() - start;
                    return {
                        seconds: duration,
                        steps,
                        totalMs: elapsedMs,
                        averageMsPerStep: steps ? elapsedMs / steps : 0,
                        projectileCount: this.combat?.getState().projectileCount ?? 0,
                        presentation: this.combatPresentation?.getState()
                    };
                }
            },
            saves: {
                getStatus: () => this.saveSlots.getStatus(),
                list: () => this.saveSlots.listSlots(),
                getActive: () => this.saveSlots.getActiveEnvelope(),
                create: (name) => {
                    const envelope = this.saveSlots.createSlot(name);
                    this._reloadActiveSlot();
                    return envelope;
                },
                load: (id) => {
                    const envelope = this.saveSlots.loadSlot(id);
                    this._reloadActiveSlot();
                    return envelope;
                },
                delete: (id) => {
                    const envelope = this.saveSlots.deleteSlot(id);
                    this._reloadActiveSlot();
                    return envelope;
                },
                export: (id) => this.saveSlots.exportSlot(id),
                previewImport: (text) => this.saveSlots.previewImport(text),
                importPreviewed: (text, token) => {
                    const envelope = this.saveSlots.importPreviewed(text, token);
                    this._reloadActiveSlot();
                    return envelope;
                },
                resetActive: () => {
                    const envelope = this.saveSlots.resetActiveSlot();
                    this._reloadActiveSlot();
                    return envelope;
                },
                getGameTime: () => this.gameClock.getTime(),
                checkpoint: (reason) => this._checkpointGameClock(reason)
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
                if (this._boardingSessionActive()) {
                    return this._recoverBoarding('runtime-recovery');
                }
                const result = this.playerController.boardShip?.() ?? false;
                this.playerController.updateCamera(this.camera);
                this._syncDebugDomState();
                return result ? this.playerController.getDebugState() : false;
            },
            teleportEvaToggle: () => {
                if (this._boardingSessionActive()) {
                    return {
                        action: 'boardingRecovery',
                        result: this._recoverBoarding('runtime-recovery'),
                        player: this.playerController.getDebugState()
                    };
                }
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
                this._onHyperdriveToggled();
                this._syncDebugDomState();
                return this.shipControls.hyperdriveEngaged;
            },
            toggleHyperdrive: () => {
                this.shipControls.handleToggleKey('Space');
                this._onHyperdriveToggled();
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
            // Re-seated: manual handback rule
            if (this.autopilot.isActive()) {
                this.autopilot.disengage();
                this.shipControls.autopilotActive = false;
            }
            // Remember the free-fly mode so we can restore it on disengage.
            this.debugCamera.freeMode = this.debugCamera.mode === 'interior' ? 'interior' : 'exterior';
            this.debugCamera.mode = 'pilot';
        } else {
            // Player left the controls: check for Unpiloted Engagement!
            if (
                this.shipControls.hyperdriveEngaged === true &&
                this.selectedNavigationTarget !== null &&
                isHyperdriveAutopilotTier(this.scaleStack.active.tier) &&
                !this.scaleStack.isTransitioning
            ) {
                const engaged = this.selectedNavigationTarget?.rpg?.combatTargetId
                    ? false
                    : this.autopilot.engage(this.ship, this.selectedNavigationTarget, this.scaleStack.active.tier, this.scaleStack.isTransitioning);
                if (engaged) {
                    this.shipControls.autopilotActive = true;
                }
            }
            this.debugCamera.mode = this.debugCamera.freeMode;
            if (this.patrolHailOpen) this._closePatrolHailPanel();
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
            surfaceOutpost: this.surfaceOutpost?.getState() ?? {
                available: false,
                error: this.surfaceOutpostError
            },
            surfaceCombat: this.surfaceCombat?.getState() ?? {
                available: false,
                error: this.surfaceCombatError
            },
            boarding: this.boarding?.getState() ?? {
                available: false,
                error: this.boardingError
            },
            boardingPresentation: this.boardingPresentation?.getState() ?? null,
            patrol: this.patrol?.getState() ?? {
                available: false,
                error: this.patrolError
            },
            economy: this.economy?.getState() ?? {
                available: false,
                error: this.economyError
            },
            combat: this.combat?.getState() ?? {
                available: false,
                error: this.combatError
            },
            saves: {
                ...this.saveSlots.getStatus(),
                slots: this.saveSlots.listSlots(),
                gameTime: this.gameClock.getTime()
            },
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
        const boardingActive = this._boardingSessionActive();
        const position = surfaceActive || boardingActive
            ? this.playerRig.object3D.getWorldPosition(new THREE.Vector3())
            : this.ship.position.clone();
        return {
            kind: surfaceActive || boardingActive ? 'player' : 'ship',
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

function patrolOutcomeText(outcomeId) {
    return {
        welcome: 'Transponder recognized. Welcome to Port Meridian. Maintain a safe approach.',
        inspection_clear: 'Manifest inspection clear. You may proceed.',
        warning_refusal: 'Passage refused under Commonwealth traffic policy. Turn away safely.',
        ignored_hail: 'No response received. Your transponder has been logged; the patrol is disengaging.',
        safe_hostility: 'Hostile transponder recognized. Passage refused. No engagement authorized; depart safely.',
        aborted: 'Patrol contact aborted as the ship left local territory.'
    }[outcomeId] ?? '';
}

function patrolPanelRenderKey(encounter, error) {
    return [
        encounter?.id,
        encounter?.phase,
        encounter?.outcomeId,
        encounter?.scanPending,
        encounter?.cargoScan?.status,
        encounter?.cargoScan?.contrabandValue,
        error?.context === 'patrol hail action' ? error.message : ''
    ].join('|');
}

function formatGameTime(seconds) {
    const whole = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const secs = whole % 60;
    return [hours, minutes, secs].map((value) => String(value).padStart(2, '0')).join(':');
}
