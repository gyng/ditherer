const unit = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/** Visible-light proxy mapped into a thermal display window; not temperature. */
export const thermalProxyLevelSpan = (
  luminance: number,
  level: number,
  span: number,
  contrast = 1,
): number => {
  const safeLevel = unit(level);
  const safeSpan = Math.max(0.01, Number.isFinite(span) ? Math.min(1, Math.abs(span)) : 1);
  const normalized = (unit(luminance) - (safeLevel - safeSpan * 0.5)) / safeSpan;
  const safeContrast = Number.isFinite(contrast) ? Math.max(0, contrast) : 1;
  return unit((normalized - 0.5) * safeContrast + 0.5);
};

/** Positive-image cyanotype density: darker source values form more blue. */
export const cyanotypeBlueDensity = (
  luminance: number,
  exposure: number,
  contrast: number,
  blueDensity: number,
  invert = false,
): number => {
  const safeExposure = Number.isFinite(exposure) ? Math.min(1, Math.max(-1, exposure)) : 0;
  const safeContrast = Number.isFinite(contrast) ? Math.max(0.05, contrast) : 1;
  const shifted = unit(unit(luminance) + safeExposure * 0.35);
  const paperSignal = unit((shifted - 0.5) * safeContrast + 0.5);
  const imageSignal = invert ? paperSignal : 1 - paperSignal;
  return unit(imageSignal * unit(blueDensity));
};

/** Grain remains in normalized tone units; byte scaling would violate this. */
export const cyanotypeGrainAmplitude = (grain: number): number => unit(grain);
