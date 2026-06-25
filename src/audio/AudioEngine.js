import * as THREE from 'three';
import { AUDIO_PRESET } from '../config/audioPresets.js';
import { AUDIO_MANIFEST, getAudioEntry } from './audioManifest.js';
import { AudioBus } from './AudioBus.js';
import { CuePlayer } from './CuePlayer.js';
import { LoopLayer } from './LoopLayer.js';
import { ShipComputer } from './ShipComputer.js';

export class AudioEngine {
    constructor({ camera, preset = AUDIO_PRESET } = {}) {
        this.preset = structuredClone(preset);
        this.enabled = Boolean(this.preset.enabled);
        this.listener = new THREE.AudioListener();
        this.context = this.listener.context;
        this.unlocked = this.context.state === 'running';
        this.buffers = new Map();
        this.loading = new Map();
        this.missingAssets = new Set();
        this.warnedAssets = new Set();
        this.loops = new Map();
        this.ducks = new Map();

        if (camera) camera.add(this.listener);
        this.bus = new AudioBus({
            context: this.context,
            destination: this.listener.getInput(),
            defaults: this.preset.buses
        });
        this.cues = new CuePlayer({ engine: this });
        this.shipComputer = new ShipComputer({ engine: this, preset: this.preset });
    }

    async resumeFromUserGesture() {
        if (!this.enabled) return false;
        try {
            if (this.context.state !== 'running') await this.context.resume();
            this.unlocked = this.context.state === 'running';
            return this.unlocked;
        } catch (error) {
            console.warn('Audio unlock failed', error);
            return false;
        }
    }

    update() {
        this.unlocked = this.context.state === 'running';
        this.shipComputer.update();
    }

    canPlay() {
        return this.enabled && this.unlocked && this.context.state === 'running';
    }

    async loadBuffer(path) {
        if (this.buffers.has(path)) return this.buffers.get(path);
        if (this.missingAssets.has(path)) return null;
        if (this.loading.has(path)) return this.loading.get(path);

        const pending = fetch(path)
            .then((response) => {
                if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
                return response.arrayBuffer();
            })
            .then((bytes) => this.context.decodeAudioData(bytes))
            .then((buffer) => {
                this.buffers.set(path, buffer);
                this.loading.delete(path);
                return buffer;
            })
            .catch((error) => {
                this.loading.delete(path);
                this.missingAssets.add(path);
                if (!this.warnedAssets.has(path)) {
                    this.warnedAssets.add(path);
                    console.warn(`Audio asset unavailable: ${path}`, error);
                }
                return null;
            });

        this.loading.set(path, pending);
        return pending;
    }

    playCue(id, options = {}) {
        const entry = getAudioEntry(id);
        if (!entry) {
            console.warn(`Unknown audio cue: ${id}`);
            return false;
        }
        return this.cues.play(entry, options);
    }

    startLoop(id, options = {}) {
        const entry = getAudioEntry(id);
        if (!entry) {
            console.warn(`Unknown audio loop: ${id}`);
            return false;
        }

        let layer = this.loops.get(id);
        if (!layer) {
            layer = new LoopLayer({ engine: this, entry });
            this.loops.set(id, layer);
        }
        layer.start(options);
        return layer;
    }

    stopLoop(id, options = {}) {
        const layer = this.loops.get(id);
        if (!layer) return false;
        layer.stop(options);
        return true;
    }

    setLoopGain(id, value, rampSeconds = 0.15) {
        const layer = this.loops.get(id);
        if (!layer) return false;
        layer.setGain(value, rampSeconds);
        return true;
    }

    setLoopPlaybackRate(id, value, rampSeconds = 0.12) {
        const layer = this.loops.get(id);
        if (!layer) return false;
        layer.setPlaybackRate(value, rampSeconds);
        return true;
    }

    setBusGain(name, value, rampSeconds = 0.12) {
        if (name in this.preset.buses) this.preset.buses[name] = value;
        return this.bus.setGain(name, value, rampSeconds);
    }

    duck(busName, amount = 0.5, seconds = 0.7) {
        const base = this.preset.buses[busName] ?? this.bus.getGain(busName);
        const timer = this.ducks.get(busName);
        if (timer) window.clearTimeout(timer);

        this.bus.setGain(busName, base * Math.max(0, Math.min(1, amount)), this.preset.ducking?.voiceAttack ?? 0.08);
        this.ducks.set(busName, window.setTimeout(() => {
            this.bus.setGain(busName, base, this.preset.ducking?.voiceRelease ?? 0.35);
            this.ducks.delete(busName);
        }, Math.max(40, seconds * 1000)));
    }

    say(eventId, options = {}) {
        return this.shipComputer.say(eventId, options);
    }

    setEnabled(enabled) {
        this.enabled = Boolean(enabled);
        if (!this.enabled) this.stopAllAudio({ fadeSeconds: 0.25 });
        return this.enabled;
    }

    stopAllAudio({ fadeSeconds = 0.25 } = {}) {
        for (const layer of this.loops.values()) layer.stop({ fadeSeconds });
        this.cues.stopAll();
        this.shipComputer.stopAll();
    }

    getBusInput(name) {
        return this.bus.get(name);
    }

    getDebugState(extra = {}) {
        return {
            enabled: this.enabled,
            unlocked: this.unlocked,
            contextState: this.context.state,
            loadedBufferCount: this.buffers.size,
            loadingBufferCount: this.loading.size,
            missingAssets: [...this.missingAssets],
            activeLoops: [...this.loops.values()]
                .map((layer) => layer.getDebugState())
                .filter((state) => state.active || state.starting || state.stopping),
            activeOneShots: this.cues.getActiveCount(),
            busGains: this.bus.getState(),
            lastShipAiLine: this.shipComputer.getDebugState().lastLine,
            pendingShipAiQueue: this.shipComputer.getDebugState().pending,
            manifestIds: Object.keys(AUDIO_MANIFEST),
            ...extra
        };
    }
}
