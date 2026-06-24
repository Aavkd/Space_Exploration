export const POST_FX_PRESETS = {
    desktopDefault: {
        bloom: {
            enabled: true,
            strength: 1.2,
            radius: 0.8,
            threshold: 0.1
        },
        warp: {
            enabled: true,
            debugSpeedFactor: 0,
            blurStrength: 0.04,
            blurSamples: 12,
            aberrationStrength: 0.00005,
            vignetteStrength: 0.4,
            streakIntensity: 0.015,
            distortion: 0
        },
        retro: {
            enabled: true,
            pixelSize: 4,
            colorDepth: 16,
            scanlineIntensity: 0.15,
            scanlineCount: 1.5,
            saturation: 0.5,
            contrast: 0.9,
            noiseIntensity: 0,
            vignetteStrength: 0.4,
            vignetteIntensity: 0.6,
            aberration: 0,
            brightness: -0.02,
            exposure: 3
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
        deepSpace: {
            starOpacity: 1,
            starBrightness: 2.4,
            starSize: 8,
            nebulaOpacity: 0.72,
            nebulaBrightness: 2.1,
            nebulaScale: 1.18,
            galaxyDensity: 1,
            blackHoleChance: 0.1,
            anomalyChance: 0.05,
            gravityScale: 1
        },
        vrComfort: {
            bloomMax: 0.8,
            // Desktop default is permissive (full warp). The VR-safe preset will
            // lower this; the F2 slider lets you preview a calmer warp now.
            warpMax: 1,
            rotationMode: 'snap',
            accelerationCap: 45
        },
        ship: {
            envMapIntensity: 0.85,
            glassOpacity: 0.15,
            // Dedicated hull brightness multiplier so the ship can read calmer /
            // less intense than the bloom-heavy environment around it. 1 = as
            // authored, <1 dims the hull, >1 brightens it.
            brightness: 1,
            // Dedicated ship glow multiplier (scales the hull's authored emissive
            // into the shared bloom), independent of the global Bloom group.
            bloom: 1
        }
    }
};
