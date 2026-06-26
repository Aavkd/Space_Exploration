import { AUDIO_PRESET } from '../config/audioPresets.js';
import { getAudioEntry } from './audioManifest.js';

const SPEED_REFERENCE = 60000;

export class AudioDirector {
    constructor({ audio, preset = AUDIO_PRESET } = {}) {
        this.audio = audio;
        this.preset = structuredClone(preset);
        this.started = false;
        this.elapsed = 0;
        this.prev = {
            hyperdriveEngaged: false,
            pilotActive: false,
            currentNodeName: null
        };
        this.hyperdriveRun = {
            lightSpeed50: false,
            lightSpeed80: false
        };
        this.cooldowns = new Map();
        this.lastPoiState = {};
        this._signalPingAt = 0;
    }

    update(dt, state = {}) {
        this.elapsed += dt;
        if (!this.audio.enabled || !this.audio.unlocked) return;

        if (!this.started) this._startBaseLayers(state);
        this._updateStateMix(dt, state);
        this._updatePilotSeat(state);
        this._updateHyperdrive(state);
        this._updateSector(state);
        this._updateAnomalies(state);
        this._updateBlackHoles(state);
        this.prev.hyperdriveEngaged = Boolean(state.hyperdriveEngaged);
        this.prev.pilotActive = Boolean(state.pilotActive);
        this.prev.currentNodeName = state.currentNode?.name ?? null;
    }

    getDebugState() {
        return {
            started: this.started,
            cooldowns: Object.fromEntries(this.cooldowns),
            hyperdriveRun: { ...this.hyperdriveRun },
            nearestAudioPois: this.lastPoiState
        };
    }

    _startBaseLayers(state) {
        this.started = true;
        this.audio.startLoop('spaceBedA', { gain: getGain('spaceBedA', 0.42), fadeSeconds: 2.4 });
        this.audio.startLoop('shipAmbient', { gain: getGain('shipAmbient', 0.36), fadeSeconds: 1.6 });
        this.audio.startLoop('shipInstrumentA', { gain: getGain('shipInstrumentA', 0.08), fadeSeconds: 2.2 });
        this.audio.startLoop('musicAmbient', { gain: getGain('musicAmbient', 0.045), fadeSeconds: 4 });
        if (state.playerState !== 'eva') {
            this.audio.startLoop('shipBridge', { gain: getGain('shipBridge', 0.08), fadeSeconds: 2.2 });
        }
    }

    _updateStateMix(dt, state) {
        const playerState = state.playerState ?? 'walking';
        const pilot = Boolean(state.pilotActive);
        const eva = playerState === 'eva';
        const speedFactor = clamp01((state.speed ?? 0) / SPEED_REFERENCE);
        const command = state.command ?? {};
        const thrusting = pilot && Math.abs(command.thrust ?? 0) > 0.2;
        const boosting = pilot && Boolean(command.boost);

        this.audio.startLoop('spaceBedA', { gain: 0.01, fadeSeconds: 1.2 });
        this.audio.startLoop('shipAmbient', { gain: 0.01, fadeSeconds: 1.2 });
        this.audio.startLoop('shipBridge', { gain: 0.01, fadeSeconds: 1.2 });
        this.audio.startLoop('shipInstrumentA', { gain: 0.01, fadeSeconds: 1.2 });
        this.audio.startLoop('shipAtSpeed', { gain: 0.01, fadeSeconds: 1 });
        this.audio.startLoop('musicAmbient', { gain: 0.01, fadeSeconds: 2 });

        const spaceGain = eva ? 0.48 : pilot ? 0.32 : 0.24;
        const shipGain = eva ? 0.09 : pilot ? 0.46 : 0.34;
        const bridgeGain = eva ? 0.02 : pilot ? 0.14 : 0.09;
        const instrumentGain = eva ? 0.02 : pilot ? 0.12 : 0.075;
        const speedGain = pilot || speedFactor > 0.02
            ? getGain('shipAtSpeed', 0.58) * (0.08 + speedFactor * 0.86)
            : 0.025;

        this.audio.setLoopGain('spaceBedA', getGain('spaceBedA', 0.72) * spaceGain, 0.65);
        this.audio.setLoopGain('shipAmbient', getGain('shipAmbient', 0.68) * shipGain, 0.55);
        this.audio.setLoopGain('shipBridge', getGain('shipBridge', 0.38) * bridgeGain, 0.65);
        this.audio.setLoopGain('shipInstrumentA', getGain('shipInstrumentA', 0.28) * instrumentGain, 0.75);
        this.audio.setLoopGain('shipAtSpeed', speedGain, 0.4);
        this.audio.setLoopPlaybackRate('shipAtSpeed', 0.82 + speedFactor * 0.48, 0.35);

        if (thrusting || boosting) {
            this.audio.startLoop('rocketFiring', {
                gain: getGain('rocketFiring', 0.48) * (boosting ? 0.7 : 0.36),
                playbackRate: boosting ? 1.16 : 0.92,
                fadeSeconds: 0.18
            });
        } else {
            this.audio.stopLoop('rocketFiring', { fadeSeconds: 0.25 });
        }

        let musicGain = (pilot ? 0.06 : 0.045) + speedFactor * 0.04;
        if (state.radioPower) {
            musicGain = 0; // Duck background music completely when radio is active
        }
        this.audio.setLoopGain('musicAmbient', getGain('musicAmbient', 0.42) * musicGain, 1.2);
    }

    _updatePilotSeat(state) {
        const pilotActive = Boolean(state.pilotActive);
        if (pilotActive && !this.prev.pilotActive) {
            this.audio.say(Math.random() < 0.7 ? 'systemOnline' : 'systemReady', {
                priority: 1,
                cooldown: 0
            });
        }

        if (!pilotActive && this.prev.pilotActive) {
            this.audio.say('disengage', {
                priority: 2,
                cooldown: 0
            });
        }
    }

    _updateHyperdrive(state) {
        const engaged = Boolean(state.hyperdriveEngaged);
        const level = clamp01(state.hyperdriveLevel ?? 0);
        const speed = state.speed ?? 0;
        const speed50 = this.preset.speedCallouts?.lightSpeed50 ?? 13000;
        const speed80 = this.preset.speedCallouts?.lightSpeed80 ?? 25000;

        if (engaged && !this.prev.hyperdriveEngaged) {
            this.hyperdriveRun.lightSpeed50 = false;
            this.hyperdriveRun.lightSpeed80 = false;
            this.audio.say('hyperdriveReady', { priority: 2 });
            this.audio.playCue('warpDistortion', { priority: 3 });
            this.audio.startLoop('warpSpeed', { gain: 0.08, fadeSeconds: 0.25 });
        }

        if (engaged || level > 0.01) {
            this.audio.startLoop('warpSpeed', { gain: 0.04, fadeSeconds: 0.2 });
            this.audio.setLoopGain('warpSpeed', getGain('warpSpeed', 0.78) * (0.12 + level * 0.76), 0.22);
            this.audio.setLoopPlaybackRate('warpSpeed', 0.78 + level * 0.62, 0.2);
        }

        if (engaged && speed >= speed50 && !this.hyperdriveRun.lightSpeed50) {
            this.hyperdriveRun.lightSpeed50 = true;
            this._sayWithCooldown('lightSpeed50', { priority: 2 });
        }

        if (engaged && speed >= speed80 && !this.hyperdriveRun.lightSpeed80) {
            this.hyperdriveRun.lightSpeed80 = true;
            this._sayWithCooldown('lightSpeed80', { priority: 2 });
        }

        if (!engaged && this.prev.hyperdriveEngaged) {
            this.audio.stopLoop('warpSpeed', { fadeSeconds: 0.75 });
        } else if (!engaged && level <= 0.01) {
            this.audio.stopLoop('warpSpeed', { fadeSeconds: 0.4 });
        }
    }

    _updateSector(state) {
        const name = state.currentNode?.name ?? null;
        if (!name || !this.prev.currentNodeName || name === this.prev.currentNodeName) return;
        this._sayWithCooldown('newZone', { priority: 1 });

        const ambienceId = selectSectorBed(state.currentNode?.theme);
        if (ambienceId !== 'spaceBedA') {
            this.audio.startLoop(ambienceId, { gain: getGain(ambienceId, 0.25) * 0.08, fadeSeconds: 2.4 });
            this.audio.setLoopGain(ambienceId, getGain(ambienceId, 0.25) * 0.14, 2.4);
        }
    }

    _updateAnomalies(state) {
        const anomaly = state.nearestAnomaly;
        const distance = anomaly?.distance ?? Infinity;
        const band = this.preset.distanceBands?.anomalySignal ?? 70000;
        const proximity = clamp01(1 - distance / band);
        this.lastPoiState.nearestAnomaly = summarizePoi(anomaly);

        if (proximity > 0) {
            this.audio.startLoop('longSignal', { gain: 0.02, fadeSeconds: 1.2 });
            this.audio.setLoopGain('longSignal', getGain('longSignal', 0.42) * (0.08 + proximity * 0.5), 0.8);
            this._sayWithCooldown(proximity > 0.5 ? 'anomalyDetected' : 'strangeSignal', {
                priority: proximity > 0.5 ? 3 : 2
            });

            if (this.elapsed - this._signalPingAt > 10 + Math.random() * 8) {
                this._signalPingAt = this.elapsed;
                this.audio.playCue(Math.random() < 0.5 ? 'signal4' : 'signal5', { priority: 2 });
            }
        } else {
            this.audio.stopLoop('longSignal', { fadeSeconds: 1.4 });
        }
    }

    _updateBlackHoles(state) {
        const blackHole = state.nearestBlackHole;
        const distance = blackHole?.distance ?? Infinity;
        const detection = this.preset.distanceBands?.blackHoleDetection ?? 130000;
        const warning = this.preset.distanceBands?.blackHoleWarning ?? 90000;
        const danger = this.preset.distanceBands?.blackHoleDanger ?? 35000;
        const proximity = clamp01(1 - distance / detection);
        const dangerPressure = clamp01(1 - distance / danger);
        this.lastPoiState.nearestBlackHole = summarizePoi(blackHole);

        if (proximity > 0) {
            this.audio.startLoop('blackHoleAccretion', { gain: 0.01, fadeSeconds: 1.2 });
            this.audio.setLoopGain('blackHoleAccretion', getGain('blackHoleAccretion', 0.72) * (0.05 + proximity * 0.72), 0.75);
        } else {
            this.audio.stopLoop('blackHoleAccretion', { fadeSeconds: 1.3 });
        }

        if (distance < warning) {
            this._sayWithCooldown('blackHoleDetected', { priority: 4 });
        }

        if (distance < danger) {
            this._sayWithCooldown('blackHoleClose', { priority: 5 });
            this.audio.startLoop('alarm', { gain: 0.02, fadeSeconds: 0.4 });
            this.audio.setLoopGain('alarm', getGain('alarm', 0.32) * (0.18 + dangerPressure * 0.52), 0.35);
        } else {
            this.audio.stopLoop('alarm', { fadeSeconds: 0.8 });
        }
    }

    _sayWithCooldown(eventId, options = {}) {
        const cooldown = this.preset.cooldowns?.[eventId] ?? 0;
        const last = this.cooldowns.get(eventId) ?? -Infinity;
        if (this.elapsed - last < cooldown) return false;
        const said = this.audio.say(eventId, { ...options, cooldown });
        if (said) this.cooldowns.set(eventId, this.elapsed);
        return said;
    }
}

function getGain(id, fallback) {
    return getAudioEntry(id)?.gain ?? fallback;
}

function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function selectSectorBed(theme = '') {
    const index = Math.abs(hashString(theme)) % 4;
    return ['spaceBedA', 'spaceBedB', 'spaceBedC', 'spaceBedD'][index];
}

function hashString(value) {
    let hash = 0;
    for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    return hash;
}

function summarizePoi(poi) {
    if (!poi) return null;
    return {
        type: poi.type,
        name: poi.name,
        distance: Math.round(poi.distance ?? Infinity)
    };
}
