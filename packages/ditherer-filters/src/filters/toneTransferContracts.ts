// Framework-free reference math for the photographic tone / light-transport
// filters (Solarize, Dodge/Burn, Atmospheric Haze), all pure and unit-tested.
// SOLARIZE_GLSL is the exact GLSL mirror of solarizeCurve used by solarizeGL.
// linearExposure documents the linear-light exposure the Dodge/Burn paths
// implement, and koschmiederTransmission / airlightComposite document the
// exponential airlight the Atmospheric Haze shader implements inline; the sRGB
// EOTF helpers are reused from opticalConvolutionContracts.

import { clamp01, linearToSrgb, srgbToLinear } from "./opticalConvolutionContracts";

const finite = (value: number, fallback = 0): number => (Number.isFinite(value) ? value : fallback);

const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / Math.max(1e-6, b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Smooth Sabattier (solarization) tone-reversal curve. Below the reversal point
 * the tone is unchanged; above it the tone folds back down toward zero, so the
 * curve rises to a hump at the reversal point and then reverses — the darkroom
 * re-exposure characteristic, not a knife-edge invert. `strength` blends from
 * identity (0) to full reversal (1). Applied per channel with the SAME curve,
 * so there is no independent per-channel flip.
 */
export const solarizeCurve = (t: number, reversal: number, strength: number): number => {
  const tc = clamp01(t);
  const r = Math.max(0.01, Math.min(0.99, finite(reversal, 0.5)));
  const reflected = Math.max(0, r - (tc - r) * (r / (1 - r)));
  const band = 0.5 * Math.min(r, 1 - r);
  const w = smoothstep(r - band, r + band, tc);
  const folded = tc + (reflected - tc) * w;
  return clamp01(tc + (folded - tc) * clamp01(strength));
};

/**
 * Koschmieder transmission t = e^(−β·depth) for a normalized depth 0..1. At
 * depth 0 (nearest) t = 1 (no haze); it falls off exponentially with depth.
 */
export const koschmiederTransmission = (depth: number, beta: number): number =>
  Math.exp(-Math.max(0, finite(beta)) * clamp01(depth));

/** Airlight composite in linear light: out = src·t + airlight·(1 − t). */
export const airlightComposite = (
  srcLinear: number,
  airLinear: number,
  transmission: number,
): number => {
  const t = clamp01(transmission);
  return clamp01(clamp01(srcLinear) * t + clamp01(airLinear) * (1 - t));
};

/**
 * Apply an exposure factor to an sRGB channel value in linear light: the
 * physically correct way to dodge (factor > 1) or burn (factor < 1). Returns an
 * sRGB value in 0..1.
 */
export const linearExposure = (srgbValue: number, factor: number): number =>
  linearToSrgb(clamp01(srgbToLinear(srgbValue) * Math.max(0, finite(factor, 1))));

// GLSL mirror of solarizeCurve (concatenate into a fragment shader).
export const SOLARIZE_GLSL = `
float tt_solarizeCurve(float t, float rev, float strength) {
  float tc = clamp(t, 0.0, 1.0);
  float r = clamp(rev, 0.01, 0.99);
  float reflected = max(0.0, r - (tc - r) * (r / (1.0 - r)));
  float band = 0.5 * min(r, 1.0 - r);
  float w = smoothstep(r - band, r + band, tc);
  float folded = mix(tc, reflected, w);
  return clamp(tc + (folded - tc) * clamp(strength, 0.0, 1.0), 0.0, 1.0);
}
`;
