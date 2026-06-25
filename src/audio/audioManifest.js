const ROOT = './assets/audio/';

export const BUS_NAMES = Object.freeze([
    'master',
    'music',
    'ambience',
    'ship',
    'engine',
    'voice',
    'alerts',
    'signals'
]);

export const AUDIO_MANIFEST = Object.freeze({
    musicAmbient: clip('musicAmbient', 'space/ambiant_music.mp3', 'music', 'music', true, {
        gain: 0.42,
        priority: 1,
        tags: ['music', 'bed']
    }),
    spaceBedA: clip('spaceBedA', 'space/ambiant_space.mp3', 'ambience', 'loop', true, {
        gain: 0.72,
        priority: 1,
        tags: ['space', 'base']
    }),
    spaceBedB: clip('spaceBedB', 'space/ambiant_space2.mp3', 'ambience', 'loop', true, {
        gain: 0.55,
        priority: 1,
        tags: ['space', 'alternate']
    }),
    spaceBedC: clip('spaceBedC', 'space/ambiant_space3.mp3', 'ambience', 'loop', true, {
        gain: 0.42,
        priority: 1,
        tags: ['space', 'rich']
    }),
    spaceBedD: clip('spaceBedD', 'space/ambiant_space4.mp3', 'ambience', 'loop', true, {
        gain: 0.48,
        priority: 1,
        tags: ['space', 'fallback']
    }),
    ambientTexture: clip('ambientTexture', 'space/ambiant_sound.mp3', 'ambience', 'oneShot', false, {
        gain: 0.45,
        cooldown: 12,
        priority: 1
    }),
    shipAmbient: clip('shipAmbient', 'space/ship_ambiant.mp3', 'ship', 'loop', true, {
        gain: 0.68,
        priority: 1,
        tags: ['cockpit', 'base']
    }),
    shipBridge: clip('shipBridge', 'space/ship_bridge.mp3', 'ship', 'loop', true, {
        gain: 0.38,
        priority: 1,
        tags: ['cockpit', 'bridge']
    }),
    shipInstrumentA: clip('shipInstrumentA', 'space/ship_instrument.mp3', 'ship', 'loop', true, {
        gain: 0.28,
        priority: 1,
        tags: ['cockpit', 'instrument']
    }),
    shipInstrumentB: clip('shipInstrumentB', 'space/ship_instrument2.mp3', 'ship', 'loop', true, {
        gain: 0.22,
        priority: 1,
        tags: ['cockpit', 'instrument']
    }),
    shipInstruments: clip('shipInstruments', 'space/ship_instruments.mp3', 'ship', 'loop', true, {
        gain: 0.18,
        priority: 1,
        tags: ['cockpit', 'busy']
    }),
    shipAtSpeed: clip('shipAtSpeed', 'space/ship_at_speed.mp3', 'engine', 'loop', true, {
        gain: 0.58,
        priority: 2,
        tags: ['drive', 'speed']
    }),
    rocketFiring: clip('rocketFiring', 'space/rocket_firing.mp3', 'engine', 'loop', true, {
        gain: 0.48,
        priority: 2,
        tags: ['drive', 'thrust']
    }),
    shipStartup: clip('shipStartup', 'space/ship_starting(thrusts).mp3', 'engine', 'oneShot', false, {
        gain: 0.72,
        priority: 2,
        cooldown: 4,
        maxInstances: 1
    }),
    warpSpeed: clip('warpSpeed', 'space/wrap_speed.mp3', 'engine', 'loop', true, {
        gain: 0.78,
        priority: 3,
        tags: ['hyperdrive']
    }),
    warpDistortion: clip('warpDistortion', 'space/wrap_distortion.mp3', 'engine', 'oneShot', false, {
        gain: 0.7,
        priority: 3,
        cooldown: 1.5,
        maxInstances: 1
    }),
    blackHoleAccretion: clip('blackHoleAccretion', 'space/blackhole_accretion.mp3', 'ambience', 'loop', true, {
        gain: 0.72,
        priority: 4,
        tags: ['blackhole']
    }),
    alarm: clip('alarm', 'space/Alarm.mp3', 'alerts', 'loop', true, {
        gain: 0.32,
        priority: 5,
        tags: ['warning']
    }),
    longSignal: clip('longSignal', 'space/long_signal.mp3', 'signals', 'loop', true, {
        gain: 0.42,
        priority: 2,
        tags: ['signal']
    }),
    signal2: clip('signal2', 'space/signal2.mp3', 'signals', 'loop', true, {
        gain: 0.28,
        priority: 2,
        tags: ['signal']
    }),
    signal3: clip('signal3', 'space/signal3.mp3', 'signals', 'loop', true, {
        gain: 0.24,
        priority: 2,
        tags: ['signal']
    }),
    signal4: clip('signal4', 'space/signal4.mp3', 'signals', 'oneShot', false, {
        gain: 0.36,
        priority: 2,
        cooldown: 8,
        maxInstances: 1
    }),
    signal5: clip('signal5', 'space/signal5.mp3', 'signals', 'oneShot', false, {
        gain: 0.34,
        priority: 2,
        cooldown: 8,
        maxInstances: 1
    }),
    spaceSynth: clip('spaceSynth', 'space/freesound_community-space-synth1-90446.mp3', 'signals', 'oneShot', false, {
        gain: 0.25,
        priority: 2,
        cooldown: 30,
        maxInstances: 1
    }),
    spaceChords: clip('spaceChords', 'space/idoberg-space-chords-loop-310493.mp3', 'music', 'music', true, {
        gain: 0.18,
        priority: 1,
        tags: ['music', 'color']
    })
});

export const SHIP_AI_MANIFEST = Object.freeze({
    systemOnline: voice('systemOnline', [
        'ShipAI/system online.mp3',
        'ShipAI/system online2.mp3',
        'ShipAI/system online3.mp3'
    ], { priority: 1, cooldown: 30 }),
    systemReady: voice('systemReady', ['ShipAI/system ready for your commands.mp3'], {
        priority: 1,
        cooldown: 30
    }),
    hyperdriveReady: voice('hyperdriveReady', ['ShipAI/hyperdrive ready.mp3'], {
        priority: 2,
        cooldown: 12
    }),
    lightSpeed50: voice('lightSpeed50', ['ShipAI/50% light speed.mp3'], {
        priority: 2,
        cooldown: 8
    }),
    lightSpeed80: voice('lightSpeed80', ['ShipAI/80% light speed.mp3'], {
        priority: 2,
        cooldown: 8
    }),
    alert: voice('alert', ['ShipAI/Alert.mp3'], {
        priority: 4,
        cooldown: 10
    }),
    anomalyDetected: voice('anomalyDetected', ['ShipAI/Anomaly Detected.mp3'], {
        priority: 3,
        cooldown: 60
    }),
    blackHoleDetected: voice('blackHoleDetected', ['ShipAI/Black Hole detected.mp3'], {
        priority: 4,
        cooldown: 90
    }),
    blackHoleClose: voice('blackHoleClose', ['ShipAI/close to the black hole.mp3'], {
        priority: 5,
        cooldown: 45
    }),
    disengage: voice('disengage', [
        'ShipAI/Disengage.mp3',
        'ShipAI/Disengage2.mp3',
        'ShipAI/disengage3.mp3',
        'ShipAI/disengage4.mp3'
    ], { priority: 2, cooldown: 8 }),
    newZone: voice('newZone', [
        'ShipAI/new_zone.mp3',
        'ShipAI/new_zone2.mp3',
        'ShipAI/new_zone3.mp3',
        'ShipAI/new_zone4.mp3'
    ], { priority: 1, cooldown: 45 }),
    strangeSignal: voice('strangeSignal', [
        'ShipAI/strange signal.mp3',
        'ShipAI/strange signal2.mp3',
        'ShipAI/strange signal3.mp3'
    ], { priority: 2, cooldown: 60 }),
    debugReadAloud: voice('debugReadAloud', ['ShipAI/read-aloud (19).mp3'], {
        priority: 1,
        cooldown: 0
    })
});

export function getAudioEntry(id) {
    return AUDIO_MANIFEST[id] ?? null;
}

export function getShipAiEntry(eventId) {
    return SHIP_AI_MANIFEST[eventId] ?? null;
}

function clip(id, path, bus, kind, loop, options = {}) {
    return Object.freeze({
        id,
        path: ROOT + path,
        bus,
        kind,
        loop,
        gain: options.gain ?? 1,
        priority: options.priority ?? 1,
        cooldown: options.cooldown ?? 0,
        maxInstances: options.maxInstances ?? 4,
        tags: Object.freeze(options.tags ?? [])
    });
}

function voice(id, paths, options = {}) {
    return Object.freeze({
        id,
        bus: 'voice',
        kind: 'voice',
        loop: false,
        gain: options.gain ?? 1,
        priority: options.priority ?? 1,
        cooldown: options.cooldown ?? 0,
        variants: Object.freeze(paths.map((path, index) => Object.freeze({
            id: `${id}:${index}`,
            path: ROOT + path
        })))
    });
}
