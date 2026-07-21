const finiteOrZero = (value: number): number => Number.isFinite(value) ? value : 0;

/** Project a two-dimensional refractive gradient onto the knife-edge normal. */
export const knifeEdgeResponse = (
  gradientX: number,
  gradientY: number,
  angleDegrees: number,
): number => {
  if (![gradientX, gradientY, angleDegrees].every(Number.isFinite)) return 0;
  const angle = angleDegrees * Math.PI / 180;
  return finiteOrZero(gradientX * Math.cos(angle) + gradientY * Math.sin(angle));
};

/** Goodman contrast law for averaging independent speckle intensity patterns. */
export const speckleContrastForDiversity = (modes: number): number => {
  const count = Number.isFinite(modes) ? Math.max(1, modes) : 1;
  return 1 / Math.sqrt(count);
};

/** Unit wave vectors used by the plane-wave quasicrystal construction. */
export const quasicrystalDirections = (order: number): Array<{ x: number; y: number }> => {
  const count = Math.max(1, Math.floor(Number.isFinite(order) ? order : 1));
  return Array.from({ length: count }, (_, index) => {
    const angle = index * Math.PI * 2 / count;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  });
};
