import * as THREE from 'three';

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
// This slice generates tile geometry SYNCHRONOUSLY (cheap for a 17×17 grid).
// Time-sliced async streaming + a bounded LRU cache are the next phase (§5, §14);
// the determinism here (tiles are pure functions of face/lod/coords over the
// shared height basis) is what makes that drop-in later.

const EPS = 1e-4; // finite-difference step in (u,v) for analytic-ish normals

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

class QuadNode {
    constructor(faceIndex, u0, u1, v0, v1, depth) {
        this.faceIndex = faceIndex;
        this.u0 = u0; this.u1 = u1; this.v0 = v0; this.v1 = v1;
        this.depth = depth;
        this.children = null;
        this.mesh = null;
        // Planet-local position of the tile's centre on the base sphere — the
        // origin its vertices are stored relative to (§4). Filled lazily.
        this.origin = null;
        this.edgeMetres = 0;
    }
}

export class CubeSphereQuadTree {
    constructor({ basis, palette, material, tileRes, errorThreshold, maxDepth, skirtFraction }) {
        this.basis = basis;
        this.radius = basis.radius;
        this.palette = palette;
        this.material = material;
        this.tileRes = tileRes;
        this.errorThreshold = errorThreshold;
        this.mergeThreshold = errorThreshold * 0.6;
        this.maxDepth = maxDepth;
        this.skirtFraction = skirtFraction;

        // The tile root the provider anchors at the camera world position each
        // frame; all tile meshes hang off it (§4).
        this.group = new THREE.Group();
        this.group.name = 'QuadPlanetTiles';
        this.group.frustumCulled = false;

        this.roots = FACES.map((_, i) => new QuadNode(i, -1, 1, -1, 1, 0));

        // Leaf tiles to render this frame, refreshed by update(). Each entry is a
        // QuadNode with a built mesh and a planet-local `origin`.
        this.leaves = [];
        this._builtCount = 0;

        // Scratch reused across the (many) per-vertex samples.
        this._sa = new THREE.Vector3();
        this._sb = new THREE.Vector3();
        this._sc = new THREE.Vector3();
        this._sd = new THREE.Vector3();
        this._tu = new THREE.Vector3();
        this._tv = new THREE.Vector3();
    }

    // Walk the tree from the camera's PLANET-LOCAL position, subdividing/merging
    // by screen-space error, and refresh `this.leaves` with the visible tiles.
    update(cameraLocal) {
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
            this._hideMesh(node);
            for (const child of node.children) this._updateNode(child, cameraLocal);
            return;
        }

        // Hysteresis band: already subdivided and not yet clearly out of range —
        // keep the children rather than merging, so we don't pop on the boundary.
        if (node.children && closeness > this.mergeThreshold) {
            this._hideMesh(node);
            for (const child of node.children) this._updateNode(child, cameraLocal);
            return;
        }

        // Leaf: collapse any children that dropped below the merge threshold, then
        // render this node.
        if (node.children) this._collapse(node);
        this._ensureMesh(node);
        node.mesh.visible = true;
        this.leaves.push(node);
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
            new QuadNode(node.faceIndex, node.u0, um, node.v0, vm, d),
            new QuadNode(node.faceIndex, um, node.u1, node.v0, vm, d),
            new QuadNode(node.faceIndex, node.u0, um, vm, node.v1, d),
            new QuadNode(node.faceIndex, um, node.u1, vm, node.v1, d)
        ];
    }

    _collapse(node) {
        for (const child of node.children) {
            if (child.children) this._collapse(child);
            this._disposeMesh(child);
        }
        node.children = null;
    }

    _hideMesh(node) {
        if (node.mesh) node.mesh.visible = false;
    }

    _ensureMesh(node) {
        if (node.mesh) return;
        node.mesh = this._buildTile(node);
        node.mesh.frustumCulled = false; // placement is camera-relative each frame
        this.group.add(node.mesh);
        this._builtCount++;
    }

    _disposeMesh(node) {
        if (!node.mesh) return;
        this.group.remove(node.mesh);
        node.mesh.geometry.dispose();
        node.mesh = null;
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

        const dir = new THREE.Vector3();
        const pos = new THREE.Vector3();
        const nrm = new THREE.Vector3();
        const color = new THREE.Color();
        const skirtDepth = Math.max(node.edgeMetres * this.skirtFraction, this.radius * 1e-5);

        const writeVertex = (index, p, n, col) => {
            positions[index * 3] = p.x; positions[index * 3 + 1] = p.y; positions[index * 3 + 2] = p.z;
            normals[index * 3] = n.x; normals[index * 3 + 1] = n.y; normals[index * 3 + 2] = n.z;
            colors[index * 3] = col.r; colors[index * 3 + 1] = col.g; colors[index * 3 + 2] = col.b;
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
                this._tileColor(dir, color);
                writeVertex(j * gridN + i, pos, nrm, color);
            }
        }

        // Surface indices.
        const indices = [];
        for (let j = 0; j < res; j++) {
            for (let i = 0; i < res; i++) {
                const a = j * gridN + i;
                const b = a + 1;
                const c = a + gridN;
                const d = c + 1;
                indices.push(a, c, b, b, c, d);
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
                writeVertex(skirtBase + k, pos, nrm, color);
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
        geometry.setIndex(indices);

        const mesh = new THREE.Mesh(geometry, this.material);
        mesh.name = `Tile:${node.faceIndex}:${node.depth}`;
        return mesh;
    }

    // Unit sphere direction for a face's (u,v). Plain normalise of the cube point.
    _faceDir(faceIndex, u, v, target) {
        const f = FACES[faceIndex];
        return target.set(
            f.forward[0] + u * f.right[0] + v * f.up[0],
            f.forward[1] + u * f.right[1] + v * f.up[1],
            f.forward[2] + u * f.right[2] + v * f.up[2]
        ).normalize();
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

    // Biome/altitude bands, matching the hero sphere's terrain colouring so a
    // world looks the same when rebuilt at true radius (palette = [ocean, land, high]).
    _tileColor(dir, color) {
        const { n, land } = this.basis.landAt(dir);
        if (n < this.basis.seaLevel) {
            color.set(this.palette[0]).multiplyScalar(0.55 + n * 0.6);
        } else {
            color.set(this.palette[1]).lerp(TMP_HIGH.set(this.palette[2]), THREE.MathUtils.smoothstep(land, 0.45, 1));
        }
        const lat = Math.abs(dir.y);
        const icing = THREE.MathUtils.smoothstep(lat, 0.78, 0.95) + (land > 0.82 ? 0.6 : 0);
        color.lerp(TMP_ICE, Math.min(0.85, icing));
        return color;
    }

    getStats() {
        return { leafCount: this.leaves.length, builtCount: this._builtCount };
    }

    dispose() {
        for (const root of this.roots) {
            if (root.children) this._collapse(root);
            this._disposeMesh(root);
        }
        this.group.clear();
    }
}

const TMP_HIGH = new THREE.Color();
const TMP_ICE = new THREE.Color('#dcecff');
