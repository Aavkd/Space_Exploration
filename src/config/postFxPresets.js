const desktopDefault = {
    bloom: {
        enabled: true,
        strength: 0.44,
        radius: 0.82,
        threshold: 0.05,
        // XR-only multipliers so the headset bloom can be nudged relative to
        // desktop without breaking the shared visual language. 1 = parity.
        xrStrengthScale: 1,
        xrRadiusScale: 1
    },
    warp: {
        enabled: true,
        debugOverrideEnabled: false,
        debugSpeedFactor: 0.77,
        blurStrength: 0.144,
        blurSamples: 6,
        aberrationStrength: 0.00495,
        vignetteStrength: 0.4,
        streakIntensity: 0.015,
        distortion: 0.04,
        // Phase 08: overall speed-FX intensity (warp factor, distortion, FOV,
        // speed lines). `speedFxScale` applies while piloting; `speedFxOnFootScale`
        // applies when nobody is at the controls (walking the ship / EVA) so the
        // drift FX read calmer on foot. Eased between the two on take/leave.
        speedFxScale: 0.71,
        speedFxOnFootScale: 0.68
    },
    relativisticStars: {
        enabled: true,
        intensity: 0.15,
        maxBeta: 0.82,
        debugOverrideEnabled: false,
        debugBeta: 0
    },
    retro: {
        enabled: true,
        pixelSize: 3,
        colorDepth: 8,
        scanlineIntensity: 0.64,
        scanlineCount: 1.5,
        saturation: 0.59,
        contrast: 0.89,
        noiseIntensity: 0.03,
        vignetteStrength: 0.4,
        vignetteIntensity: 0.6,
        aberration: 0,
        brightness: -0.13,
        exposure: 4
    },
    autoExposure: {
        enabled: true,
        targetLuminance: 0.02,
        minExposureScale: 0.27,
        maxExposureScale: 3,
        adaptationUpSeconds: 1.15,
        adaptationDownSeconds: 0.55,
        vrAdaptationUpSeconds: 1.65,
        vrAdaptationDownSeconds: 0.95,
        meteringMinLog: -7,
        meteringMaxLog: 3
    },
    ascii: {
        enabled: false,
        zoom: 1,
        fontCharCount: 10,
        colorChar: false,
        invert: false,
        fillColor: '#ffffff',
        backgroundColor: '#000000'
    },
    halftone: {
        enabled: false,
        dotSize: 1,
        angle: 45,
        scale: 1
    },
    vrComfort: {
        bloomMax: 0.8,
        warpMax: 1,
        rotationMode: 'snap',
        snapAngleDeg: 30,
        smoothTurnRateDeg: 45,
        walkSpeed: 3.2,
        accelerationCap: 45,
        comfortVignetteEnabled: false,
        comfortVignetteStrength: 0.18,
        speedLinesMaxOpacity: 0.38,
        legacyComposerPostFxDisabled: true,
        controllerSpheresVisible: true,
        vrUserScale: 0.55,
        // Phase 08 extreme-speed cues (capped). Desktop widens FOV + distorts;
        // VR cannot widen FOV (device-supplied projection) so it gets a small,
        // conservative distortion cap that can be dialed to 0 for diegetic-only.
        fovBoostMaxDesktop: 40,
        warpDistortionMaxDesktop: 0.6,
        warpDistortionMaxVR: 0.25
    },
    // Phase 08 hyperdrive gear. PRECISION is the unscaled baseline; these values
    // describe the HYPERDRIVE end of the spool and its FX recalibration.
    hyperdrive: {
        enabled: true,
        hyperForwardMult: 300, // forwardForce multiplier at full spool
        accelCap: 10500, // accelerationCap eases up to this at full spool
        safetyClamp: 340000, // top-speed guard when the design clamp lifts
        angularScale: 0.66, // angular authority reduced by (1 - this*level)
        engageTime: 0.9, // spool-up time constant (s)
        disengageTime: 0.5, // spool-down time constant (s)
        warpRefPrecision: 1500, // speed mapped to full warp in PRECISION
        warpRefHyper: 20000, // speed mapped to full warp at full spool (~600*mult^0.7)
        fovStart: 8000, // m/s where FOV/distortion cues begin
        fovMax: 60000 // m/s where FOV/distortion cues saturate
    },
    // Phase 06: the real XR post-FX backend. This is the VR visual feature.
    xrPostFx: {
        enabled: true,
        backend: 'custom',          // 'custom' implemented; 'library' has no shipped WebXR
        quality: 'high',            // 'low' | 'medium' | 'high' -> bloom blur iterations
        performanceBudgetMs: 11,
        failHardOnError: true,      // fail visibly during this feature work
        foveation: 0,               // 0 = full res edges (crisp retro), 1 = max foveation
        sceneSamples: 0,            // MSAA on the scene capture; 0 keeps pixels crisp
        previewOnDesktop: false     // run the XR combined shader on the desktop canvas for A/B
    },
    // Retired surrogate overlay/halo system from the earlier prototype. Kept for
    // config compatibility but disabled: the real XRPostFxPipeline replaces it.
    xrVisualFx: {
        enabled: false,
        previewOnDesktop: false,
        realPostFxEnabled: false,
        bloomSurrogateEnabled: false,
        warpEnabled: false,
        framebufferScale: 1,
        sceneGlow: 1,
        shipGlow: 1,
        starGlow: 1,
        nebulaGlow: 1,
        landmarkGlow: 1
    },
    ship: {
        envMapIntensity: 0.79,
        glassOpacity: 0.02,
        brightness: 1.23,
        bloom: 0.25
    }
};

// Full desktop visual identity in the headset. Bloom/warp/retro values are kept
// identical to desktop on purpose: parity is the product goal. Only movement
// comfort + the XR backend differ.
const vrVisualDefault = cloneConfig(desktopDefault);
Object.assign(vrVisualDefault.vrComfort, {
    rotationMode: 'snap',
    snapAngleDeg: 30,
    walkSpeed: 2.4,
    accelerationCap: 28,
    vrUserScale: 0.55
});
vrVisualDefault.xrPostFx.enabled = true;
vrVisualDefault.xrPostFx.quality = 'high';

// Movement comfort only. Must NOT remove the visual identity, so bloom/retro
// stay at parity; only locomotion + warp ceiling soften.
const vrComfort = cloneConfig(vrVisualDefault);
Object.assign(vrComfort.vrComfort, {
    warpMax: 0.6,
    walkSpeed: 1.4,
    accelerationCap: 18,
    comfortVignetteEnabled: true,
    comfortVignetteStrength: 0.16,
    smoothTurnRateDeg: 45
});

// Future optimization preset only (after parity is proven). Lowers the XR
// backend cost; visuals are intentionally reduced, not removed.
const vrPerformanceLow = cloneConfig(vrVisualDefault);
vrPerformanceLow.xrPostFx.quality = 'low';
vrPerformanceLow.xrPostFx.foveation = 0.3;
vrPerformanceLow.bloom.xrStrengthScale = 0.85;
vrPerformanceLow.bloom.xrRadiusScale = 0.7;
Object.assign(vrPerformanceLow.vrComfort, { warpMax: 0.6 });

export const POST_FX_PRESETS = {
    desktopDefault,
    vrVisualDefault,
    vrComfort,
    vrPerformanceLow,
    // Back-compat alias for the old name.
    vrSafe: vrComfort
};

export const POST_FX_PRESET_NAMES = Object.freeze({
    desktopDefault: 'desktop_default',
    vrVisualDefault: 'vr_visual_default',
    vrComfort: 'vr_comfort',
    vrPerformanceLow: 'vr_performance_low',
    vrSafe: 'vr_comfort'
});

const NAME_TO_KEY = {
    desktop_default: 'desktopDefault',
    desktopDefault: 'desktopDefault',
    vr_visual_default: 'vrVisualDefault',
    vrVisualDefault: 'vrVisualDefault',
    vr_comfort: 'vrComfort',
    vrComfort: 'vrComfort',
    vr_performance_low: 'vrPerformanceLow',
    vrPerformanceLow: 'vrPerformanceLow',
    vr_safe: 'vrComfort',
    vrSafe: 'vrComfort'
};

export function resolvePostFxPresetName(name) {
    return NAME_TO_KEY[name] ?? null;
}

function cloneConfig(value) {
    return JSON.parse(JSON.stringify(value));
}
