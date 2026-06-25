export const AUDIO_PRESET = Object.freeze({
    enabled: true,
    autoplayShipAiGreeting: true,
    buses: {
        master: 1,
        music: 0.16,
        ambience: 0.28,
        ship: 0.42,
        engine: 0.45,
        voice: 0.9,
        alerts: 0.72,
        signals: 0.38
    },
    ducking: {
        voiceAmount: 0.45,
        voiceAttack: 0.08,
        voiceRelease: 0.35
    },
    cooldowns: {
        newZone: 45,
        strangeSignal: 60,
        anomalyDetected: 60,
        blackHoleDetected: 90,
        blackHoleClose: 45,
        lightSpeed50: 8,
        lightSpeed80: 8
    },
    distanceBands: {
        blackHoleDetection: 130000,
        blackHoleWarning: 90000,
        blackHoleDanger: 35000,
        anomalySignal: 70000,
        nebulaBlend: 120000
    },
    speedCallouts: {
        lightSpeed50: 13000,
        lightSpeed80: 25000
    }
});
