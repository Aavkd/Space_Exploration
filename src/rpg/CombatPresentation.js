import * as THREE from 'three';

export class CombatPresentation {
    constructor({ scene } = {}) {
        if (!scene) throw new Error('CombatPresentation requires a Three.js scene.');
        this.group = new THREE.Group();
        this.group.name = 'phase19CombatPresentation';
        scene.add(this.group);
        this.enemy = createEnemyMesh();
        this.targetMarker = createRing(0x78e7ff, 28);
        this.leadMarker = createRing(0xffcf68, 10);
        this.group.add(this.enemy, this.targetMarker, this.leadMarker);
        this.projectileMeshes = [];
        this.update(null);
    }

    update(state) {
        const active = Boolean(state?.active && state.enemy);
        this.enemy.visible = active;
        if (active) {
            this.enemy.position.fromArray(state.enemy.position);
            this.enemy.lookAt(
                state.enemy.position[0] + state.enemy.forward[0],
                state.enemy.position[1] + state.enemy.forward[1],
                state.enemy.position[2] + state.enemy.forward[2]
            );
        }
        const target = state?.target;
        this.targetMarker.visible = Boolean(active && target);
        this.leadMarker.visible = Boolean(active && target?.lead);
        if (target) {
            this.targetMarker.position.fromArray(state.enemy.position);
            this.leadMarker.position.fromArray(target.lead);
        }
        const projectiles = state?.projectiles ?? [];
        while (this.projectileMeshes.length < projectiles.length) {
            const mesh = new THREE.Mesh(
                new THREE.SphereGeometry(1.2, 6, 4),
                new THREE.MeshBasicMaterial({ color: 0x7fe9ff, toneMapped: false })
            );
            this.projectileMeshes.push(mesh);
            this.group.add(mesh);
        }
        this.projectileMeshes.forEach((mesh, index) => {
            mesh.visible = index < projectiles.length;
            if (mesh.visible) {
                mesh.position.fromArray(projectiles[index].position);
                mesh.material.color.set(projectiles[index].ownerId === 'player_ship' ? 0x7fe9ff : 0xff5c52);
            }
        });
    }

    getState() {
        return {
            enemyVisible: this.enemy.visible,
            targetVisible: this.targetMarker.visible,
            leadVisible: this.leadMarker.visible,
            projectileMeshCount: this.projectileMeshes.length,
            visibleProjectileCount: this.projectileMeshes.filter((mesh) => mesh.visible).length
        };
    }

    cleanup() {
        this.update(null);
    }
}

function createEnemyMesh() {
    const group = new THREE.Group();
    group.name = 'scavenger_red_knife_visual';
    const material = new THREE.MeshStandardMaterial({
        color: 0x661d1d,
        emissive: 0x330606,
        metalness: 0.7,
        roughness: 0.4
    });
    const hull = new THREE.Mesh(new THREE.ConeGeometry(12, 34, 5), material);
    hull.rotation.x = -Math.PI / 2;
    group.add(hull);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(38, 2, 10), material);
    wing.position.z = 5;
    group.add(wing);
    return group;
}

function createRing(color, radius) {
    const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthTest: false,
        toneMapped: false
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.78, radius, 32), material);
    ring.renderOrder = 100;
    ring.visible = false;
    return ring;
}
