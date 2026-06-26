export class GameClock {
    constructor({ now = defaultMonotonicNow, initialGameTime = 0 } = {}) {
        this.now = now;
        this.gameTime = sanitizeGameTime(initialGameTime);
        this.active = false;
        this.lastSample = null;
    }

    setActive(active) {
        const next = Boolean(active);
        if (next === this.active) return this.gameTime;
        this.active = next;
        this.lastSample = next ? this._sample() : null;
        return this.gameTime;
    }

    update(active = this.active) {
        this.setActive(active);
        if (!this.active) return this.gameTime;

        const sample = this._sample();
        const elapsed = Math.max(0, sample - this.lastSample);
        this.lastSample = sample;
        this.gameTime += elapsed / 1000;
        return this.gameTime;
    }

    restore(gameTime) {
        this.gameTime = sanitizeGameTime(gameTime);
        this.lastSample = this.active ? this._sample() : null;
        return this.gameTime;
    }

    getTime() {
        return this.gameTime;
    }

    _sample() {
        const value = Number(this.now());
        if (!Number.isFinite(value)) throw new Error('Game clock source must return a finite monotonic value.');
        return value;
    }
}

export function sanitizeGameTime(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
}

function defaultMonotonicNow() {
    return globalThis.performance?.now?.() ?? Date.now();
}
