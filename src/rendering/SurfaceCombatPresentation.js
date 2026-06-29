import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    SURFACE_COMBAT_ENEMY_ID,
    SURFACE_COMBAT_LIMITS
} from '../rpg/surfaceCombat.js';

export const SURFACE_WEAPON_MODEL_URL = './assets/desert_eagle_gun.glb';
export const SURFACE_WEAPON_MODEL_STATS = Object.freeze({
    bytes: 16440396,
    triangles: 459696,
    vertices: 243025
});

export class SurfaceCombatPresentation {
    constructor({ scene, loader = new GLTFLoader() } = {}) {
        if (!scene) throw new Error('SurfaceCombatPresentation requires a scene.');
        this.scene = scene;
        this.loader = loader;
        this.root = new THREE.Group();
        this.root.name = 'SurfaceCombatPresentation';
        this.scene.add(this.root);
        this.enemy = createEnemy();
        this.root.add(this.enemy);
        this.weapon = new THREE.Group();
        this.weapon.name = 'SurfacePulseCarbine';
        this.muzzle = new THREE.Object3D();
        this.muzzle.name = 'SurfacePulseCarbineMuzzle';
        this.muzzle.position.set(0, 0, 0.3);
        this.weapon.add(this.muzzle);
        this.fallback = createFallbackWeapon();
        this.weapon.add(this.fallback);
        this.weapon.visible = false;
        this.scene.add(this.weapon);
        this.shotLines = new THREE.Group();
        this.shotLines.name = 'SurfaceCombatShotEffects';
        this.root.add(this.shotLines);
        this.modelState = 'loading';
        this.modelError = null;
        this.loadedModel = null;
        this.lastShotIds = '';
        this._weaponForward = new THREE.Vector3();
        this._weaponUp = new THREE.Vector3();
        this._weaponRight = new THREE.Vector3();
        this._weaponAimTarget = new THREE.Vector3(0, 0, -8);
        this._weaponBasis = new THREE.Matrix4();
        this._loadPromise = this._loadModel();
    }

    async _loadModel() {
        try {
            const gltf = await this.loader.loadAsync(SURFACE_WEAPON_MODEL_URL);
            const model = gltf.scene;
            model.name = 'DesertEaglePulseCarbineModel';
            model.traverse((object) => {
                if (!object.isMesh) return;
                object.castShadow = false;
                object.receiveShadow = false;
                object.frustumCulled = true;
            });
            normalizeModel(model);
            const normalizedBounds = new THREE.Box3().setFromObject(model);
            const barrel = model.getObjectByName('Gun__Metal_Body_Bullet_Hole_0');
            const barrelBounds = barrel
                ? new THREE.Box3().setFromObject(barrel)
                : normalizedBounds;
            const barrelCenter = barrelBounds.getCenter(new THREE.Vector3());
            this.weapon.add(model);
            this.muzzle.position.set(
                barrelCenter.x,
                barrelCenter.y,
                barrelBounds.max.z
            );
            this.loadedModel = model;
            this.fallback.visible = false;
            this.modelState = 'ready';
            return model;
        } catch (error) {
            this.modelState = 'fallback';
            this.modelError = error instanceof Error ? error.message : String(error);
            this.fallback.visible = true;
            return null;
        }
    }

    update(state, { weaponParent = null, xr = false, equipped = false } = {}) {
        const active = Boolean(state?.active);
        this.root.visible = active || equipped;
        this.weapon.visible = Boolean(equipped);
        if (equipped && weaponParent && this.weapon.parent !== weaponParent) {
            this.weapon.removeFromParent();
            weaponParent.add(this.weapon);
        }
        if (xr) {
            this.weapon.position.set(0.035, -0.045, -0.12);
            this.weapon.rotation.set(0, Math.PI, 0);
        } else {
            this.weapon.position.set(0.25, -0.22, -0.48);
            this._orientDesktopWeaponTowardAim();
        }
        if (state?.enemy?.position) {
            this.enemy.visible = state.enemy.integrity > 0;
            this.enemy.position.fromArray(state.enemy.position);
            const integrity = THREE.MathUtils.clamp(state.enemy.integrity / 100, 0, 1);
            this.enemy.material.emissiveIntensity = 0.35 + (1 - integrity) * 1.2;
        } else {
            this.enemy.visible = false;
        }
        this._syncShots(state?.shotEffects ?? []);
        return this.getState();
    }

    getState() {
        return {
            modelUrl: SURFACE_WEAPON_MODEL_URL,
            modelState: this.modelState,
            modelError: this.modelError,
            modelStats: { ...SURFACE_WEAPON_MODEL_STATS },
            weaponVisible: this.weapon.visible,
            enemyVisible: this.enemy.visible,
            shotEffects: this.shotLines.children.length
        };
    }

    getMuzzleWorldPosition(target = new THREE.Vector3()) {
        this.weapon.updateWorldMatrix(true, false);
        return this.muzzle.getWorldPosition(target);
    }

    _orientDesktopWeaponTowardAim() {
        // The GLB hierarchy resolves its barrel to local +Z and its grip to
        // local -Y. Aim +Z from the lower-right viewmodel position toward the
        // camera centre while keeping local +Y aligned with screen-up.
        this._weaponForward
            .subVectors(this._weaponAimTarget, this.weapon.position)
            .normalize();
        this._weaponUp
            .set(0, 1, 0)
            .addScaledVector(
                this._weaponForward,
                -this._weaponForward.dot(this._weaponUp)
            )
            .normalize();
        this._weaponRight
            .crossVectors(this._weaponUp, this._weaponForward)
            .normalize();
        this._weaponBasis.makeBasis(
            this._weaponRight,
            this._weaponUp,
            this._weaponForward
        );
        this.weapon.quaternion.setFromRotationMatrix(this._weaponBasis);
    }

    _syncShots(effects) {
        const bounded = effects.slice(-SURFACE_COMBAT_LIMITS.maxShotEffects);
        const ids = bounded.map((entry) => entry.id).join('|');
        if (ids === this.lastShotIds) return;
        this.lastShotIds = ids;
        while (this.shotLines.children.length) {
            const child = this.shotLines.children[0];
            this.shotLines.remove(child);
            child.traverse((object) => {
                object.geometry?.dispose?.();
                object.material?.dispose?.();
            });
        }
        for (const effect of bounded) {
            const shot = new THREE.Group();
            shot.name = effect.id;
            const geometry = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3().fromArray(effect.start),
                new THREE.Vector3().fromArray(effect.end)
            ]);
            const material = new THREE.LineBasicMaterial({
                color: effect.hit ? '#fff9c7' : '#ff8066',
                transparent: true,
                opacity: 1,
                depthTest: false,
                depthWrite: false,
                toneMapped: false,
                blending: THREE.AdditiveBlending
            });
            const beam = new THREE.Line(geometry, material);
            beam.renderOrder = 1000;
            shot.add(beam);

            const muzzleGeometry = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3().fromArray(effect.start)
            ]);
            const muzzleMaterial = new THREE.PointsMaterial({
                color: '#fff4b0',
                size: 0.09,
                sizeAttenuation: true,
                transparent: true,
                opacity: 1,
                depthTest: false,
                depthWrite: false,
                toneMapped: false,
                blending: THREE.AdditiveBlending
            });
            const muzzleFlash = new THREE.Points(muzzleGeometry, muzzleMaterial);
            muzzleFlash.renderOrder = 1001;
            shot.add(muzzleFlash);
            this.shotLines.add(shot);
        }
    }

    dispose() {
        this.weapon.removeFromParent();
        this.root.removeFromParent();
        this.root.traverse((object) => {
            object.geometry?.dispose?.();
            if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose?.());
            else object.material?.dispose?.();
        });
    }
}

function normalizeModel(model) {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const largest = Math.max(size.x, size.y, size.z, 1e-6);
    model.scale.setScalar(0.38 / largest);
    box.setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);
}

function createEnemy() {
    const geometry = new THREE.OctahedronGeometry(1.05, 1);
    const material = new THREE.MeshStandardMaterial({
        color: '#6f2d2a',
        emissive: '#ff3428',
        emissiveIntensity: 0.55,
        metalness: 0.72,
        roughness: 0.34
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = SURFACE_COMBAT_ENEMY_ID;
    mesh.visible = false;
    return mesh;
}

function createFallbackWeapon() {
    const group = new THREE.Group();
    group.name = 'SurfacePulseCarbineFallback';
    const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.16, 0.34),
        new THREE.MeshStandardMaterial({
            color: '#28343d',
            emissive: '#4bd5ff',
            emissiveIntensity: 0.35,
            metalness: 0.7,
            roughness: 0.38
        })
    );
    body.position.z = 0.12;
    group.add(body);
    return group;
}
