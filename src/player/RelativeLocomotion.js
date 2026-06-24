import * as THREE from 'three';
import { SHIP_WALKABLE_VOLUMES, SHIP_DIMENSIONS } from '../ship/ShipInterior.js';

// Locomotion solved entirely in the SHIP-LOCAL frame. Because nothing here ever
// touches a world-space vector, the result is invariant to the ship's world
// translation and rotation: "down" is always local -Y, the walkable footprint
// is always the same set of local rectangles, and the player can never be
// "thrown" by the ship moving through the world. The App parents the player rig
// under the ship and only converts local -> world for the camera at render time.
//
// Two modes:
//   - walk  : deck-bound. Heading-relative XZ movement, per-axis AABB sliding
//             against the walkable blockout, and a pseudo-gravity settle to the
//             deck (local y = deckHeight).
//   - eva   : free 6-DOF float in the ship frame (airlock excursion). No
//             collision, no gravity; movement is relative to the look direction.
const DEFAULTS = Object.freeze({
    walkSpeed: 3.2, // m/s
    runSpeed: 6.0, // m/s (Shift)
    deckHeight: SHIP_DIMENSIONS.deckHeight ?? 0,
    groundSettleRate: 14, // pseudo-gravity: how fast feet are pulled to the deck
    evaSpeed: 6.5, // m/s
    evaBoost: 2.4 // Shift multiplier in EVA
});

export class RelativeLocomotion {
    constructor({ volumes = SHIP_WALKABLE_VOLUMES, config = {} } = {}) {
        this.config = { ...DEFAULTS, ...config };

        // Normalize the footprint rectangles once.
        this.volumes = volumes.map((v) => ({
            id: v.id,
            connector: Boolean(v.connector),
            minX: v.min[0],
            minZ: v.min[1],
            maxX: v.max[0],
            maxZ: v.max[1]
        }));

        // Reported each step for HUD / debug hooks.
        this.lastStep = { grounded: true, blockedX: false, blockedZ: false, volumeId: null };

        this._forward = new THREE.Vector3();
        this._right = new THREE.Vector3();
        this._move = new THREE.Vector3();
    }

    /** Is the ship-local XZ point inside the union of walkable rectangles? */
    containsXZ(x, z) {
        for (const v of this.volumes) {
            if (x >= v.minX && x <= v.maxX && z >= v.minZ && z <= v.maxZ) return v.id;
        }
        return null;
    }

    /** Nearest walkable rectangle id to a ship-local XZ point (for recovery). */
    nearestVolumeId(x, z) {
        let bestId = null;
        let bestDist = Infinity;
        for (const v of this.volumes) {
            const cx = THREE.MathUtils.clamp(x, v.minX, v.maxX);
            const cz = THREE.MathUtils.clamp(z, v.minZ, v.maxZ);
            const d = (cx - x) ** 2 + (cz - z) ** 2;
            if (d < bestDist) {
                bestDist = d;
                bestId = v.id;
            }
        }
        return bestId;
    }

    /**
     * If a ship-local XZ point has drifted outside every walkable rectangle,
     * snap it back to the closest point on the nearest rectangle. Used to keep a
     * spawn / seat-exit position safely on the floor.
     */
    clampInside(position) {
        if (this.containsXZ(position.x, position.z)) return position;

        const id = this.nearestVolumeId(position.x, position.z);
        const v = this.volumes.find((vol) => vol.id === id);
        if (v) {
            position.x = THREE.MathUtils.clamp(position.x, v.minX, v.maxX);
            position.z = THREE.MathUtils.clamp(position.z, v.minZ, v.maxZ);
        }
        return position;
    }

    /**
     * Advance a walking player by one step (mutates `position` in place).
     *
     * @param {THREE.Vector3} position ship-local feet position
     * @param {number} yaw heading (rad about local +Y; yaw 0 faces -Z)
     * @param {{forward:number, strafe:number}} move axis inputs in [-1, 1]
     * @param {number} dt seconds
     * @param {{run?:boolean}} options
     */
    walk(position, yaw, move, dt, { run = false } = {}) {
        const speed = run ? this.config.runSpeed : this.config.walkSpeed;

        // Heading basis in the ship-local frame (Y-rotation of forward=-Z, right=+X).
        const sin = Math.sin(yaw);
        const cos = Math.cos(yaw);
        this._forward.set(-sin, 0, -cos);
        this._right.set(cos, 0, -sin);

        this._move
            .copy(this._forward).multiplyScalar(move.forward ?? 0)
            .addScaledVector(this._right, move.strafe ?? 0);

        // Normalize so diagonal walking is not faster than straight walking.
        if (this._move.lengthSq() > 1e-6) this._move.normalize().multiplyScalar(speed * dt);

        const blocked = this._resolveSlide(position, this._move.x, this._move.z);
        const grounded = this._applyPseudoGravity(position, dt);

        this.lastStep = {
            grounded,
            blockedX: blocked.blockedX,
            blockedZ: blocked.blockedZ,
            volumeId: this.containsXZ(position.x, position.z)
        };
        return this.lastStep;
    }

    /**
     * Per-axis sliding against the walkable union. We test the candidate point
     * with NO per-rectangle inset, so internal seams between abutting/overlapping
     * rectangles stay open and the player can move room-to-room; walls live at the
     * outer edges of the union. Player radius is treated as visual only here
     * (documented limit). X is resolved first, then Z using the updated X, which
     * lets you slide along a wall instead of sticking to it.
     */
    _resolveSlide(position, dx, dz) {
        let blockedX = false;
        let blockedZ = false;

        if (dx !== 0) {
            if (this.containsXZ(position.x + dx, position.z)) position.x += dx;
            else blockedX = true;
        }
        if (dz !== 0) {
            if (this.containsXZ(position.x, position.z + dz)) position.z += dz;
            else blockedZ = true;
        }

        return { blockedX, blockedZ };
    }

    /** Ease the feet toward the deck (local -Y). Stable under ship rotation. */
    _applyPseudoGravity(position, dt) {
        const deck = this.config.deckHeight;
        const factor = 1 - Math.exp(-this.config.groundSettleRate * dt);
        position.y += (deck - position.y) * factor;
        if (Math.abs(position.y - deck) < 1e-3) position.y = deck;
        return Math.abs(position.y - deck) < 0.02;
    }

    /**
     * Advance an EVA (free-floating) player by one step in the ship frame.
     *
     * @param {THREE.Vector3} position ship-local position
     * @param {THREE.Quaternion} orientation ship-local look orientation
     * @param {{forward:number, strafe:number, vertical:number}} move inputs in [-1,1]
     * @param {number} dt seconds
     * @param {{boost?:boolean}} options
     */
    floatEVA(position, orientation, move, dt, { boost = false } = {}) {
        const speed = this.config.evaSpeed * (boost ? this.config.evaBoost : 1);

        // Look-relative basis: forward = -Z, right = +X, up = +Y, rotated by the
        // player's full look orientation (still expressed in the ship frame).
        this._forward.set(0, 0, -1).applyQuaternion(orientation);
        this._right.set(1, 0, 0).applyQuaternion(orientation);

        this._move
            .copy(this._forward).multiplyScalar(move.forward ?? 0)
            .addScaledVector(this._right, move.strafe ?? 0);
        this._move.y += move.vertical ?? 0; // vertical is ship-up, independent of pitch

        if (this._move.lengthSq() > 1e-6) {
            this._move.normalize().multiplyScalar(speed * dt);
            position.add(this._move);
        }

        this.lastStep = { grounded: false, blockedX: false, blockedZ: false, volumeId: null };
        return this.lastStep;
    }
}
