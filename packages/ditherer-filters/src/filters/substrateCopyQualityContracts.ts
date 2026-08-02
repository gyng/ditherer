const finite = (value: number, fallback = 0): number => (Number.isFinite(value) ? value : fallback);
const unit = (value: number): number => Math.min(1, Math.max(0, finite(value)));

/**
 * Continuous monochrome transfer curve for a repeated xerographic copy.
 * Generation loss suppresses local detail and increases density contrast; it
 * deliberately never quantizes the tone ramp.
 */
export const photocopierGenerationTone = (
  luminance: number,
  neighborhoodMean: number,
  contrast: number,
  generationLoss: number,
): number => {
  const loss = unit(generationLoss);
  const source = unit(luminance);
  const local = unit(neighborhoodMean);
  const softened = source * (1 - loss * 0.72) + local * loss * 0.72;
  const denser = unit(softened + (softened - 0.5) * loss * 0.18);
  const exponent = 1 / Math.max(0.25, finite(contrast, 1));
  const distance = Math.min(1, Math.abs(denser * 2 - 1));
  return unit(0.5 + Math.sign(denser - 0.5) * 0.5 * distance ** exponent);
};

/** Cycles at or below 90% of the pixel Nyquist limit. */
export const substratePatternFrequency = (
  scale: number,
  resolution: number,
  repeatsPerScale: number,
): number => {
  const requested = Math.max(0, finite(scale)) * Math.max(0, finite(repeatsPerScale));
  const nyquistGuard = Math.max(1, finite(resolution, 1)) * 0.45;
  return Math.min(requested, nyquistGuard);
};

const hash = (x: number, y: number): number => {
  let value = Math.imul(Math.floor(x), 0x1f123bb5) ^ Math.imul(Math.floor(y), 0x5f356495);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
};

const smooth = (value: number): number => value * value * (3 - 2 * value);
const valueNoise = (x: number, y: number): number => {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = smooth(x - ix),
    fy = smooth(y - iy);
  const top = hash(ix, iy) * (1 - fx) + hash(ix + 1, iy) * fx;
  const bottom = hash(ix, iy + 1) * (1 - fx) + hash(ix + 1, iy + 1) * fx;
  return top * (1 - fy) + bottom * fy;
};

/** Directionally correlated long-fibre paper variation in the range [-1, 1]. */
export const washiFiberVariation = (x: number, y: number): number => {
  const safeX = finite(x);
  const safeY = finite(y);
  const longFiber = valueNoise(safeX / 28, safeY / 3.5);
  const crossingFiber = valueNoise(safeX / 5.5 + 31, safeY / 17 + 11);
  const sheetFormation = valueNoise(safeX / 42 + 7, safeY / 42 + 19);
  const fineFiber = valueNoise(safeX / 12 + 23, safeY / 2.4 + 5);
  return Math.min(
    1,
    Math.max(
      -1,
      (longFiber - 0.5) * 0.9 +
        (crossingFiber - 0.5) * 0.55 +
        (fineFiber - 0.5) * 0.35 +
        (sheetFormation - 0.5) * 0.2,
    ),
  );
};
