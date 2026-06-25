import { BUS_NAMES } from './audioManifest.js';

export class AudioBus {
    constructor({ context, destination, defaults = {} }) {
        this.context = context;
        this.nodes = new Map();
        this.targets = new Map();

        for (const name of BUS_NAMES) {
            const gain = context.createGain();
            gain.gain.value = defaults[name] ?? 1;
            this.nodes.set(name, gain);
            this.targets.set(name, gain.gain.value);
        }

        this.get('master').connect(destination);
        for (const name of BUS_NAMES) {
            if (name !== 'master') this.get(name).connect(this.get('master'));
        }
    }

    get(name) {
        return this.nodes.get(name) ?? this.nodes.get('master');
    }

    setGain(name, value, rampSeconds = 0.08) {
        const node = this.get(name);
        if (!node) return false;

        const now = this.context.currentTime;
        const next = clampGain(value);
        const param = node.gain;
        param.cancelScheduledValues(now);
        param.setValueAtTime(param.value, now);
        param.linearRampToValueAtTime(next, now + Math.max(0.001, rampSeconds));
        this.targets.set(name, next);
        return true;
    }

    getGain(name) {
        return this.targets.get(name) ?? this.get(name)?.gain.value ?? 0;
    }

    getState() {
        return Object.fromEntries([...this.nodes.keys()].map((name) => [name, this.getGain(name)]));
    }
}

function clampGain(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(2, value));
}
