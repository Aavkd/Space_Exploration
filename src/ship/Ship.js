import * as THREE from 'three';
import { SpeedLines } from '../rendering/SpeedLines.js';
import { ShipPhysics } from './ShipPhysics.js';
import { createShipModel } from './ShipModel.js';
import { createGlbShipModel } from './ShipModelGLB.js';
import { validateShipAnchors } from './ShipInterior.js';

// 'glb'        -> Star Citizen hull imported from ship.glb (active default).
// 'procedural' -> original blockout from ShipModel.js, kept for later reuse.
export const SHIP_VARIANTS = Object.freeze(['glb', 'procedural']);

export class Ship {
    constructor({ variant = 'glb', physics = {} } = {}) {
        this.object3D = new THREE.Group();
        this.object3D.name = 'ShipRoot';

        // 6-DOF rigid-body motion lives in ShipPhysics; the ship just owns the
        // transform and forwards a command + external gravity each frame.
        this.physics = new ShipPhysics(physics);
        this.physics.velocity.set(0, 0, -18); // gentle initial drift along -Z
        this.commandState = {};
        this.gravityField = null;
        this._gravityAccel = new THREE.Vector3();
        this.variant = SHIP_VARIANTS.includes(variant) ? variant : 'glb';

        this.model = this.variant === 'procedural'
            ? createShipModel()
            : createGlbShipModel();
        this.ready = this.model.ready ?? Promise.resolve();
        this.exteriorRoot = this.model.exteriorRoot;
        this.interiorRoot = this.model.interiorRoot;
        this.anchorRoot = this.model.anchorRoot;
        this.anchors = this.model.anchors;
        this.dimensions = this.model.dimensions;
        this.zones = this.model.zones;
        this.parts = this.model.parts;

        const anchorValidation = validateShipAnchors(this.anchors);
        if (!anchorValidation.ok) {
            console.warn('Ship anchors missing:', anchorValidation.missing);
        }

        this.object3D.userData = {
            shipDimensions: this.dimensions,
            shipZones: this.zones,
            shipParts: this.parts,
            shipAnchors: this.getAnchorNames()
        };

        this.object3D.add(this.model.root);
        this._createCrewPlaceholder();

        this.speedLines = new SpeedLines();
        this.exteriorRoot.add(this.speedLines.object3D);

        this.mixer = null;
        this.animations = [];
        this.glassMaterials = [];
        this.fxSprites = [];
        this.hyperdriveSprites = [];
        this.startAction = null;
        this.animationLoop = false;
        this.engineFxVisible = false;

        // Phase 08: eased hyperdrive spool level [0,1]. ShipControls owns the
        // latched intent; Ship eases this toward it each frame, then injects it
        // into the physics command and drives the FX with it.
        this.hyperdriveLevel = 0;
        this.engageTime = 0.9; // spool-up time constant (s)
        this.disengageTime = 0.5; // spool-down time constant (s)
        this._hyperFxVisible = false;
        this.capabilityEffects = {
            engineThrust: 1,
            hyperdriveAuthority: 1
        };

        // Once the async GLB resolves, grab its animation mixer + glass materials
        // and kick off the built-in startup sequence (landing gear, thrusters...).
        this.ready
            .then((info) => {
                if (!info) return;
                this.glassMaterials = info.glassMaterials ?? [];
                this.fxSprites = info.fxSprites ?? [];
                this.hyperdriveSprites = info.hyperdriveSprites ?? [];
                this.animations = info.animations ?? [];
                this.mixer = info.mixer ?? null;
                if (this.mixer && this.animations.length) {
                    this.playStartSequence({ loop: this.animationLoop });
                }
            })
            .catch(() => {});
    }

    get position() {
        return this.object3D.position;
    }

    // Velocity / angularVelocity are owned by ShipPhysics; expose the same
    // vector instances so existing callers (warp speed factor, HUD) keep working.
    get velocity() {
        return this.physics.velocity;
    }

    get angularVelocity() {
        return this.physics.angularVelocity;
    }

    get speed() {
        return this.physics.speed;
    }

    getLandingClearance() {
        return this.dimensions?.landingClearance ?? 2.8;
    }

    setGravityField(gravityField) {
        this.gravityField = gravityField;
    }

    update(dt, commandState = {}, gravityField = this.gravityField, externalAcceleration = null) {
        const engineThrust = THREE.MathUtils.clamp(this.capabilityEffects.engineThrust ?? 1, 0.4, 1);
        const affectedCommand = {
            ...commandState,
            thrust: (commandState.thrust ?? 0) * engineThrust,
            strafe: (commandState.strafe ?? 0) * engineThrust,
            lift: (commandState.lift ?? 0) * engineThrust
        };
        this.commandState = affectedCommand;

        // Ease the hyperdrive spool toward the latched intent. This tracks the
        // gear itself, NOT whether someone is at the controls: leaving the seat
        // mid-jump keeps the regime (clamp lifted, speed held) until hyperdrive is
        // explicitly disengaged. Thrust still only applies while piloting.
        const engaged = Boolean(affectedCommand.hyperdrive);
        const target = engaged
            ? THREE.MathUtils.clamp(this.capabilityEffects.hyperdriveAuthority ?? 1, 0.5, 1)
            : 0;
        const tau = target > this.hyperdriveLevel ? this.engageTime : this.disengageTime;
        const k = tau > 1e-4 ? 1 - Math.exp(-dt / tau) : 1;
        this.hyperdriveLevel += (target - this.hyperdriveLevel) * k;
        if (this.hyperdriveLevel < 1e-4) this.hyperdriveLevel = 0;

        // smoothstep gives a nicer ease than the raw exponential for forces/FX.
        const easedLevel = THREE.MathUtils.smoothstep(this.hyperdriveLevel, 0, 1);
        const command = { ...affectedCommand, hyperdrive: easedLevel };

        const gravityAccel = gravityField
            ? gravityField.getAcceleration(this.object3D.position, this._gravityAccel)
            : null;

        this.physics.integrate(this.object3D, dt, command, gravityAccel, externalAcceleration);

        this._updateHyperdriveFx(easedLevel);
        this.speedLines.setMultiplier(this.physics.getEffectiveThrustMultiplier());
        this.speedLines.update(dt, this.physics.speed);

        if (this.mixer) this.mixer.update(dt);
    }

    getHyperdriveLevel() {
        return this.hyperdriveLevel;
    }

    setHyperdriveSpool(engageTime, disengageTime) {
        if (Number.isFinite(engageTime)) this.engageTime = Math.max(0.01, engageTime);
        if (Number.isFinite(disengageTime)) this.disengageTime = Math.max(0.01, disengageTime);
    }

    setCapabilityEffects({ engineThrust, hyperdriveAuthority } = {}) {
        if (Number.isFinite(engineThrust)) {
            this.capabilityEffects.engineThrust = THREE.MathUtils.clamp(engineThrust, 0.4, 1);
        }
        if (Number.isFinite(hyperdriveAuthority)) {
            this.capabilityEffects.hyperdriveAuthority = THREE.MathUtils.clamp(hyperdriveAuthority, 0.5, 1);
        }
        return { ...this.capabilityEffects };
    }

    // Drive the dedicated `hyperdrive_fx` sprite cards by the eased spool level:
    // they appear past a small threshold and brighten/opacify with the level.
    _updateHyperdriveFx(level) {
        const visible = level > 0.05;
        if (visible !== this._hyperFxVisible) {
            this._hyperFxVisible = visible;
            for (const mesh of this.hyperdriveSprites) mesh.visible = visible;
        }
        if (!visible) return;

        for (const mesh of this.hyperdriveSprites) {
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const material of materials) {
                if (!material) continue;
                material.transparent = true;
                material.opacity = level;
                if (material.emissive) {
                    if (material.userData.__baseEmissiveIntensity === undefined) {
                        material.userData.__baseEmissiveIntensity = material.emissiveIntensity ?? 1;
                    }
                    material.emissiveIntensity = material.userData.__baseEmissiveIntensity * (0.5 + level * 1.5);
                }
            }
        }
    }

    getMotionState() {
        return {
            speed: this.physics.speed,
            velocity: this.physics.velocity.toArray(),
            angularVelocity: this.physics.angularVelocity.toArray(),
            position: this.object3D.position.toArray(),
            command: this.commandState
        };
    }

    playStartSequence({ loop = false } = {}) {
        if (!this.mixer || !this.animations.length) return null;

        const clip = this.animations.find((c) => /start|sequence/i.test(c.name)) ?? this.animations[0];
        this.mixer.stopAllAction();

        const action = this.mixer.clipAction(clip);
        action.reset();
        action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        action.clampWhenFinished = !loop;
        action.play();

        this.startAction = action;
        this.animationLoop = loop;
        return action;
    }

    replayStartSequence() {
        return this.playStartSequence({ loop: this.animationLoop });
    }

    toggleAnimationLoop() {
        this.playStartSequence({ loop: !this.animationLoop });
        return this.animationLoop;
    }

    setGlassOpacity(opacity) {
        for (const material of this.glassMaterials) {
            material.transparent = true;
            material.opacity = opacity;
            material.needsUpdate = true;
        }
    }

    setEngineFxVisible(visible) {
        this.engineFxVisible = visible;
        for (const mesh of this.fxSprites) {
            mesh.visible = visible;
        }
        return this.engineFxVisible;
    }

    toggleEngineFx() {
        return this.setEngineFxVisible(!this.engineFxVisible);
    }

    // Iterate the hull's materials, skipping the canopy glass (it has its own
    // tuned reflection and its own opacity control; the hull intensity sliders
    // must not touch it, or the studio IBL reflects back as a bright rectangle).
    _forEachHullMaterial(callback) {
        this.exteriorRoot.traverse((node) => {
            if (!node.isMesh) return;
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            for (const material of materials) {
                if (!material || this.glassMaterials.includes(material)) continue;
                callback(material);
            }
        });
    }

    // Non-destructive hull albedo brightness: caches each material's authored
    // color on first use, then scales from that base so repeated slider moves
    // never compound. Lets the hull read less intense than the scene.
    setBrightness(brightness) {
        this._forEachHullMaterial((material) => {
            if (!material.color) return;
            if (!material.userData.__baseColor) material.userData.__baseColor = material.color.clone();
            material.color.copy(material.userData.__baseColor).multiplyScalar(brightness);
            material.needsUpdate = true;
        });
    }

    // Dedicated ship glow / bloom: scales the hull's authored emissive
    // (cockpit displays, panel lights, engines) so its contribution to the
    // shared bloom pass can be dialed independently of the global Bloom group.
    setBloom(amount) {
        this._forEachHullMaterial((material) => {
            if (!material.emissive) return;
            if (material.userData.__baseEmissiveIntensity === undefined) {
                material.userData.__baseEmissiveIntensity = material.emissiveIntensity ?? 1;
            }
            material.emissiveIntensity = material.userData.__baseEmissiveIntensity * amount;
            material.needsUpdate = true;
        });
    }

    // Toggles the Phase 2 anchor debug spheres (cockpit/airlock/spawn markers).
    // Off by default now: with bloom they read as stray dots stuck on the hull.
    setAnchorMarkersVisible(visible) {
        this.anchorRoot.traverse((node) => {
            if (node.isMesh && /Marker$/.test(node.name || '')) node.visible = visible;
        });
    }

    setEnvMapIntensity(intensity) {
        this._forEachHullMaterial((material) => {
            if ('envMapIntensity' in material) {
                material.envMapIntensity = intensity;
                material.needsUpdate = true;
            }
        });
    }

    localToWorld(localPosition) {
        return this.object3D.localToWorld(localPosition.clone());
    }

    worldToLocal(worldPosition) {
        return this.object3D.worldToLocal(worldPosition.clone());
    }

    getAnchor(name) {
        return this.anchors[name] ?? null;
    }

    getAnchorNames() {
        return Object.keys(this.anchors);
    }

    getAnchorWorldPosition(name, target = new THREE.Vector3()) {
        const anchor = this.getAnchor(name);
        if (!anchor) return null;

        anchor.updateWorldMatrix(true, false);
        return anchor.getWorldPosition(target);
    }

    getAnchorLocalPosition(name, target = new THREE.Vector3()) {
        const worldPosition = this.getAnchorWorldPosition(name, target);
        if (!worldPosition) return null;

        return this.object3D.worldToLocal(worldPosition.clone());
    }

    getAnchorSummary() {
        return Object.fromEntries(
            this.getAnchorNames().map((name) => {
                const anchor = this.getAnchor(name);
                return [
                    name,
                    {
                        localPosition: anchor.position.toArray(),
                        role: anchor.userData.anchorRole,
                        zone: anchor.userData.zone,
                        interactionRadius: anchor.userData.interactionRadius
                    }
                ];
            })
        );
    }

    validateAnchors() {
        return validateShipAnchors(this.anchors);
    }

    setCrewAvatarVisible(visible) {
        if (this.crewPlaceholder) this.crewPlaceholder.visible = Boolean(visible);
        return this.isCrewAvatarVisible();
    }

    isCrewAvatarVisible() {
        return Boolean(this.crewPlaceholder?.visible);
    }

    _createCrewPlaceholder() {
        const anchor = this.getAnchor('crewMessAnchor');
        if (!anchor) return;
        const avatar = new THREE.Group();
        avatar.name = 'CrewPlaceholderLyra';
        avatar.userData = {
            npcId: 'crew_quartermaster_lyra',
            placeholder: true,
            animation: 'static-idle'
        };
        const suit = new THREE.MeshStandardMaterial({
            color: 0x315269,
            emissive: 0x07131a,
            roughness: 0.75
        });
        const visor = new THREE.MeshStandardMaterial({
            color: 0x8ed7db,
            emissive: 0x173d44,
            emissiveIntensity: 0.8,
            roughness: 0.25
        });
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.82, 5, 10), suit);
        body.position.y = 0.77;
        body.name = 'PlaceholderBody';
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 8), visor);
        head.position.y = 1.48;
        head.name = 'PlaceholderHead';
        avatar.add(body, head);
        anchor.add(avatar);
        this.crewPlaceholder = avatar;
    }
}
