export class LoopLayer {
    constructor({ engine, entry }) {
        this.engine = engine;
        this.entry = entry;
        this.source = null;
        this.gainNode = null;
        this.started = false;
        this.starting = false;
        this.stopping = false;
        this.targetGain = 0;
        this.playbackRate = 1;
        this._token = 0;
    }

    async start(options = {}) {
        if (this.started || this.starting) {
            this.setGain(options.gain ?? this.targetGain, options.fadeSeconds ?? 0.2);
            this.setPlaybackRate(options.playbackRate ?? this.playbackRate);
            return this;
        }

        this.starting = true;
        this.stopping = false;
        const token = ++this._token;
        const buffer = await this.engine.loadBuffer(this.entry.path);
        if (!buffer || token !== this._token || !this.engine.enabled) {
            this.starting = false;
            return this;
        }

        const context = this.engine.context;
        const source = context.createBufferSource();
        const gainNode = context.createGain();
        source.buffer = buffer;
        source.loop = true;
        source.playbackRate.value = options.playbackRate ?? this.playbackRate;
        gainNode.gain.value = 0;
        source.connect(gainNode);
        gainNode.connect(this.engine.getBusInput(this.entry.bus));

        this.source = source;
        this.gainNode = gainNode;
        this.started = true;
        this.starting = false;
        this.targetGain = options.gain ?? this.entry.gain;
        this.playbackRate = source.playbackRate.value;

        source.onended = () => {
            if (this.source === source) this._clearNodes();
        };

        const randomOffset = options.randomOffset ?? true;
        const offset = randomOffset && buffer.duration > 1
            ? Math.random() * Math.max(0, buffer.duration - 0.05)
            : 0;
        source.start(0, offset);
        this.setGain(this.targetGain, options.fadeSeconds ?? 0.8);
        return this;
    }

    stop(options = {}) {
        ++this._token;
        if (!this.source || !this.gainNode) {
            this._clearNodes();
            return;
        }

        const source = this.source;
        const fadeSeconds = options.fadeSeconds ?? 0.5;
        const now = this.engine.context.currentTime;
        this.stopping = true;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
        this.gainNode.gain.linearRampToValueAtTime(0, now + Math.max(0.001, fadeSeconds));
        window.setTimeout(() => {
            try {
                source.stop();
            } catch {
                this._clearNodes();
            }
        }, Math.max(20, fadeSeconds * 1000 + 30));
    }

    setGain(value, rampSeconds = 0.15) {
        this.targetGain = clampGain(value);
        if (!this.gainNode) return;

        const now = this.engine.context.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
        this.gainNode.gain.linearRampToValueAtTime(this.targetGain, now + Math.max(0.001, rampSeconds));
    }

    setPlaybackRate(value, rampSeconds = 0.12) {
        this.playbackRate = Number.isFinite(value) ? Math.max(0.25, Math.min(2.5, value)) : 1;
        if (!this.source) return;

        const now = this.engine.context.currentTime;
        this.source.playbackRate.cancelScheduledValues(now);
        this.source.playbackRate.setValueAtTime(this.source.playbackRate.value, now);
        this.source.playbackRate.linearRampToValueAtTime(this.playbackRate, now + Math.max(0.001, rampSeconds));
    }

    getDebugState() {
        return {
            id: this.entry.id,
            bus: this.entry.bus,
            active: this.started,
            starting: this.starting,
            stopping: this.stopping,
            gain: this.targetGain,
            playbackRate: this.playbackRate
        };
    }

    _clearNodes() {
        this.source?.disconnect();
        this.gainNode?.disconnect();
        this.source = null;
        this.gainNode = null;
        this.started = false;
        this.starting = false;
        this.stopping = false;
    }
}

function clampGain(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1.5, value));
}
