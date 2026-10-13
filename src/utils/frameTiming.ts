/** A zero/invalid duration has no measured FPS (including cached frames). */
export const formatFrameRate = (durationMs: number): string => {
  const rate = 1000 / durationMs;
  return Number.isFinite(rate) && rate > 0 ? `${rate.toFixed(1)} fps` : "— fps";
};
