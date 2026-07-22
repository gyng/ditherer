const unit = (value: number): number => Number.isFinite(value)
  ? Math.min(1, Math.max(0, value))
  : 0;

/** Ink coverage at paper position after capillary transfer from a neighbor. */
export const inkBleedCoverage = (
  centerLuminance: number,
  neighborLuminance: number,
  absorbency: number,
  distanceWeight: number,
): number => {
  const centerInk = 1 - unit(centerLuminance);
  const neighborInk = 1 - unit(neighborLuminance);
  const transferred = neighborInk * unit(absorbency) * unit(distanceWeight);
  return unit(Math.max(centerInk, transferred));
};
