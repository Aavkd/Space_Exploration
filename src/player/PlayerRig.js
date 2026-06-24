import * as THREE from 'three';
import { SHIP_DIMENSIONS } from '../ship/ShipInterior.js';

// Desktop first-person rig that lives in the SHIP-LOCAL frame. It is parented
// under the ship's interior root by the App, so its transform is expressed
// relative to the ship and rides along with every ship translation/rotation for
// free. The camera pose is produced by converting the head's local transform to
// world (`getCameraWorldPose`), which is the only local -> world hop the player
// camera needs.
//
// Hierarchy (all ship-local):
//   object3D (yaw, feet position) -> head (eye height + pitch) -> camera point
const PITCH_LIMIT = THREE.MathUtils.degToRad(88);

export class PlayerRig {
    constructor({ ship, eyeHeight = SHIP_DIMENSIONS.eyeHeight ?? 1.65 } = {}) {
        this.ship = ship;
        this.eyeHeight = eyeHeight;

        this.object3D = new THREE.Group();
        this.object3D.name = 'PlayerRigLocalToShip';

        // Pitch pivot at eye height; yaw lives on object3D, pitch on the head, so
        // walking yaw never tilts the horizon and EVA pitch never rolls it.
        this.head = new THREE.Group();
        this.head.name = 'PlayerHead';
        this.head.position.set(0, eyeHeight, 0);
        this.object3D.add(this.head);

        this.yaw = 0;
        this.pitch = 0;

        // Spawn at the ship-local interior spawn anchor (already ship-local).
        const spawn = this.ship.getAnchorLocalPosition?.('interiorSpawn');
        this.object3D.position.copy(spawn ?? new THREE.Vector3(0, 0, -1.4));

        this.state = { referenceFrame: 'ship-local', seatedAtControls: false };

        this._worldPos = new THREE.Vector3();
        this._worldQuat = new THREE.Quaternion();
        this._scratchScale = new THREE.Vector3();
        this._orientation = new THREE.Quaternion();
        this._euler = new THREE.Euler(0, 0, 0, 'YXZ');

        this._createDebugBody();
    }

    /** Ship-local feet position (mutated in place by locomotion). */
    get position() {
        return this.object3D.position;
    }

    setShipLocalPosition(vec3) {
        this.object3D.position.copy(vec3);
    }

    setEyeHeight(height) {
        this.eyeHeight = height;
        this.head.position.y = height;
    }

    /** Apply yaw/pitch (rad). Pitch is clamped to avoid flipping the view. */
    setLook(yaw, pitch) {
        this.yaw = yaw;
        this.pitch = THREE.MathUtils.clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
        this.object3D.rotation.set(0, this.yaw, 0);
        this.head.rotation.set(this.pitch, 0, 0);
    }

    addLook(deltaYaw, deltaPitch) {
        this.setLook(this.yaw + deltaYaw, this.pitch + deltaPitch);
    }

    /**
     * Full ship-local look orientation (yaw then pitch). Used by EVA locomotion
     * so free-flight thrust follows where the player is looking, expressed in the
     * ship frame.
     */
    getLocalOrientation(target = this._orientation) {
        this._euler.set(this.pitch, this.yaw, 0, 'YXZ');
        return target.setFromEuler(this._euler);
    }

    /**
     * Convert the head's ship-local transform to world space for the camera.
     * Refreshes the whole ancestor matrix chain (ship root -> interior -> rig ->
     * head) so the pose reflects the ship transform integrated this same frame,
     * with no one-frame lag.
     */
    getCameraWorldPose(outPosition, outQuaternion) {
        this.head.updateWorldMatrix(true, false);
        this.head.matrixWorld.decompose(outPosition, outQuaternion, this._scratchScale);
        return { position: outPosition, quaternion: outQuaternion };
    }

    get worldPosition() {
        return this.getCameraWorldPose(this._worldPos, this._worldQuat).position;
    }

    update() {
        // Pose is driven by PlayerController; nothing time-based to advance here.
    }

    setMarkerVisible(visible) {
        if (this.marker) this.marker.visible = visible;
    }

    /** Hide the body in first person (camera is inside it), show it otherwise. */
    setBodyVisible(visible) {
        if (this.marker) this.marker.visible = visible;
    }

    _createDebugBody() {
        const marker = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.25, 1.2, 4, 8),
            new THREE.MeshBasicMaterial({ color: 0xd9e8ff, wireframe: true })
        );
        marker.name = 'PlayerScaleMarker';
        marker.position.y = 0.85;
        this.marker = marker;
        this.object3D.add(marker);
    }
}
