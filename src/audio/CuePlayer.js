export class CuePlayer {
    constructor({ engine }) {
        this.engine = engine;
        this.cooldowns = new Map();
        this.instances = [];
    }

    async play(entry, options = {}) {
        if (!entry || !this.engine.canPlay()) return false;

        const now = this.engine.context.currentTime;
        const cooldown = options.cooldown ?? entry.cooldown ?? 0;
        const last = this.cooldowns.get(entry.id) ?? -Infinity;
        if (!options.force && now - last < cooldown) return false;

        this._prune();
        const maxInstances = options.maxInstances ?? entry.maxInstances ?? 4;
        const activeForCue = this.instances.filter((instance) => instance.id === entry.id);
        if (activeForCue.length >= maxInstances) {
            const priority = options.priority ?? entry.priority ?? 1;
            const weakest = activeForCue
                .slice()
                .sort((a, b) => a.priority - b.priority || a.startedAt - b.startedAt)[0];
            if (!weakest || weakest.priority > priority) return false;
            weakest.stop();
        }

        const buffer = await this.engine.loadBuffer(entry.path);
        if (!buffer || !this.engine.canPlay()) return false;

        const context = this.engine.context;
        const source = context.createBufferSource();
        const gainNode = context.createGain();
        const gainJitter = options.gainJitter ?? 0.06;
        const pitchJitter = options.pitchJitter ?? 0.035;
        const baseGain = options.gain ?? entry.gain ?? 1;
        source.buffer = buffer;
        source.loop = Boolean(options.loop ?? false);
        source.playbackRate.value = Math.max(0.25, Math.min(2, (options.playbackRate ?? 1) * randomAround(1, pitchJitter)));
        gainNode.gain.value = Math.max(0, baseGain * randomAround(1, gainJitter));

        source.connect(gainNode);
        gainNode.connect(this.engine.getBusInput(options.bus ?? entry.bus));

        const instance = {
            id: entry.id,
            priority: options.priority ?? entry.priority ?? 1,
            startedAt: now,
            stop: () => {
                try {
                    source.stop();
                } catch {}
            }
        };
        this.instances.push(instance);
        source.onended = () => {
            source.disconnect();
            gainNode.disconnect();
            this.instances = this.instances.filter((item) => item !== instance);
        };
        source.start();
        this.cooldowns.set(entry.id, now);
        return true;
    }

    stopAll() {
        for (const instance of this.instances.slice()) instance.stop();
        this.instances = [];
    }

    getActiveCount() {
        this._prune();
        return this.instances.length;
    }

    _prune() {
        this.instances = this.instances.filter(Boolean);
    }
}

function randomAround(center, amount) {
    if (!amount) return center;
    return center + (Math.random() * 2 - 1) * amount;
}
