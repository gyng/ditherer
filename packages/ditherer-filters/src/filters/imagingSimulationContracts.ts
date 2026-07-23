const finite = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? value : fallback;

const clamp01 = (value: number): number =>
  Math.max(0, Math.min(1, finite(value)));

/** Bounded visible-luminance response used as an image-intensifier proxy. */
export const nightVisionIntensifierResponse = (
  luminance: number,
  gain: number,
): number => {
  const signal = clamp01(luminance);
  const multiplier = Math.max(1, Math.min(8, finite(gain, 1)));
  return clamp01(1 - Math.exp(-signal * multiplier));
};

/** Absolute noise amplitude: equivalent-background floor plus shot noise. */
export const nightVisionNoiseAmplitude = (
  amplifiedSignal: number,
  grain: number,
): number => {
  const amount = clamp01(grain);
  const signal = clamp01(amplifiedSignal);
  return Math.min(0.25, amount * (0.018 + 0.19 * Math.sqrt(signal)));
};

/**
 * Visible-luminance proxy for diffuse tissue backscatter plus impedance
 * discontinuities. Axial change carries more weight than lateral change.
 */
export const ultrasoundBackscatter = (
  center: number,
  axialBefore: number,
  axialAfter: number,
  lateralBefore: number,
  lateralAfter: number,
): number => {
  const c = clamp01(center);
  const axial = Math.abs(clamp01(axialAfter) - clamp01(axialBefore));
  const lateral = Math.abs(clamp01(lateralAfter) - clamp01(lateralBefore));
  const localMismatch = Math.abs(c - (
    clamp01(axialBefore) + clamp01(axialAfter)
      + clamp01(lateralBefore) + clamp01(lateralAfter)
  ) * 0.25);
  return clamp01(0.025 + axial * 0.72 + lateral * 0.18 + localMismatch * 0.2);
};

/** Round-trip propagation transmission for a normalized B-mode depth. */
export const ultrasoundDepthTransmission = (depth: number): number =>
  Math.exp(-1.15 * clamp01(depth));

/** Unit-mean Rayleigh envelope from a uniform variate, bounded for rendering. */
export const ultrasoundRayleighEnvelope = (
  uniform: number,
  mix = 1,
): number => {
  const u = Math.max(1e-6, Math.min(1 - 1e-6, finite(uniform, 0.5)));
  const rayleigh = Math.min(3, Math.sqrt(-2 * Math.log(1 - u)) / Math.sqrt(Math.PI / 2));
  return Math.max(0, Math.min(3, 1 + (rayleigh - 1) * clamp01(mix)));
};
