const LOOK_IDS: Record<string, number> = {
  BALANCED: 0,
  CLEAR_DAY: 1,
  GOLDEN_HOUR: 2,
  BLUE_HOUR: 3,
  NEON_NIGHT: 4,
};

export const animeLookId = (look: unknown): number => LOOK_IDS[String(look)] ?? 0;

export const celBandIndex = (
  luminance: number,
  shadowThreshold: number,
  highlightThreshold: number,
): 0 | 1 | 2 => {
  const value = Number.isFinite(luminance) ? Math.min(1, Math.max(0, luminance)) : 0;
  const a = Number.isFinite(shadowThreshold) ? shadowThreshold : 0.34;
  const b = Number.isFinite(highlightThreshold) ? highlightThreshold : 0.76;
  const shadow = Math.min(a, b);
  const highlight = Math.max(a, b);
  if (value < shadow) return 0;
  return value < highlight ? 1 : 2;
};

/** XDoG's dark-line complement of its piecewise soft-threshold response. */
export const xdogInkResponse = (
  difference: number,
  threshold: number,
  softness: number,
): number => {
  if (![difference, threshold, softness].every(Number.isFinite)) return 0;
  if (difference >= threshold) return 0;
  return Math.min(1, Math.max(0, -Math.tanh(Math.max(0, softness) * (difference - threshold))));
};

export const rimDirection = (angleDegrees: number): { x: number; y: number } => {
  const angle = ((Number.isFinite(angleDegrees) ? angleDegrees : 0) * Math.PI) / 180;
  return { x: Math.cos(angle), y: Math.sin(angle) };
};
