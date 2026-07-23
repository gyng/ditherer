// Shared, framework-free math for the optical-convolution stylizers
// (Despeckle, Sharpen, Bloom, Bokeh). Every function here is pure and
// unit-tested. The GLSL chunk mirrors the sRGB EOTF so the shaders can work in
// linear light without each re-pasting the transfer functions (there is no
// shared colour-space shader chunk elsewhere in the repo).

const finite = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? value : fallback;

export const clamp01 = (value: number): number =>
  Math.max(0, Math.min(1, finite(value)));

/** Gaussian sigma for a truncated kernel of the given pixel radius (r ≈ 3σ). */
export const sigmaForRadius = (radius: number): number =>
  Math.max(0.5, finite(radius, 1) / 3);

/** Single Gaussian weight exp(-k²/2σ²) (un-normalised). */
export const gaussianWeight = (k: number, sigma: number): number => {
  const s = Math.max(1e-3, finite(sigma, 1));
  return Math.exp(-(k * k) / (2 * s * s));
};

/**
 * Normalised 1-D Gaussian kernel over taps [-radius, radius]. Sums to 1, is
 * symmetric, and (for σ>0) decreases away from the centre — the separable
 * low-pass that defines a Gaussian blur and, by difference, the unsharp mask.
 */
export const gaussianKernel1D = (radius: number, sigma?: number): number[] => {
  const r = Math.max(0, Math.round(finite(radius, 1)));
  const s = sigma === undefined ? sigmaForRadius(r) : Math.max(1e-3, finite(sigma, 1));
  const weights: number[] = [];
  let total = 0;
  for (let k = -r; k <= r; k++) {
    const w = gaussianWeight(k, s);
    weights.push(w);
    total += w;
  }
  return weights.map((w) => w / total);
};

/** Median of a numeric list (mid element of the sorted copy). */
export const channelMedian = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Edge-preserving despeckle pick: replace the centre value with the window
 * median only when it deviates from the median by more than `threshold`
 * (an impulse); otherwise keep it, so edges and detail survive.
 */
export const thresholdedMedianPick = (
  center: number,
  median: number,
  threshold: number,
): number =>
  Math.abs(finite(center) - finite(median)) > Math.max(0, finite(threshold))
    ? finite(median)
    : finite(center);

/**
 * Linear-light bright-pass response: energy above the threshold, soft-kneed so
 * the transition is not a hard step. Inputs and output are linear 0..1.
 */
export const brightPassLinear = (linearLuma: number, threshold: number): number => {
  const t = clamp01(threshold);
  const l = clamp01(linearLuma);
  if (l <= t) return 0;
  return t >= 1 ? 0 : (l - t) / (1 - t);
};

// sRGB EOTF (scalar TS mirror of the GLSL below), for tests and JS paths.
export const srgbToLinear = (c: number): number => {
  const v = clamp01(c);
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

export const linearToSrgb = (c: number): number => {
  const v = clamp01(c);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
};

// Shared GLSL: sRGB <-> linear light. Concatenate into a fragment shader.
export const SRGB_GLSL = `
vec3 oc_srgbToLinear(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(lo, hi, step(vec3(0.04045), c));
}
vec3 oc_linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}
`;
