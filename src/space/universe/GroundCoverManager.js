import * as THREE from 'three';
import { createSeededRandom, deriveSeed, randomRange } from './rng.js';
import { cubeFaceDirection } from './CubeSphereQuadTree.js';

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Decorative, tile-owned biome cover. It samples the authoritative surface for
 * placement but never contributes to height, normals, collision, or saves.
 *
 * Placement is clustered (not a uniform scatter) and each instance carries a
 * tinted colour biased toward the underlying terrain, so cover reads as grounded
 * vegetation/rock rather than evenly-spaced debris markers. Cover meshes use
 * MeshStandardMaterial and rely on the planet's directional + hemisphere lights,
 * so they are never rendered as unlit black silhouettes.
 */
export class GroundCoverManager {
    constructor({ seed, surface, minDepth = 16, maxInstancesPerTile = 26 } = {}) {
        this.seed = String(seed ?? surface?.seed ?? 'planet');
        this.surface = surface;
        this.minDepth = minDepth;
        this.maxInstancesPerTile = maxInstancesPerTile;
        this.enabled = true;
        this._groups = new Set();
        this._geometries = createCoverGeometries();
        this._materials = createCoverMaterials();
        this._tint = new THREE.Color();
    }

    decorateTile(node, mesh, origin) {
        if (node.depth < this.minDepth) return;
        const rng = createSeededRandom(deriveSeed(
            this.seed,
            `cover:${node.faceIndex}:${node.depth}:${node.x}:${node.y}`
        ));

        // A handful of cluster centres per tile; instances scatter tightly around
        // them (gaussian-ish) so cover clumps like real vegetation/scree fields.
        const clusterCount = 2 + Math.floor(rng() * 3);
        const clusters = [];
        for (let c = 0; c < clusterCount; c += 1) {
            clusters.push({
                u: 0.08 + rng() * 0.84,
                v: 0.08 + rng() * 0.84,
                spread: randomRange(rng, 0.04, 0.16)
            });
        }

        const instances = new Map();
        const dir = new THREE.Vector3();
        const normal = new THREE.Vector3();
        const sample = { color: new THREE.Color() };
        for (let attempt = 0; attempt < this.maxInstancesPerTile; attempt += 1) {
            const cluster = clusters[Math.floor(rng() * clusters.length)];
            const uu = THREE.MathUtils.clamp(cluster.u + gaussian(rng) * cluster.spread, 0.02, 0.98);
            const vv = THREE.MathUtils.clamp(cluster.v + gaussian(rng) * cluster.spread, 0.02, 0.98);
            const u = THREE.MathUtils.lerp(node.u0, node.u1, uu);
            const v = THREE.MathUtils.lerp(node.v0, node.v1, vv);
            cubeFaceDirection(node.faceIndex, u, v, dir);
            this.surface.sampleAt(dir, sample, { includeSlope: true });
            const style = coverStyle(sample);
            if (!style || rng() > style.density || sample.slopeDeg > style.maxSlopeDeg) continue;

            this.surface.normalAt(dir, normal);
            const scale = randomRange(rng, style.scale[0], style.scale[1]);
            const position = dir.clone().multiplyScalar(sample.height).sub(origin)
                .addScaledVector(normal, style.groundOffset * scale);
            const align = new THREE.Quaternion().setFromUnitVectors(UP, normal);
            const yaw = new THREE.Quaternion().setFromAxisAngle(normal, rng() * Math.PI * 2);
            const matrix = new THREE.Matrix4().compose(
                position,
                yaw.multiply(align),
                new THREE.Vector3(
                    scale * randomRange(rng, 0.78, 1.22),
                    scale * randomRange(rng, 0.85, 1.4),
                    scale * randomRange(rng, 0.78, 1.22)
                )
            );

            // Per-instance colour: the style base nudged toward the terrain colour
            // and jittered in value, so a clump never looks like stamped clones.
            this._tint.copy(style.color)
                .lerp(sample.color, style.terrainTint)
                .multiplyScalar(randomRange(rng, 0.82, 1.16));

            if (!instances.has(style.id)) instances.set(style.id, { matrices: [], colors: [] });
            const bucket = instances.get(style.id);
            bucket.matrices.push(matrix);
            bucket.colors.push(this._tint.clone());
        }

        if (!instances.size) return;
        const group = new THREE.Group();
        group.name = `GroundCover:${node.key}`;
        group.userData.groundCover = true;
        group.visible = this.enabled;
        for (const [styleId, bucket] of instances) {
            const cover = new THREE.InstancedMesh(
                this._geometries[styleId],
                this._materials[styleId],
                bucket.matrices.length
            );
            cover.name = `GroundCover:${styleId}`;
            cover.castShadow = false;
            cover.receiveShadow = true;
            cover.frustumCulled = false;
            bucket.matrices.forEach((matrix, index) => {
                cover.setMatrixAt(index, matrix);
                cover.setColorAt(index, bucket.colors[index]);
            });
            cover.instanceMatrix.needsUpdate = true;
            if (cover.instanceColor) cover.instanceColor.needsUpdate = true;
            group.add(cover);
        }
        mesh.add(group);
        this._groups.add(group);
        mesh.userData.disposeTile = () => this._groups.delete(group);
    }

    setEnabled(enabled) {
        this.enabled = Boolean(enabled);
        for (const group of this._groups) group.visible = this.enabled;
        return this.enabled;
    }

    getState(leaves = []) {
        let tileCount = 0;
        let instanceCount = 0;
        for (const leaf of leaves) {
            const group = leaf.mesh?.children.find((child) => child.userData?.groundCover);
            if (!group) continue;
            tileCount += 1;
            for (const child of group.children) instanceCount += child.count ?? 0;
        }
        return {
            enabled: this.enabled,
            minDepth: this.minDepth,
            maxInstancesPerTile: this.maxInstancesPerTile,
            visibleTiles: tileCount,
            visibleInstances: instanceCount,
            cachedDecorations: this._groups.size
        };
    }

    dispose() {
        this._groups.clear();
        Object.values(this._geometries).forEach((geometry) => geometry.dispose());
        Object.values(this._materials).forEach((material) => material.dispose());
    }
}

// Standard-normal-ish sample from two uniforms (Box–Muller, single component),
// scaled down so clusters stay tight.
function gaussian(rng) {
    const u = Math.max(1e-6, rng());
    const v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * 0.5;
}

function coverStyle(sample) {
    if (sample.isLiquid) return null;
    const biome = String(sample.biome).toLowerCase();
    const material = String(sample.material).toLowerCase();
    const tag = `${biome} ${material}`;
    if (/grass|green|coast|soil|lowland|highland/.test(tag)) {
        return {
            id: 'tuft',
            density: 0.92,
            maxSlopeDeg: 32,
            scale: [0.5, 1.35],
            groundOffset: 0.0,
            color: new THREE.Color('#5f8a3c'),
            terrainTint: 0.45
        };
    }
    if (/snow|ice|polar|frost/.test(tag)) {
        return {
            id: 'shard',
            density: 0.3,
            maxSlopeDeg: 36,
            scale: [0.35, 1.05],
            groundOffset: 0.0,
            color: new THREE.Color('#bfe8f4'),
            terrainTint: 0.25
        };
    }
    if (/desert|dune|sand|basin|salt/.test(tag)) {
        return {
            id: 'stone',
            density: 0.24,
            maxSlopeDeg: 30,
            scale: [0.3, 0.95],
            groundOffset: 0.0,
            color: new THREE.Color('#9a8862'),
            terrainTint: 0.5
        };
    }
    // Rocky/barren/volcanic default: scattered stones.
    return {
        id: 'stone',
        density: 0.34,
        maxSlopeDeg: 40,
        scale: [0.28, 1.05],
        groundOffset: 0.0,
        color: new THREE.Color('#6f6a60'),
        terrainTint: 0.5
    };
}

function createCoverGeometries() {
    return {
        tuft: createGrassTuft(),
        shard: createIceShard(),
        stone: createStone()
    };
}

// A small fan of tapered blades that bend outward — reads as a grass clump from
// player distance, not a single spike.
function createGrassTuft() {
    const positions = [];
    const blades = 6;
    for (let b = 0; b < blades; b += 1) {
        const a = (b / blades) * Math.PI * 2 + 0.35;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const baseR = 0.05;
        const bend = randomBladeBend(b);
        const w = 0.05;
        const h = 0.85 + (b % 3) * 0.22;
        const cx = ca * baseR;
        const cz = sa * baseR;
        const tx = cx + ca * bend;
        const tz = cz + sa * bend;
        // Perpendicular in the ground plane for the blade's base width.
        const px = Math.cos(a + Math.PI / 2) * w;
        const pz = Math.sin(a + Math.PI / 2) * w;
        positions.push(
            cx - px, 0, cz - pz,
            cx + px, 0, cz + pz,
            tx, h, tz
        );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.computeVertexNormals();
    return geometry;
}

function randomBladeBend(index) {
    // Deterministic per-blade lean so the clump silhouette is irregular.
    return 0.08 + ((index * 37) % 11) / 90;
}

function createIceShard() {
    const shard = new THREE.TetrahedronGeometry(0.42, 0);
    shard.scale(0.5, 1.7, 0.5);
    shard.translate(0, 0.42, 0);
    return shard;
}

function createStone() {
    const stone = new THREE.IcosahedronGeometry(0.42, 0);
    stone.scale(1.15, 0.62, 0.9);
    stone.translate(0, 0.2, 0);
    stone.computeVertexNormals();
    return stone;
}

function createCoverMaterials() {
    return {
        tuft: new THREE.MeshStandardMaterial({
            color: '#ffffff', // instanceColor supplies the real tint
            roughness: 0.95,
            metalness: 0,
            emissive: '#14240f',
            emissiveIntensity: 0.35,
            side: THREE.DoubleSide
        }),
        shard: new THREE.MeshStandardMaterial({
            color: '#ffffff',
            roughness: 0.4,
            metalness: 0.05,
            emissive: '#173d4b',
            emissiveIntensity: 0.2
        }),
        stone: new THREE.MeshStandardMaterial({
            color: '#ffffff',
            roughness: 0.96,
            metalness: 0,
            emissive: '#0e0d0b',
            emissiveIntensity: 0.25,
            flatShading: true
        })
    };
}
