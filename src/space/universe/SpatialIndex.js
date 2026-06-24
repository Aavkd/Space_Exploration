import * as THREE from 'three';

export class SpatialIndex {
    constructor({ cellSize = 50000 } = {}) {
        this.cellSize = cellSize;
        this.items = [];
        this.cells = new Map();
    }

    build(items) {
        this.items = items.slice();
        this.cells.clear();
        for (const item of this.items) {
            const key = this._keyFor(item.position);
            if (!this.cells.has(key)) this.cells.set(key, []);
            this.cells.get(key).push(item);
        }
        return this;
    }

    nearest(position, { radius = Infinity, limit = 12, filter = null } = {}) {
        const result = [];
        const radiusSq = radius * radius;
        for (const item of this.items) {
            if (filter && !filter(item)) continue;
            const distanceSq = position.distanceToSquared(item.position);
            if (distanceSq <= radiusSq) result.push({ item, distanceSq });
        }
        result.sort((a, b) => a.distanceSq - b.distanceSq);
        return result.slice(0, limit).map(({ item, distanceSq }) => ({
            ...item,
            distance: Math.sqrt(distanceSq)
        }));
    }

    within(position, radius, filter = null) {
        return this.nearest(position, { radius, limit: Number.MAX_SAFE_INTEGER, filter });
    }

    _keyFor(position) {
        const v = new THREE.Vector3(
            Math.floor(position.x / this.cellSize),
            Math.floor(position.y / this.cellSize),
            Math.floor(position.z / this.cellSize)
        );
        return `${v.x}:${v.y}:${v.z}`;
    }
}
