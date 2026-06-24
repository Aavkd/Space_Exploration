import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { WebXRInput } from '../input/WebXRInput.js';

export class XRExperience {
    constructor({
        renderer,
        scene,
        camera,
        playerRig,
        onSessionStart,
        onSessionEnd,
        onSelect
    } = {}) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.playerRig = playerRig;
        this.onSessionStart = onSessionStart;
        this.onSessionEnd = onSessionEnd;
        this.onSelect = onSelect;
        this.displayMode = 'desktop';
        this.framebufferScaleFactor = 1;
        this.framebufferScalePending = false;
        this.input = new WebXRInput();
        this.xrScaleRoot = new THREE.Group();
        this.xrScaleRoot.name = 'XRScaledPlayerRoot';
        this.playerRig.object3D.add(this.xrScaleRoot);

        this.renderer.xr.enabled = true;
        this.renderer.xr.setReferenceSpaceType('local-floor');

        this.button = VRButton.createButton(this.renderer);
        this.button.id = 'vr-entry-button';
        document.body.appendChild(this.button);

        this.controllers = [];
        this.grips = [];
        this.controllerRays = [];
        this.gripMarkers = [];
        this._createControllers();
        this._createComfortVignette();

        this.renderer.xr.addEventListener('sessionstart', () => this._handleSessionStart());
        this.renderer.xr.addEventListener('sessionend', () => this._handleSessionEnd());
    }

    get isPresenting() {
        return Boolean(this.renderer.xr.isPresenting);
    }

    update(dt, comfort = {}) {
        this._updateComfortVignette(comfort);
        return this.input.update(dt, comfort);
    }

    pulse(options) {
        return this.input.pulse(options);
    }

    getDebugState() {
        return {
            displayMode: this.displayMode,
            presenting: this.isPresenting,
            referenceSpaceType: 'local-floor',
            userScale: this.xrScaleRoot.scale.x,
            framebufferScaleFactor: this.framebufferScaleFactor,
            framebufferScalePending: this.framebufferScalePending,
            controllerSpheresVisible: this.gripMarkers.every((marker) => marker.visible),
            controllerRaysVisible: this.controllerRays.every((ray) => ray.visible),
            input: this.input.getDebugState()
        };
    }

    setUserScale(scale) {
        const safeScale = Number.isFinite(scale) ? THREE.MathUtils.clamp(scale, 0.25, 1.5) : 1;
        this.xrScaleRoot.scale.setScalar(safeScale);
        return safeScale;
    }

    setFramebufferScaleFactor(scale) {
        const safeScale = Number.isFinite(scale) ? THREE.MathUtils.clamp(scale, 0.35, 1.25) : 1;
        this.framebufferScaleFactor = safeScale;

        if (this.isPresenting) {
            this.framebufferScalePending = true;
            return false;
        }

        this.renderer.xr.setFramebufferScaleFactor(safeScale);
        this.framebufferScalePending = false;
        return true;
    }

    setControllerSpheresVisible(visible) {
        const next = Boolean(visible);
        for (const marker of this.gripMarkers) marker.visible = next;
        for (const ray of this.controllerRays) ray.visible = next;
        return next;
    }

    _handleSessionStart() {
        this.displayMode = 'vr';
        this.xrScaleRoot.add(this.camera);
        this.camera.position.set(0, 0, 0);
        this.camera.rotation.set(0, 0, 0);
        this.camera.scale.set(1, 1, 1);
        this.camera.updateMatrixWorld(true);
        this.vignette.visible = false;
        this.onSessionStart?.();
    }

    _handleSessionEnd() {
        this.displayMode = 'desktop';
        this.scene.attach(this.camera);
        this.vignette.visible = false;
        this.onSessionEnd?.();
    }

    _createControllers() {
        for (let i = 0; i < 2; i++) {
            const controller = this.renderer.xr.getController(i);
            controller.name = `XRController${i}`;
            controller.visible = false;
            const ray = this._createControllerRay();
            controller.add(ray);
            this.controllerRays.push(ray);
            controller.addEventListener('connected', () => {
                controller.visible = true;
            });
            controller.addEventListener('disconnected', () => {
                controller.visible = false;
            });
            controller.addEventListener('selectstart', () => {
                this.onSelect?.();
            });

            const grip = this.renderer.xr.getControllerGrip(i);
            grip.name = `XRControllerGrip${i}`;
            grip.visible = false;
            const marker = this._createGripMarker();
            grip.add(marker);
            this.gripMarkers.push(marker);
            grip.addEventListener('connected', () => {
                grip.visible = true;
            });
            grip.addEventListener('disconnected', () => {
                grip.visible = false;
            });

            this.xrScaleRoot.add(controller, grip);
            this.controllers.push(controller);
            this.grips.push(grip);
            this.input.registerController(i, controller, grip);
        }
    }

    _createControllerRay() {
        const geometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, -2.2)
        ]);
        const material = new THREE.LineBasicMaterial({
            color: 0x8fe8ff,
            transparent: true,
            opacity: 0.72,
            blending: THREE.AdditiveBlending
        });
        const line = new THREE.Line(geometry, material);
        line.name = 'XRControllerRay';
        return line;
    }

    _createGripMarker() {
        return new THREE.Mesh(
            new THREE.IcosahedronGeometry(0.055, 1),
            new THREE.MeshBasicMaterial({
                color: 0x9bdcff,
                transparent: true,
                opacity: 0.82
            })
        );
    }

    _createComfortVignette() {
        const material = new THREE.ShaderMaterial({
            transparent: true,
            depthTest: false,
            depthWrite: false,
            uniforms: {
                strength: { value: 0.18 }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec2 vUv;
                uniform float strength;
                void main() {
                    vec2 centered = vUv - 0.5;
                    centered.x *= 1.42;
                    float edge = smoothstep(0.22, 0.58, length(centered));
                    gl_FragColor = vec4(0.0, 0.0, 0.0, edge * strength);
                }
            `
        });

        this.vignette = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.95), material);
        this.vignette.name = 'XRComfortVignette';
        this.vignette.position.set(0, 0, -1.1);
        this.vignette.renderOrder = 10000;
        this.vignette.visible = false;
        this.camera.add(this.vignette);
    }

    _updateComfortVignette(comfort) {
        const enabled = Boolean(comfort.comfortVignetteEnabled);
        this.vignette.visible = this.isPresenting && enabled;
        this.vignette.material.uniforms.strength.value = comfort.comfortVignetteStrength ?? 0.18;
    }
}
