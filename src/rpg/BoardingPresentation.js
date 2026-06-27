import * as THREE from 'three';
import { BOARDING_DERELICT_ID, BOARDING_LIMITS, BOARDING_LOG_ID } from './boarding.js';

export class BoardingPresentation {
    constructor({ scene } = {}) {
        if (!scene) throw new Error('BoardingPresentation requires a Three.js scene.');
        this.scene = scene;
        this.frame = new THREE.Group();
        this.frame.name = 'phase21BoardingFrame';
        this.derelict = createDerelict();
        this.frame.add(this.derelict.group);
        this.scene.add(this.frame);
        this.frame.visible = false;
        this.secured = false;
        this._scratch = new THREE.Vector3();
        this._scratchQuat = new THREE.Quaternion();
    }

    showAtWorldPosition(position) {
        if (!position?.isVector3) throw new Error('Boarding presentation requires a world position.');
        this.frame.position.set(0, 0, 0);
        this.frame.quaternion.identity();
        this.derelict.group.position.copy(position);
        this.frame.visible = true;
        this.secured = false;
        this.setInteriorActive(false);
        return this.getState();
    }

    secureToShip(ship, derelictWorldPosition = null) {
        if (!ship?.object3D) throw new Error('Boarding presentation requires the player ship.');
        const target = derelictWorldPosition?.isVector3
            ? derelictWorldPosition.clone()
            : this.getDerelictWorldPosition(new THREE.Vector3());
        ship.object3D.updateWorldMatrix(true, false);
        ship.object3D.matrixWorld.decompose(this.frame.position, this.frame.quaternion, this._scratch);
        this.frame.scale.set(1, 1, 1);
        this.frame.updateWorldMatrix(true, false);
        this.derelict.group.position.copy(this.frame.worldToLocal(target));
        this.derelict.group.quaternion.identity();
        this.frame.visible = true;
        this.secured = true;
        return this.getState();
    }

    restoreSecured(ship) {
        if (!ship?.object3D) throw new Error('Boarding presentation restore requires the player ship.');
        ship.object3D.updateWorldMatrix(true, false);
        ship.object3D.matrixWorld.decompose(this.frame.position, this.frame.quaternion, this._scratch);
        this.frame.scale.set(1, 1, 1);
        this.derelict.group.position.set(0, 0, -60);
        this.derelict.group.quaternion.identity();
        this.frame.visible = true;
        this.secured = true;
        return this.getState();
    }

    hide() {
        this.frame.visible = false;
        this.secured = false;
        this.setInteriorActive(false);
    }

    setInteriorActive(active) {
        this.derelict.exterior.visible = !active;
        this.derelict.interior.visible = Boolean(active);
    }

    getDerelictWorldPosition(target = new THREE.Vector3()) {
        return this.derelict.group.getWorldPosition(target);
    }

    getHatchWorldPosition(target = new THREE.Vector3()) {
        return this.derelict.hatch.getWorldPosition(target);
    }

    getEvaHatchSpawnWorld(target = new THREE.Vector3()) {
        target.set(0, 0, 20);
        return this.derelict.group.localToWorld(target);
    }

    getLogWorldPosition(target = new THREE.Vector3()) {
        return this.derelict.log.getWorldPosition(target);
    }

    getInteriorRoot() {
        return this.derelict.interiorRoot;
    }

    getInteriorSpawn() {
        return this.derelict.interiorSpawn.position.clone();
    }

    getInteriorHatchPosition() {
        return this.derelict.interiorHatch.position.clone();
    }

    getInteriorHatchWorldPosition(target = new THREE.Vector3()) {
        return this.derelict.interiorHatch.getWorldPosition(target);
    }

    getLogLocalPosition() {
        return this.derelict.log.position.clone();
    }

    rebaseOrigin(offset) {
        if (this.frame.parent === this.scene) this.frame.position.sub(offset);
    }

    getState() {
        return {
            available: true,
            visible: this.frame.visible,
            secured: this.secured,
            derelictId: BOARDING_DERELICT_ID,
            logId: BOARDING_LOG_ID,
            derelictWorldPosition: this.frame.visible
                ? this.getDerelictWorldPosition(new THREE.Vector3()).toArray()
                : null,
            interiorVisible: this.derelict.interior.visible,
            objectCount: countObjects(this.frame)
        };
    }
}

function createDerelict() {
    const group = new THREE.Group();
    group.name = BOARDING_DERELICT_ID;
    const exterior = new THREE.Group();
    exterior.name = 'wayfarerDerelictExterior';
    const hullMaterial = new THREE.MeshStandardMaterial({
        color: 0x35434a,
        emissive: 0x071116,
        metalness: 0.78,
        roughness: 0.48
    });
    const hull = new THREE.Mesh(new THREE.BoxGeometry(18, 8, 30), hullMaterial);
    hull.rotation.z = 0.08;
    exterior.add(hull);
    const spine = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 42), hullMaterial);
    spine.position.z = 2;
    exterior.add(spine);
    const brokenWing = new THREE.Mesh(new THREE.BoxGeometry(34, 1.5, 8), hullMaterial);
    brokenWing.position.set(-5, -1, 4);
    brokenWing.rotation.z = -0.18;
    exterior.add(brokenWing);
    const beacon = new THREE.PointLight(0x62d9ff, 3, 55, 1.5);
    beacon.position.set(0, 1, 17);
    exterior.add(beacon);
    group.add(exterior);

    const hatch = new THREE.Object3D();
    hatch.name = 'wayfarerDerelictHatch';
    hatch.position.set(0, 0, 17);
    group.add(hatch);

    const interiorRoot = new THREE.Group();
    interiorRoot.name = 'wayfarerDerelictInteriorRoot';
    group.add(interiorRoot);
    const interior = new THREE.Group();
    interior.name = 'wayfarerDerelictInterior';
    interiorRoot.add(interior);
    const roomMaterial = new THREE.MeshStandardMaterial({
        color: 0x1c292f,
        emissive: 0x050b0e,
        metalness: 0.5,
        roughness: 0.7,
        side: THREE.DoubleSide
    });
    const bounds = BOARDING_LIMITS.interiorBounds;
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const depth = bounds.maxZ - bounds.minZ;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(width, 0.25, depth), roomMaterial);
    floor.position.y = -0.125;
    interior.add(floor);
    const ceiling = floor.clone();
    ceiling.position.y = height;
    interior.add(ceiling);
    for (const x of [bounds.minX, bounds.maxX]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(0.25, height, depth), roomMaterial);
        wall.position.set(x, height / 2, 0);
        interior.add(wall);
    }
    for (const z of [bounds.minZ, bounds.maxZ]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.25), roomMaterial);
        wall.position.set(0, height / 2, z);
        interior.add(wall);
    }
    const emergencyLight = new THREE.PointLight(0xff8a55, 2.2, 24, 1.4);
    emergencyLight.position.set(0, 4.5, 0);
    interior.add(emergencyLight);

    const log = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.8, 0.25),
        new THREE.MeshStandardMaterial({
            color: 0x18313b,
            emissive: 0x1b819e,
            emissiveIntensity: 1.8,
            metalness: 0.4,
            roughness: 0.35
        })
    );
    log.name = BOARDING_LOG_ID;
    log.position.set(0, 1.2, -6.8);
    interior.add(log);

    const interiorSpawn = new THREE.Object3D();
    interiorSpawn.name = 'wayfarerDerelictInteriorSpawn';
    interiorSpawn.position.set(0, 0, 6.2);
    interiorRoot.add(interiorSpawn);
    const interiorHatch = new THREE.Object3D();
    interiorHatch.name = 'wayfarerDerelictInteriorHatch';
    interiorHatch.position.set(0, 0, 7.6);
    interiorRoot.add(interiorHatch);
    interior.visible = false;

    return {
        group,
        exterior,
        hatch,
        interiorRoot,
        interior,
        interiorSpawn,
        interiorHatch,
        log
    };
}

function countObjects(root) {
    let count = 0;
    root.traverse(() => { count += 1; });
    return count;
}
