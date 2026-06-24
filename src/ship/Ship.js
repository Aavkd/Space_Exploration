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

        this.speedLines = new SpeedLines();
        this.exteriorRoot.add(this.speedLines.object3D);

        this.mixer = null;
        this.animations = [];
        this.glassMaterials = [];
        this.fxSprites = [];
        this.startAction = null;
        this.animationLoop = false;
        this.engineFxVisible = false;

        // Once the async GLB resolves, grab its animation mixer + glass materials
        // and kick off the built-in startup sequence (landing gear, thrusters...).
        this.ready
            .then((info) => {
                if (!info) return;
                this.glassMaterials = info.glassMaterials ?? [];
                this.fxSprites = info.fxSprites ?? [];
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

    setGravityField(gravityField) {
        this.gravityField = gravityField;
    }

    update(dt, commandState = {}, gravityField = this.gravityField) {
        this.commandState = commandState;

        const gravityAccel = gravityField
            ? gravityField.getAcceleration(this.object3D.position, this._gravityAccel)
            : null;

        this.physics.integrate(this.object3D, dt, commandState, gravityAccel);

        this.speedLines.update(dt, this.physics.speed);

        if (this.mixer) this.mixer.update(dt);
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
}
