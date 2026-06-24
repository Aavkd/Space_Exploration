import * as THREE from 'three';

export class SpeedLines {
    constructor({ count = 180, length = 280, color = 0xaaccff } = {}) {
        this.object3D = new THREE.LineSegments(
            this._createGeometry(count, length),
            new THREE.LineBasicMaterial({
                color,
                transparent: true,
                opacity: 0.22,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            })
        );
        this.object3D.name = 'ShipSpeedLines';
        this.object3D.visible = true;
        this.object3D.position.z = -80;
        this._travel = 0;
    }

    update(dt, speed) {
        this._travel += dt * Math.max(speed, 1);
        this.object3D.position.z = -80 + (this._travel % 80);
        // Fade fully to zero at rest (no floor) so the line volume does not hover
        // as a faint patch ahead of the ship when stationary.
        this.object3D.material.opacity = THREE.MathUtils.clamp(speed / 450, 0, 0.38);
    }

    _createGeometry(count, length) {
        const positions = new Float32Array(count * 2 * 3);

        for (let i = 0; i < count; i++) {
            const index = i * 6;
            const x = (Math.random() - 0.5) * 90;
            const y = (Math.random() - 0.5) * 48;
            const z = -Math.random() * 900;
            positions[index] = x;
            positions[index + 1] = y;
            positions[index + 2] = z;
            positions[index + 3] = x;
            positions[index + 4] = y;
            positions[index + 5] = z - length * (0.35 + Math.random());
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        return geometry;
    }
}
