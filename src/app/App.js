import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { DEEP_SPACE_PRESET } from '../config/deepSpacePreset.js';
import { POST_FX_PRESETS } from '../config/postFxPresets.js';
import { DeepSpaceEnvironment } from '../space/DeepSpaceEnvironment.js';
import { GravityField } from '../space/GravityField.js';
import { Ship } from '../ship/Ship.js';
import { ShipControls } from '../ship/ShipControls.js';
import { PlayerRig } from '../player/PlayerRig.js';
import { RelativeLocomotion } from '../player/RelativeLocomotion.js';
import { PlayerController, PLAYER_STATE } from '../player/PlayerController.js';
import { GamepadInput } from '../input/GamepadInput.js';
import { SkyDeepSpace } from '../rendering/SkyDeepSpace.js';
import { PostProcessing } from '../rendering/PostProcessing.js';
import { PostProcessingPanel } from '../rendering/PostProcessingPanel.js';

export class App {
    constructor({ canvas }) {
        this.canvas = canvas;
        this.clock = new THREE.Clock();
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000005);
        this.scene.fog = new THREE.FogExp2(0x000005, DEEP_SPACE_PRESET.fogDensity);

        this.camera = new THREE.PerspectiveCamera(
            70,
            window.innerWidth / window.innerHeight,
            0.1,
            DEEP_SPACE_PRESET.cameraFar
        );
        this.camera.position.set(38, 16, 62);

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            preserveDrawingBuffer: true,
            powerPreference: 'high-performance'
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
        this.environment = new DeepSpaceEnvironment({
            preset: DEEP_SPACE_PRESET,
            seed: 'deep-space-vr-foundation'
        });
        this.scene.add(this.environment.group);

        // Gravity is decoupled from the meshes: the environment hands out
        // attractor positions + masses, the field turns them into acceleration.
        this.gravityField = new GravityField();
        this.gravityField.setAttractors(this.environment.getAttractors());

        // 'glb' swaps in the imported Star Citizen hull; 'procedural' keeps the
        // original blockout from ShipModel.js available for later reuse.
        this.ship = new Ship({ variant: 'glb' });
        this.ship.position.set(0, 0, 0);
        this.ship.setGravityField(this.gravityField);
        this.shipControls = new ShipControls();
        this.scene.add(this.ship.object3D);
        this.ship.ready
            .then((info) => {
                if (info) console.info('Ship hull ready', info.size, 'scale', info.appliedScale);
                // Re-apply once the async hull exists so the F2 slider values stick.
                this.ship.setEnvMapIntensity(this.postFxConfig.ship?.envMapIntensity ?? 0.85);
                this.ship.setGlassOpacity(this.postFxConfig.ship?.glassOpacity ?? 0.15);
                this.ship.setBrightness(this.postFxConfig.ship?.brightness ?? 1);
                this.ship.setBloom(this.postFxConfig.ship?.bloom ?? 1);
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

        // Phase 2 debug helpers (anchor spheres + player scale capsule) are now
        // hidden by default: with bloom they looked like stray bits stuck on the
        // hull. Toggle back on with F3 / the debug hook when aligning anchors.
        this.debugMarkersVisible = false;
        this._applyDebugMarkers();

        this.input = this._createInputState();
        this.paused = false;
        this.postFxConfig = structuredClone(POST_FX_PRESETS.desktopDefault);
        this.postProcessing = new PostProcessing({
            renderer: this.renderer,
            scene: this.scene,
            camera: this.camera,
            config: this.postFxConfig
        });
        this.postPanel = new PostProcessingPanel({
            config: this.postFxConfig,
            onChange: () => this._applyRuntimeConfig()
        });

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

        this._handleGamepadButtons(gamepad);
        this._applyGamepadLook(gamepad, dt);

        // Ship is simulated every frame whether or not anyone is piloting: when
        // pilot mode is off the command is inactive and it coasts on inertia +
        // gravity. So it keeps moving and keeps being bent by attractors.
        // `paused` freezes only the live simulation so manual/automated stepping
        // through the debug hooks is deterministic; rendering keeps running.
        if (!this.paused) {
            const command = this.shipControls.getCommand(this.input.keys, gamepad);
            this.ship.update(dt, command, this.gravityField);
        }

        // Camera: in player mode the rig (ship-local) drives it after the ship
        // transform was integrated this frame, so walking while the ship moves
        // reads correctly through the windows. In debug mode the Phase 2/3 free
        // cameras drive it instead.
        if (this.cameraMode === 'player') {
            if (!this.paused) this.playerController.update(dt, this.input.keys, gamepad);
            this.playerController.updateCamera(this.camera);
        } else {
            this._updateDebugCamera(dt);
        }

        this.playerRig.update(dt);
        this.environment.update(this.ship.position, dt);
        this.sky.update(dt, this.camera.position);

        // Warp + speed lines react to actual ship speed. The speed-driven warp
        // factor is then capped by the VR Comfort `warpMax` knob, so dragging
        // that (or any Warp slider) in F2 always pulls the effect intensity down.
        const speedFactor = THREE.MathUtils.clamp(this.ship.speed / 600, 0, 1);
        const warpCeiling = this.postFxConfig.vrComfort?.warpMax ?? 1;
        this.postProcessing.setWarpSpeedFactor(Math.min(speedFactor, warpCeiling));

        this._updateTelemetry();
        this.postProcessing.render(dt);
    }

    _handleGamepadButtons(gamepad) {
        if (!gamepad.connected) return;
        const buttons = gamepad.buttons;

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
        const padId = gamepad.id && gamepad.id.length > 34 ? `${gamepad.id.slice(0, 31)}...` : gamepad.id;

        const lines = [
            `<b>VIEW</b> ${mode}    <b>PILOT</b> ${flag(controls.pilotActive)} ${brake}`,
            `<b>DAMPENERS</b> ${dampLabel}`,
            `<b>PAD</b> ${gamepad.connected ? `<span class="on">${padId || 'CONNECTED'}</span>` : '<span class="off">OFF</span>'}`,
            `<b>SPEED</b> ${speed.toFixed(1)} m/s   <b>ANG</b> ${angSpeed.toFixed(1)} deg/s`
        ];

        if (nearest) {
            lines.push(
                `<b>${nearest.name}</b> ${nearest.distance.toFixed(0)} m  pull ${nearest.acceleration.toFixed(2)} m/s2`
            );
        }

        this.telemetryNode.innerHTML = lines.join('\n');

        // Contextual interaction prompt (player mode only).
        const promptText = this.cameraMode === 'player' ? this.playerController.getPrompt() : null;
        if (this.promptNode) {
            this.promptNode.textContent = promptText ?? '';
            this.promptContainer.style.display = promptText ? 'block' : 'none';
        }
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
            if (event.code === 'F2') {
                event.preventDefault();
                this.postPanel.toggle();
                // The panel needs the mouse, so drop pointer lock when it opens.
                if (this.postPanel.visible) this._exitPointerLock();
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

            // Stop arrow keys from scrolling the page while flying/free-looking.
            if (event.code.startsWith('Arrow') || event.code === 'Space') {
                event.preventDefault();
            }

            this.input.keys.add(event.code);
        });
        window.addEventListener('keyup', (event) => {
            this.input.keys.delete(event.code);
        });

        // Pointer lock for first-person mouse look (player mode only). Clicking
        // the canvas grabs the mouse; Esc (browser default) or opening F2 frees it.
        this.canvas.addEventListener('click', () => {
            if (this.cameraMode === 'player' && !this.postPanel.visible) {
                this.canvas.requestPointerLock?.();
            }
        });
        window.addEventListener('mousemove', (event) => {
            if (this.cameraMode !== 'player') return;
            if (document.pointerLockElement !== this.canvas) return;
            this.playerController.applyMouseLook(event.movementX, event.movementY);
        });
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
        this.postProcessing.resize(width, height);
    }

    _applyRuntimeConfig() {
        this.renderer.toneMappingExposure = this.postFxConfig.retro.exposure;
        this.ship.setEnvMapIntensity(this.postFxConfig.ship?.envMapIntensity ?? 0.85);
        this.ship.setGlassOpacity(this.postFxConfig.ship?.glassOpacity ?? 0.15);
        this.ship.setBrightness(this.postFxConfig.ship?.brightness ?? 1);
        this.ship.setBloom(this.postFxConfig.ship?.bloom ?? 1);

        // Physics knobs surfaced through F2: gravity master gain (Deep Space) and
        // the linear acceleration cap (VR Comfort).
        this.gravityField.setGravityScale(this.postFxConfig.deepSpace?.gravityScale ?? 1);
        this.ship.physics.setAccelerationCap(this.postFxConfig.vrComfort?.accelerationCap ?? 45);

        this.postProcessing.applyConfig(this.postFxConfig);
        this.environment.setRuntimeConfig({
            starOpacity: this.postFxConfig.deepSpace.starOpacity,
            starBrightness: this.postFxConfig.deepSpace.starBrightness,
            starSize: this.postFxConfig.deepSpace.starSize,
            nebulaOpacity: this.postFxConfig.deepSpace.nebulaOpacity,
            nebulaBrightness: this.postFxConfig.deepSpace.nebulaBrightness,
            nebulaScale: this.postFxConfig.deepSpace.nebulaScale
        });
    }

    async _loadInitialJsonPreset() {
        try {
            const response = await fetch('./assets/config/post_processing.json');
            if (!response.ok) return;

            const json = await response.json();
            mergeConfig(this.postFxConfig, json);
            this.postPanel._render();
            this._applyRuntimeConfig();
        } catch (error) {
            console.warn('Could not load post_processing.json', error);
        }
    }

    _installDebugHooks() {
        // Expose the live app so F2-equivalent tweaks can be poked from the
        // console during manual/automated validation (e.g. lower warpMax or
        // gravityScale, then re-apply).
        window.__deepSpaceApp = this;
        window.__deepSpaceDebug = {
            getPostFxState: () => ({
                bloom: this.postFxConfig.bloom.enabled,
                warp: this.postFxConfig.warp.enabled,
                retro: this.postFxConfig.retro.enabled,
                ascii: this.postFxConfig.ascii.enabled,
                halftone: this.postFxConfig.halftone.enabled,
                warpResolution: this.postProcessing.warpPass.uniforms.resolution.value.toArray(),
                retroResolution: this.postProcessing.retroPass.uniforms.resolution.value.toArray(),
                asciiResolution: this.postProcessing.asciiPass.uniforms.resolution.value.toArray(),
                halftoneResolution: this.postProcessing.halftonePass.uniforms.resolution.value.toArray()
            }),
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
            getWarpSpeedFactor: () => this.postProcessing.warpPass.uniforms.speedFactor.value,
            getSpeedLinesOpacity: () => this.ship.speedLines.object3D.material.opacity,

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
            cameraMode: this.debugCamera.mode,
            pilotActive: this.shipControls.pilotActive,
            dampeners: this.shipControls.dampeners,
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
