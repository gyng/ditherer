export type UnitRgb = readonly [number, number, number];

const unit = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

const smoothstep = (low: number, high: number, value: number): number => {
  const t = unit((value - low) / (high - low));
  return t * t * (3 - 2 * t);
};

/**
 * Estimate a plausible near-infrared response from visible linear RGB.
 * This is deliberately a material-color heuristic, not spectral recovery.
 */
export const estimateVisibleNir = (
  rgb: UnitRgb,
  foliageResponse = 1,
  skySuppression = 0.65,
): number => {
  const r = unit(rgb[0]);
  const g = unit(rgb[1]);
  const b = unit(rgb[2]);
  const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const greenExcess = Math.max(0, g - (r + b) * 0.5);
  const blueExcess = b - Math.max(r, g);
  const skyLikelihood = smoothstep(0.02, 0.3, blueExcess);
  // Preserve spectrally neutral reflectance exactly; only chromatic material
  // cues should move the estimate away from visible luminance.
  const base = luma * 0.6 + r * 0.25 + g * 0.15;
  const estimated = unit(base + greenExcess * 1.4 * Math.max(0, foliageResponse));
  return unit(estimated * (1 - skyLikelihood * unit(skySuppression)));
};

/** Kodak-style color-infrared ordering: estimated NIR→R, visible R→G, visible G→B. */
export const aerochromeChannels = (
  rgb: UnitRgb,
  estimatedNir: number,
): [number, number, number] => [unit(estimatedNir), unit(rgb[0]), unit(rgb[1])];

export const MEZZOTINT_ROCKER_ANGLES = [0, 45, 90, 135] as const;

const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

/** True means the dark LCD state is active for this display-native pixel. */
export const lcdOrderedDecision = (
  luminance: number,
  x: number,
  y: number,
  threshold: number,
  ditherStrength: number,
): boolean => {
  const ix = ((Math.floor(Number.isFinite(x) ? x : 0) % 4) + 4) % 4;
  const iy = ((Math.floor(Number.isFinite(y) ? y : 0) % 4) + 4) % 4;
  const matrix = BAYER_4[iy * 4 + ix];
  const offset = ((matrix + 0.5) / 16 - 0.5) * unit(ditherStrength);
  return unit(luminance) < unit((Number.isFinite(threshold) ? threshold : 128) / 255) + offset;
};

/** Continuous ink held by the rocked burr after scraping, burnishing, and wear. */
export const mezzotintInkCoverage = (
  luminance: number,
  density: number,
  burnish: number,
  plateWear: number,
): number => {
  const light = unit(luminance);
  const ground = unit(density);
  const curve = Math.max(0.05, Number.isFinite(burnish) ? burnish : 1);
  const wear = unit(plateWear);
  return unit((1 - light ** curve) * ground * (1 - wear * 0.55));
};

/** Direct-positive image-particle scatter, with gold toning increasing contrast. */
export const daguerreotypeScatter = (luminance: number, gilding: number): number => {
  const scatter = unit(luminance) ** 0.9;
  const contrast = 1 + unit(gilding) * 0.5;
  return unit((scatter - 0.5) * contrast + 0.5);
};

/** Broad mirror-field reflection from the polished plate at a chosen viewing angle. */
export const daguerreotypePlateReflection = (
  normalizedX: number,
  normalizedY: number,
  angleDegrees: number,
  metallic: number,
): number => {
  const x = Number.isFinite(normalizedX) ? Math.min(1, Math.max(-1, normalizedX)) : 0;
  const y = Number.isFinite(normalizedY) ? Math.min(1, Math.max(-1, normalizedY)) : 0;
  const angle = ((Number.isFinite(angleDegrees) ? angleDegrees : 0) * Math.PI) / 180;
  const directional = unit(0.5 + 0.5 * (x * Math.cos(angle) + y * Math.sin(angle)));
  return unit((0.12 + 0.88 * directional) * unit(metallic));
};
