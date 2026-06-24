import * as THREE from 'three';

/**
 * Newtonian gravity from a small set of point attractors (black holes,
 * galaxies...). Deliberately decoupled from any mesh: it only knows world
 * positions and masses, so the visual environment and the physics can evolve
 * independently. The ship asks for an acceleration at its current position and
 * the field returns the summed pull of the nearest attractors.
 *
 * Tuning notes: the masses here are scaled for this project (objects a few
 * thousand units away, ship cruising at tens-to-hundreds of m/s), not for the
 * original Racing scale. `gravityScale` is the single runtime knob exposed in
 * the F2 "Deep Space" group; raise it to make slingshots violent, drop it to
 * make the void calm.
 */
export class GravityField {
    constructor({
        gravityConstant = 1,
        gravityScale = 1,
        maxDistance = 70000,
        minDistance = 300,
        maxAcceleration = 160,
        maxAttractors = 3
    } = {}) {
        this.gravityConstant = gravityConstant;
        this.gravityScale = gravityScale;
        this.maxDistance = maxDistance;
        this.minDistance = minDistance;
        this.maxAcceleration = maxAcceleration;
        this.maxAttractors = maxAttractors;
        this.attractors = [];

        // Scratch vectors reused every frame to avoid per-frame allocation.
        this._toAttractor = new THREE.Vector3();
        this._ranked = [];
    }

    addAttractor({ position, mass, type = 'attractor', name = type }) {
        this.attractors.push({
            position: position.clone(),
            mass,
            type,
            name
        });
        return this;
    }

    setAttractors(list) {
        this.attractors = [];
        for (const attractor of list) this.addAttractor(attractor);
        return this;
    }

    setGravityScale(scale) {
        this.gravityScale = scale;
    }

    /**
     * Summed gravitational acceleration (world space, m/s^2) felt at `position`.
     * Only the nearest `maxAttractors` within `maxDistance` contribute, each
     * capped at `maxAcceleration` so a close pass bends the trajectory hard
     * without launching the integrator to infinity.
     */
    getAcceleration(position, target = new THREE.Vector3()) {
        target.set(0, 0, 0);
        if (this.gravityScale === 0 || this.attractors.length === 0) return target;

        this._ranked.length = 0;
        for (const attractor of this.attractors) {
            const distance = position.distanceTo(attractor.position);
            if (distance > this.maxDistance) continue;
            this._ranked.push({ attractor, distance });
        }

        this._ranked.sort((a, b) => a.distance - b.distance);

        const count = Math.min(this._ranked.length, this.maxAttractors);
        for (let i = 0; i < count; i++) {
            const { attractor, distance } = this._ranked[i];
            const clamped = Math.max(distance, this.minDistance);
            let acceleration =
                (this.gravityConstant * attractor.mass * this.gravityScale) / (clamped * clamped);
            acceleration = Math.min(acceleration, this.maxAcceleration);

            this._toAttractor.copy(attractor.position).sub(position);
            if (this._toAttractor.lengthSq() > 0) {
                this._toAttractor.normalize().multiplyScalar(acceleration);
                target.add(this._toAttractor);
            }
        }

        return target;
    }

    /**
     * Closest attractor and how hard it pulls right now. Used by the debug HUD
     * so the manual gate ("pass near an attractor and see the deviation") is
     * observable instead of guessed.
     */
    nearestAttractor(position) {
        let nearest = null;
        let nearestDistance = Infinity;

        for (const attractor of this.attractors) {
            const distance = position.distanceTo(attractor.position);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearest = attractor;
            }
        }

        if (!nearest) return null;

        const clamped = Math.max(nearestDistance, this.minDistance);
        const pull = Math.min(
            (this.gravityConstant * nearest.mass * this.gravityScale) / (clamped * clamped),
            this.maxAcceleration
        );

        return { type: nearest.type, name: nearest.name, distance: nearestDistance, acceleration: pull };
    }
}
