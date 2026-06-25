import * as THREE from 'three';

// Physically-based star color & luminosity (roadmap Part 1).
//
// Real star fields read as real because of two correlations the old discrete
// 4-entry palette broke: a star's *hue* and its *luminosity* both follow from
// its surface temperature. Cool red dwarfs are overwhelmingly common and faint;
// hot blue giants are rare, intrinsically brighter, and have a larger halo.
// This module centralises that physics so StarField (and any future approachable
// star body) samples the same ramp.

const TEMP_MIN = 2400;   // deep red M-dwarf floor
const TEMP_MAX = 30000;  // blue-white O/B ceiling

const _scratch = new THREE.Color();

/**
 * Blackbody temperature (Kelvin) -> normalised linear-ish RGB color.
 *
 * Uses the well-known Tanner Helland approximation, then normalises so the
 * brightest channel is 1.0. Normalising decouples hue from brightness: the
 * color carries only the *tint*, while luminosity is applied separately via the
 * per-star brightness term. `target` is written in place and returned.
 */
export function blackbody(tempK, target = _scratch) {
    const t = THREE.MathUtils.clamp(tempK, 1000, 40000) / 100;

    let r, g, b;

    // Red
    if (t <= 66) {
        r = 255;
    } else {
        r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    }

    // Green
    if (t <= 66) {
        g = 99.4708025861 * Math.log(t) - 161.1195681661;
    } else {
        g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    }

    // Blue
    if (t >= 66) {
        b = 255;
    } else if (t <= 19) {
        b = 0;
    } else {
        b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    }

    r = THREE.MathUtils.clamp(r, 0, 255) / 255;
    g = THREE.MathUtils.clamp(g, 0, 255) / 255;
    b = THREE.MathUtils.clamp(b, 0, 255) / 255;

    // Normalise to the brightest channel so the tint survives but luminosity is
    // controlled elsewhere (additive blending stays well-behaved this way).
    const peak = Math.max(r, g, b, 1e-4);
    target.setRGB(r / peak, g / peak, b / peak);
    return target;
}

/**
 * Sample a surface temperature (Kelvin) for one star.
 *
 * The distribution is heavily skewed toward cool stars to mimic a stellar
 * luminosity/initial-mass function: most stars are red/orange, a minority are
 * sun-like, and hot blue stars are rare. `bias` (0..1, from
 * `config.stars.temperatureBias`) shifts the whole population cooler as it
 * rises, preserving the old knob's meaning (higher = redder field).
 */
export function sampleStarTemperature(rng, bias = 0.5) {
    const b = THREE.MathUtils.clamp(bias, 0, 1);
    // Larger exponent pushes the sample toward 0 (cool). Bias raises it further.
    const skew = 2.2 + b * 4.0;
    const u = Math.pow(rng(), skew);
    return TEMP_MIN + u * (TEMP_MAX - TEMP_MIN);
}

/** Normalised position of a temperature within the ramp, in [0, 1]. */
export function temperatureNorm(tempK) {
    return THREE.MathUtils.clamp((tempK - TEMP_MIN) / (TEMP_MAX - TEMP_MIN), 0, 1);
}

/**
 * Per-star relative luminosity, coupled to temperature so hot = bright (and,
 * because point size keys off this term, hot = big). A multiplicative scatter
 * keeps stars of similar temperature from looking stamped from one mould.
 *
 * Returns roughly [0.25 .. 2.8]: the upper tail (rare hot stars) crosses the
 * diffraction-spike / hero-light thresholds in StarField, so the rare ones also
 * glint and cast light.
 */
export function sampleLuminosity(rng, tempK) {
    const tNorm = temperatureNorm(tempK);
    const base = 0.3 + Math.pow(tNorm, 1.6) * 2.0;
    const scatter = 0.78 + rng() * 0.5;
    return base * scatter;
}

export { TEMP_MIN, TEMP_MAX };
