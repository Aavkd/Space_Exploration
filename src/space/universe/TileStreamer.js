// Time-sliced tile generation + bounded inactive-tile cache
// (docs/surface-eva-tier.md section 5).
//
// The quadtree still chooses desired LOD synchronously each frame, but geometry
// creation runs through this helper so a low-altitude pass can spread work over
// multiple frames. Tiles are keyed by face/depth/x/y and built by pure functions,
// so cache hits and generation order cannot change terrain contents.

const now = () => globalThis.performance?.now?.() ?? Date.now();

export class TileStreamer {
    constructor({ group, budgetMs = 2.0, maxCachedTiles = 384 } = {}) {
        this.group = group;
        this.budgetMs = budgetMs;
        this.maxCachedTiles = maxCachedTiles;

        this._queue = [];
        this._queued = new Map();
        this._cache = new Map();
        this._seq = 0;

        this._stats = {
            totalBuilt: 0,
            generatedLastFrame: 0,
            cacheHits: 0,
            cacheMisses: 0,
            evictions: 0
        };
    }

    get queueLength() {
        return this._queued.size;
    }

    get cacheSize() {
        return this._cache.size;
    }

    acquire(node, buildFn, priority = 0) {
        if (node.mesh) return true;

        const cached = this._cache.get(node.key);
        if (cached) {
            this._cache.delete(node.key);
            node.mesh = cached.mesh;
            // Restore the tile's surface-centre origin so the camera-relative
            // placement formula in QuadPlanetContents.update() stays correct.
            // Without this, re-acquired tiles render at the wrong world position.
            if (cached.origin) node.origin = cached.origin;
            node.mesh.visible = false;
            this.group.add(node.mesh);
            this._stats.cacheHits++;
            return true;
        }

        const queued = this._queued.get(node.key);
        if (queued) {
            queued.priority = Math.max(queued.priority, priority);
            return false;
        }

        const item = {
            key: node.key,
            node,
            buildFn,
            priority,
            seq: this._seq++
        };
        this._queue.push(item);
        this._queued.set(node.key, item);
        this._stats.cacheMisses++;
        return false;
    }

    buildNow(node, buildFn) {
        this.cancel(node.key);
        if (!node.mesh) {
            node.mesh = buildFn();
            node.mesh.visible = false;
            this.group.add(node.mesh);
            this._stats.totalBuilt++;
        }
        return node.mesh;
    }

    release(node) {
        if (!node.mesh) return;

        const mesh = node.mesh;
        node.mesh = null;
        mesh.visible = false;
        this.group.remove(mesh);

        // Persist the tile's surface-centre origin alongside the mesh so it
        // can be restored on a cache-hit (see acquire()). A tile without an
        // origin would be placed at the wrong world position after re-acquire.
        this._cache.set(node.key, { mesh, origin: node.origin ?? null });
        this._trimCache();
    }

    cancel(key) {
        const item = this._queued.get(key);
        if (!item) return;
        this._queued.delete(key);
        item.cancelled = true;
    }

    processBudget(budgetMs = this.budgetMs) {
        this._stats.generatedLastFrame = 0;
        if (budgetMs <= 0 || this._queue.length === 0) return 0;

        this._queue.sort((a, b) => (b.priority - a.priority) || (a.seq - b.seq));
        const started = now();
        let generated = 0;

        while (this._queue.length > 0) {
            if (generated > 0 && now() - started >= budgetMs) break;

            const item = this._queue.shift();
            this._queued.delete(item.key);
            if (item.cancelled || item.node.mesh) continue;

            item.node.mesh = item.buildFn();
            item.node.mesh.visible = false;
            this.group.add(item.node.mesh);
            this._stats.totalBuilt++;
            generated++;
        }

        this._stats.generatedLastFrame = generated;
        return generated;
    }

    getStats() {
        return {
            queueLength: this.queueLength,
            cacheSize: this.cacheSize,
            cacheLimit: this.maxCachedTiles,
            budgetMs: this.budgetMs,
            totalBuilt: this._stats.totalBuilt,
            generatedLastFrame: this._stats.generatedLastFrame,
            cacheHits: this._stats.cacheHits,
            cacheMisses: this._stats.cacheMisses,
            evictions: this._stats.evictions
        };
    }

    dispose() {
        this._queue.length = 0;
        this._queued.clear();
        for (const entry of this._cache.values()) {
            disposeTileMesh(entry.mesh);
        }
        this._cache.clear();
    }

    _trimCache() {
        while (this._cache.size > this.maxCachedTiles) {
            const oldestKey = this._cache.keys().next().value;
            const oldest = this._cache.get(oldestKey);
            this._cache.delete(oldestKey);
            disposeTileMesh(oldest.mesh);
            this._stats.evictions++;
        }
    }
}

function disposeTileMesh(mesh) {
    mesh.userData.disposeTile?.();
    mesh.geometry.dispose();
}
