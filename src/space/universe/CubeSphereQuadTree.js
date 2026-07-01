import * as THREE from 'three';
import { TileStreamer } from './TileStreamer.js';

// Continuous-LOD cube-sphere quadtree (docs/surface-eva-tier.md §3.1, §3.3).
//
// Six root face-quads, each an independent quadtree over its (u,v) cube face.
// A quad subdivides into 4 children when its on-sphere edge length divided by
// the camera's distance to it exceeds `errorThreshold` (a screen-space-error
// proxy), and merges when it drops well below it (hysteresis, to avoid thrash).
// Only quads near the camera reach deep LOD; the far hemisphere stays coarse.
//
// PRECISION CONTRACT (§4): every tile's vertices are stored RELATIVE TO THE
// TILE'S OWN CENTRE (small numbers — a few hundred metres at deep LOD), never at
// absolute planet-scale coordinates. The owning provider places each tile
// camera-relative every frame, so what reaches the GPU is always near the
// origin. This class only deals in planet-LOCAL float64 coordinates (centred at
// the planet centre); it never sees the scene frame or the camera world pose.
//
// Tile geometry generation now runs through TileStreamer under a per-frame ms
// budget. Inactive meshes live in an LRU cache, and parents stay visible until
// every replacement child is ready. Determinism comes from stable face/depth/x/y
// tile keys over the shared height basis.

const EPS = 1e-4; // finite-difference step in (u,v) for analytic-ish normals
const MIN_SKIRT_DEPTH = 0.5;
const MAX_SKIRT_DEPTH = 20;

// Cube faces: forward = outward face normal, (right, up) span the face. A face
// point (u,v) ∈ [-1,1]² maps to the cube point forward + u·right + v·up, then is
// normalised onto the sphere. Right/up are chosen so winding stays outward.
const FACES = [
    { forward: [1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] }, // +X
    { forward: [-1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] }, // -X
    { forward: [0, 1, 0], right: [1, 0, 0], up: [0, 0, -1] }, // +Y
    { forward: [0, -1, 0], right: [1, 0, 0], up: [0, 0, 1] }, // -Y
    { forward: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] }, // +Z
    { forward: [0, 0, -1], right: [-1, 0, 0], up: [0, 1, 0] } // -Z
];

export function cubeFaceDirection(faceIndex, u, v, target = new THREE.Vector3()) {
    const face = FACES[faceIndex];
    if (!face) throw new RangeError(`Unknown cube-sphere face ${faceIndex}`);
    return target.set(
        face.forward[0] + u * face.right[0] + v * face.up[0],
        face.forward[1] + u * face.right[1] + v * face.up[1],
        face.forward[2] + u * face.right[2] + v * face.up[2]
    ).normalize();
}

class QuadNode {
    constructor(faceIndex, u0, u1, v0, v1, depth, x = 0, y = 0) {
        this.faceIndex = faceIndex;
        this.u0 = u0; this.u1 = u1; this.v0 = v0; this.v1 = v1;
        this.depth = depth;
        this.x = x;
        this.y = y;
        this.key = `${faceIndex}:${depth}:${x}:${y}`;
        this.children = null;
        this.mesh = null;
        // Planet-local position of the tile's centre on the base sphere — the
        // origin its vertices are stored relative to (§4). Filled lazily.
        this.origin = null;
        this.edgeMetres = 0;
    }
}

export class CubeSphereQuadTree {
    constructor({
        basis,
        palette,
        material,
        tileRes,
        errorThreshold,
        maxDepth,
        skirtFraction,
        streamingBudgetMs = 2.0,
        cacheTiles = 384,
        decorateTile = null
    }) {
        this.basis = basis;
        this.radius = basis.radius;
        this.palette = palette;
        this.material = material;
        this.tileRes = tileRes;
        this.errorThreshold = errorThreshold;
        this.mergeThreshold = errorThreshold * 0.6;
        this.maxDepth = maxDepth;
        this.skirtFraction = skirtFraction;
        this.decorateTile = decorateTile;

        // The tile root the provider anchors at the camera world position each
        // frame; all tile meshes hang off it (§4).
        this.group = new THREE.Group();
        this.group.name = 'QuadPlanetTiles';
        this.group.frustumCulled = false;

        this.roots = FACES.map((_, i) => new QuadNode(i, -1, 1, -1, 1, 0));
        this.streamer = new TileStreamer({
            group: this.group,
            budgetMs: streamingBudgetMs,
            maxCachedTiles: cacheTiles
        });

        // Leaf tiles to render this frame, refreshed by update(). Each entry is a
        // QuadNode with a built mesh and a planet-local `origin`.
        this.leaves = [];

        // Scratch reused across the (many) per-vertex samples.
        this._sa = new THREE.Vector3();
        this._sb = new THREE.Vector3();
        this._sc = new THREE.Vector3();
        this._sd = new THREE.Vector3();
        this._tu = new THREE.Vector3();
        this._tv = new THREE.Vector3();

        for (const root of this.roots) {
            const { edgeMetres } = this._metrics(root, ZERO);
            root.edgeMetres = edgeMetres;
            const mesh = this.streamer.buildNow(root, () => this._buildTile(root));
            mesh.frustumCulled = false;
        }
    }

    // Walk the tree from the camera's PLANET-LOCAL position, subdividing/merging
    // by screen-space error, and refresh `this.leaves` with the visible tiles.
    update(cameraLocal) {
        this.streamer.processBudget();
        this.leaves.length = 0;
        for (const root of this.roots) this._updateNode(root, cameraLocal);
        return this.leaves.length;
    }

    _updateNode(node, cameraLocal) {
        const { edgeMetres, dist } = this._metrics(node, cameraLocal);
        node.edgeMetres = edgeMetres;
        const closeness = edgeMetres / Math.max(dist, 1);
        const canSplit = node.depth < this.maxDepth;

        if (canSplit && closeness > this.errorThreshold) {
            if (!node.children) this._split(node);
            if (this._childrenReady(node, cameraLocal)) {
                this._releaseMesh(node);
                for (const child of node.children) this._updateNode(child, cameraLocal);
                return;
            }
            this._hideChildren(node);
            this._showNode(node, cameraLocal);
            return;
        }

        // Hysteresis band: already subdivided and not yet clearly out of range —
        // keep the children rather than merging, so we don't pop on the boundary.
        if (node.children && closeness > this.mergeThreshold) {
            if (this._childrenReady(node, cameraLocal)) {
                this._releaseMesh(node);
                for (const child of node.children) this._updateNode(child, cameraLocal);
                return;
            }
            this._hideChildren(node);
            this._showNode(node, cameraLocal);
            return;
        }

        // Leaf: collapse any children that dropped below the merge threshold, then
        // render this node.
        if (node.children) {
            if (this._ensureMesh(node, this._priority(node, cameraLocal))) {
                this._collapse(node);
                this._showNode(node, cameraLocal);
                return;
            }
            for (const child of node.children) this._updateNode(child, cameraLocal);
            return;
        }
        this._showNode(node, cameraLocal);
    }

    // On-sphere edge length of the tile, and the camera's distance to its nearest
    // point (centre surface point pulled in by half the tile's diagonal). All
    // float64, planet-local.
    _metrics(node, cameraLocal) {
        const a = this._faceDir(node.faceIndex, node.u0, node.v0, this._sa);
        const b = this._faceDir(node.faceIndex, node.u1, node.v0, this._sb);
        const c = this._faceDir(node.faceIndex, node.u0, node.v1, this._sc);
        const uc = (node.u0 + node.u1) * 0.5;
        const vc = (node.v0 + node.v1) * 0.5;
        const centreDir = this._faceDir(node.faceIndex, uc, vc, this._sd);

        // Great-circle arc length of the two spanning edges, take the larger.
        const edgeU = this.radius * Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
        const edgeV = this.radius * Math.acos(THREE.MathUtils.clamp(a.dot(c), -1, 1));
        const edgeMetres = Math.max(edgeU, edgeV);

        // Centre surface point, then distance from camera minus the tile's reach.
        const surfaceR = this.basis.surfaceRadiusAt(centreDir);
        this._tu.copy(centreDir).multiplyScalar(surfaceR);
        const dist = Math.max(cameraLocal.distanceTo(this._tu) - edgeMetres * 0.5, 1);
        return { edgeMetres, dist };
    }

    _split(node) {
        const um = (node.u0 + node.u1) * 0.5;
        const vm = (node.v0 + node.v1) * 0.5;
        const d = node.depth + 1;
        node.children = [
            new QuadNode(node.faceIndex, node.u0, um, node.v0, vm, d, node.x * 2, node.y * 2),
            new QuadNode(node.faceIndex, um, node.u1, node.v0, vm, d, node.x * 2 + 1, node.y * 2),
            new QuadNode(node.faceIndex, node.u0, um, vm, node.v1, d, node.x * 2, node.y * 2 + 1),
            new QuadNode(node.faceIndex, um, node.u1, vm, node.v1, d, node.x * 2 + 1, node.y * 2 + 1)
        ];
    }

    _collapse(node) {
        for (const child of node.children) {
            if (child.children) this._collapse(child);
            this._releaseMesh(child);
            this.streamer.cancel(child.key);
        }
        node.children = null;
    }

    _hideMesh(node) {
        if (node.mesh) node.mesh.visible = false;
    }

    _hideChildren(node) {
        if (!node.children) return;
        for (const child of node.children) {
            this._hideMesh(child);
            this._hideChildren(child);
        }
    }

    _ensureMesh(node, priority = 0) {
        return this.streamer.acquire(node, () => {
            const mesh = this._buildTile(node);
            mesh.frustumCulled = false; // placement is camera-relative each frame
            return mesh;
        }, priority);
    }

    _childrenReady(node, cameraLocal) {
        let ready = true;
        for (const child of node.children) {
            if (!this._ensureMesh(child, this._priority(child, cameraLocal))) ready = false;
        }
        return ready;
    }

    _showNode(node, cameraLocal) {
        if (!this._ensureMesh(node, this._priority(node, cameraLocal))) return false;
        node.mesh.visible = true;
        this.leaves.push(node);
        return true;
    }

    _releaseMesh(node) {
        this.streamer.release(node);
    }

    // Build a tile's geometry with vertices stored RELATIVE TO the tile centre on
    // the base sphere (§4), plus a downward skirt ring that hides cracks against
    // a coarser neighbour (§3.3). Normals are finite-differenced from the shared
    // height field so they stay continuous across LOD boundaries; vertex colours
    // are the same biome/altitude bands the hero sphere uses.
    _buildTile(node) {
        const res = this.tileRes;
        const gridN = res + 1;
        const uc = (node.u0 + node.u1) * 0.5;
        const vc = (node.v0 + node.v1) * 0.5;
        // Tile origin = the centre point ON THE SURFACE (height included), so the
        // vertices stored relative to it stay small even over a high plateau — the
        // intra-tile variation, not the full planet radius. This is the heart of
        // the §4 precision contract: small numbers reach the GPU.
        const centreDir = this._faceDir(node.faceIndex, uc, vc, new THREE.Vector3());
        const origin = centreDir.clone().multiplyScalar(this.basis.surfaceRadiusAt(centreDir));
        node.origin = origin;

        const vertCount = gridN * gridN;
        const skirtPerEdge = gridN;
        const skirtCount = skirtPerEdge * 4;
        const total = vertCount + skirtCount;

        const positions = new Float32Array(total * 3);
        const normals = new Float32Array(total * 3);
        const colors = new Float32Array(total * 3);
        const materialData = new Float32Array(total * 3);

        const dir = new THREE.Vector3();
        const pos = new THREE.Vector3();
        const nrm = new THREE.Vector3();
        const color = new THREE.Color();
        const sample = { color };
        const edgeMetres = node.edgeMetres || (this.radius * Math.PI * 0.5 / Math.max(1, 2 ** node.depth));
        const skirtDepth = THREE.MathUtils.clamp(
            edgeMetres * this.skirtFraction,
            MIN_SKIRT_DEPTH,
            MAX_SKIRT_DEPTH
        );

        const writeVertex = (index, p, n, col, roughness = 0.7, emissive = 0, slopeDeg = 0) => {
            positions[index * 3] = p.x; positions[index * 3 + 1] = p.y; positions[index * 3 + 2] = p.z;
            normals[index * 3] = n.x; normals[index * 3 + 1] = n.y; normals[index * 3 + 2] = n.z;
            colors[index * 3] = col.r; colors[index * 3 + 1] = col.g; colors[index * 3 + 2] = col.b;
            materialData[index * 3] = roughness;
            materialData[index * 3 + 1] = emissive;
            materialData[index * 3 + 2] = slopeDeg;
        };

        // Surface grid.
        for (let j = 0; j < gridN; j++) {
            const v = THREE.MathUtils.lerp(node.v0, node.v1, j / res);
            for (let i = 0; i < gridN; i++) {
                const u = THREE.MathUtils.lerp(node.u0, node.u1, i / res);
                this._faceDir(node.faceIndex, u, v, dir);
                const r = this.basis.surfaceRadiusAt(dir);
                pos.copy(dir).multiplyScalar(r).sub(origin); // tile-relative (small)
                this._surfaceNormal(node.faceIndex, u, v, dir, nrm);
                this.basis.sampleAt(dir, sample, { normal: nrm });
                const slopeDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(nrm.dot(dir), -1, 1)));
                writeVertex(
                    j * gridN + i,
                    pos,
                    nrm,
                    sample.color,
                    sample.roughnessHint,
                    sample.emissiveStrength,
                    slopeDeg
                );
            }
        }

        // Surface indices. Cube faces do not all share the same (right x up)
        // parity, so flip only the faces whose parameter-space normal points
        // inward. This keeps the actual terrain front-facing.
        const indices = [];
        const face = FACES[node.faceIndex];
        const crossX = face.right[1] * face.up[2] - face.right[2] * face.up[1];
        const crossY = face.right[2] * face.up[0] - face.right[0] * face.up[2];
        const crossZ = face.right[0] * face.up[1] - face.right[1] * face.up[0];
        const flipWinding = crossX * face.forward[0]
            + crossY * face.forward[1]
            + crossZ * face.forward[2] < 0;
        for (let j = 0; j < res; j++) {
            for (let i = 0; i < res; i++) {
                const a = j * gridN + i;
                const b = a + 1;
                const c = a + gridN;
                const d = c + 1;
                if (flipWinding) indices.push(a, c, b, b, c, d);
                else indices.push(a, b, c, b, d, c);
            }
        }

        // Skirt: duplicate each border vertex pulled radially inward (toward the
        // planet centre) by skirtDepth, and stitch border→skirt with quads so any
        // crack against a coarser neighbour is filled by a vertical wall.
        let skirtBase = vertCount;
        const addSkirtEdge = (borderIndices) => {
            const start = skirtBase;
            for (let k = 0; k < borderIndices.length; k++) {
                const srcIndex = borderIndices[k];
                pos.set(positions[srcIndex * 3], positions[srcIndex * 3 + 1], positions[srcIndex * 3 + 2]);
                // Inward = toward planet centre = -(origin + pos) direction.
                this._sa.copy(origin).add(pos).normalize();
                pos.addScaledVector(this._sa, -skirtDepth);
                nrm.set(normals[srcIndex * 3], normals[srcIndex * 3 + 1], normals[srcIndex * 3 + 2]);
                color.setRGB(colors[srcIndex * 3], colors[srcIndex * 3 + 1], colors[srcIndex * 3 + 2]);
                writeVertex(
                    skirtBase + k,
                    pos,
                    nrm,
                    color,
                    materialData[srcIndex * 3],
                    materialData[srcIndex * 3 + 1],
                    materialData[srcIndex * 3 + 2]
                );
            }
            for (let k = 0; k < borderIndices.length - 1; k++) {
                const t0 = borderIndices[k];
                const t1 = borderIndices[k + 1];
                const s0 = start + k;
                const s1 = start + k + 1;
                indices.push(t0, s0, t1, t1, s0, s1);
            }
            skirtBase += borderIndices.length;
        };

        const bottom = [], top = [], left = [], right = [];
        for (let i = 0; i < gridN; i++) {
            bottom.push(i);
            top.push((gridN - 1) * gridN + i);
            left.push(i * gridN);
            right.push(i * gridN + (gridN - 1));
        }
        addSkirtEdge(bottom);
        addSkirtEdge(top);
        addSkirtEdge(left);
        addSkirtEdge(right);

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aMaterialData', new THREE.BufferAttribute(materialData, 3));
        geometry.setIndex(indices);

        const mesh = new THREE.Mesh(geometry, this.material);
        mesh.name = `Tile:${node.key}`;
        this.decorateTile?.(node, mesh, origin);
        return mesh;
    }

    // Unit sphere direction for a face's (u,v). Plain normalise of the cube point.
    _faceDir(faceIndex, u, v, target) {
        return cubeFaceDirection(faceIndex, u, v, target);
    }

    // Finite-difference surface normal from the shared height field, so the same
    // (face,u,v)→height drives lighting on both sides of an LOD seam.
    _surfaceNormal(faceIndex, u, v, dir, target) {
        const su = this._surfaceAt(faceIndex, u + EPS, v, this._tu);
        const sd = this._surfaceAt(faceIndex, u - EPS, v, this._sb);
        const sv = this._surfaceAt(faceIndex, u, v + EPS, this._tv);
        const sw = this._surfaceAt(faceIndex, u, v - EPS, this._sc);
        const tu = su.sub(sd);
        const tv = sv.sub(sw);
        target.copy(tu).cross(tv).normalize();
        if (target.dot(dir) < 0) target.negate();
        if (!Number.isFinite(target.x)) target.copy(dir); // degenerate fallback
        return target;
    }

    _surfaceAt(faceIndex, u, v, target) {
        this._faceDir(faceIndex, u, v, target);
        return target.multiplyScalar(this.basis.surfaceRadiusAt(target));
    }

    getStats() {
        return {
            leafCount: this.leaves.length,
            ...this.streamer.getStats()
        };
    }

    dispose() {
        for (const root of this.roots) {
            if (root.children) this._collapse(root);
            this._disposeMesh(root);
        }
        this.streamer.dispose();
        this.group.clear();
    }

    _disposeMesh(node) {
        if (!node.mesh) return;
        this.group.remove(node.mesh);
        node.mesh.userData.disposeTile?.();
        node.mesh.geometry.dispose();
        node.mesh = null;
    }

    _priority(node, cameraLocal) {
        const { edgeMetres, dist } = this._metrics(node, cameraLocal);
        node.edgeMetres = edgeMetres;
        return node.depth * 1000 + edgeMetres / Math.max(dist, 1);
    }
}

const ZERO = new THREE.Vector3();
