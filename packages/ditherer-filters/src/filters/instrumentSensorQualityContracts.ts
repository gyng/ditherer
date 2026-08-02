const finite = (value: number, fallback = 0): number => (Number.isFinite(value) ? value : fallback);

const clamp01 = (value: number): number => Math.max(0, Math.min(1, finite(value)));

/** Map normalized signal amplitude to a top-row-first display coordinate. */
export const oscilloscopeVoltageRow = (voltage: number, height: number): number => {
  const safeHeight = Math.max(1, Math.round(finite(height, 1)));
  return (1 - clamp01(voltage)) * (safeHeight - 1);
};

/** Normalized Gaussian electron-beam density at a signed pixel distance. */
export const oscilloscopeBeamDensity = (distance: number, width: number): number => {
  const safeDistance = finite(distance);
  const sigma = Math.max(0.25, Math.abs(finite(width, 1)) * 0.5);
  return Math.exp(-0.5 * (safeDistance / sigma) ** 2);
};

/**
 * Sum excess full-well charge from successively more distant pixels.
 * `decay` is applied once per step and anti-blooming drains a fraction of the
 * accumulated excess rather than changing its colour.
 */
export const ccdSpilledCharge = (
  samples: readonly number[],
  fullWell: number,
  decay: number,
  antiBlooming: number,
): number => {
  const threshold = Math.max(0.001, Math.min(0.999, finite(fullWell, 0.8)));
  const falloff = Math.max(0, Math.min(0.999, finite(decay, 0.85)));
  const drain = clamp01(antiBlooming);
  let charge = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const excess = Math.max(0, clamp01(samples[index] ?? 0) - threshold) / (1 - threshold);
    charge += excess * falloff ** (index + 1);
  }
  return charge * (1 - drain);
};

/** Expected contrast of equally weighted, independent speckle realizations. */
export const speckleContrastForDiversity = (
  singlePatternContrast: number,
  modes: number,
): number => {
  const contrast = Math.max(0, finite(singlePatternContrast));
  const count = Math.max(1, Math.round(finite(modes, 1)));
  return contrast / Math.sqrt(count);
};
