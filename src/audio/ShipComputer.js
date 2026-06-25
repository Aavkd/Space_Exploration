import { SHIP_AI_MANIFEST, getShipAiEntry } from './audioManifest.js';

export class ShipComputer {
    constructor({ engine, preset }) {
        this.engine = engine;
        this.preset = preset;
        this.queue = [];
        this.cooldowns = new Map();
        this.current = null;
        this.lastLine = null;
        this._variantCursor = new Map();
    }

    say(eventId, options = {}) {
        const entry = getShipAiEntry(eventId);
        if (!entry || !this.engine.canPlay()) return false;

        const now = this.engine.context.currentTime;
        const cooldown = options.cooldown ?? entry.cooldown ?? this.preset.cooldowns?.[eventId] ?? 0;
        const last = this.cooldowns.get(eventId) ?? -Infinity;
        if (!options.force && now - last < cooldown) return false;

        const item = {
            eventId,
            entry,
            priority: options.priority ?? entry.priority ?? 1,
            force: Boolean(options.force),
            enqueuedAt: now
        };

        if (this.current && item.priority > this.current.priority + 1) {
            this.current.stop?.();
        }

        this.queue.push(item);
        this.queue.sort((a, b) => b.priority - a.priority || a.enqueuedAt - b.enqueuedAt);
        this.cooldowns.set(eventId, now);
        this._drain();
        return true;
    }

    update() {
        if (!this.current) this._drain();
    }

    stopAll() {
        this.current?.stop?.();
        this.current = null;
        this.queue.length = 0;
    }

    getDebugState() {
        return {
            lastLine: this.lastLine,
            current: this.current
                ? { eventId: this.current.eventId, priority: this.current.priority }
                : null,
            pending: this.queue.map((item) => item.eventId),
            knownEvents: Object.keys(SHIP_AI_MANIFEST)
        };
    }

    async _drain() {
        if (this.current || this.queue.length === 0 || !this.engine.canPlay()) return;

        const item = this.queue.shift();
        const variant = this._chooseVariant(item.entry);
        const buffer = await this.engine.loadBuffer(variant.path);
        if (!buffer || !this.engine.canPlay()) {
            this.current = null;
            return;
        }

        const context = this.engine.context;
        const source = context.createBufferSource();
        const gainNode = context.createGain();
        source.buffer = buffer;
        gainNode.gain.value = item.entry.gain ?? 1;
        source.connect(gainNode);
        gainNode.connect(this.engine.getBusInput('voice'));

        const duckSeconds = Math.max(0.4, buffer.duration + (this.preset.ducking?.voiceRelease ?? 0.35));
        const amount = this.preset.ducking?.voiceAmount ?? 0.45;
        this.engine.duck('music', amount, duckSeconds);
        this.engine.duck('ambience', amount, duckSeconds);
        this.engine.duck('ship', Math.max(amount, 0.58), duckSeconds);

        const current = {
            eventId: item.eventId,
            priority: item.priority,
            stop: () => {
                try {
                    source.stop();
                } catch {}
            }
        };
        this.current = current;
        this.lastLine = {
            eventId: item.eventId,
            variant: variant.path,
            at: performance.now()
        };

        source.onended = () => {
            source.disconnect();
            gainNode.disconnect();
            if (this.current === current) this.current = null;
            this._drain();
        };
        source.start();
    }

    _chooseVariant(entry) {
        const variants = entry.variants;
        if (variants.length <= 1) return variants[0];

        const current = this._variantCursor.get(entry.id) ?? Math.floor(Math.random() * variants.length);
        const variant = variants[current % variants.length];
        this._variantCursor.set(entry.id, (current + 1) % variants.length);
        return variant;
    }
}
