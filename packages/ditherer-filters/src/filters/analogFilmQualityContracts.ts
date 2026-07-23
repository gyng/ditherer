const unit = (value: number): number => Number.isFinite(value)
  ? Math.min(1, Math.max(0, value))
  : 0;

/** Display-domain grain excursion derived from density and user amount. */
export const filmGrainAmplitude = (luminance: number, amount: number): number => {
  const luma = unit(luminance);
  const densityEnvelope = 0.2 + 0.8 * Math.sqrt(Math.max(0, 4 * luma * (1 - luma)));
  return unit(amount) * 0.25 * densityEnvelope;
};

const densityHash = (x: number, y: number, seed: number): number => {
  let value = Math.imul(Math.floor(x), 0x1f123bb5) ^ Math.imul(Math.floor(y), 0x5f356495) ^ (seed | 0);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
};

const smooth = (value: number): number => value * value * (3 - 2 * value);
const densityValueNoise = (x: number, y: number, seed: number): number => {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const top = densityHash(ix, iy, seed) * (1 - fx) + densityHash(ix + 1, iy, seed) * fx;
  const bottom = densityHash(ix, iy + 1, seed) * (1 - fx) + densityHash(ix + 1, iy + 1, seed) * fx;
  return top * (1 - fy) + bottom * fy;
};

/** Four-field sum approximating a bounded Gaussian density fluctuation. */
export const filmDensityNoise = (x: number, y: number, seed: number): number => (
  densityValueNoise(x, y, seed)
  + densityValueNoise(x + 19.1, y + 7.3, seed + 11)
  + densityValueNoise(x + 3.7, y + 29.9, seed + 29)
  + densityValueNoise(x + 41.3, y + 17.7, seed + 47)
  - 2
) * 0.5;

/** Stable artifact counts at a reference 640×480 projected frame. */
export const projectionArtifactCounts = (
  width: number,
  height: number,
  dustAmount: number,
  scratchAmount: number,
  dustJitter = 0.5,
  scratchJitter = 0.5,
): { dust: number; scratches: number } => {
  const safeWidth = Math.max(1, Number.isFinite(width) ? width : 1);
  const safeHeight = Math.max(1, Number.isFinite(height) ? height : 1);
  const areaScale = safeWidth * safeHeight / (640 * 480);
  const widthScale = safeWidth / 640;
  const varied = (value: number): number => 0.75 + unit(value) * 0.5;
  const dust = Math.min(64, Math.max(0, Math.round(unit(dustAmount) * 24 * areaScale * varied(dustJitter))));
  const scratches = unit(scratchAmount) === 0
    ? 0
    : Math.min(16, Math.max(1, Math.round(unit(scratchAmount) * 6 * widthScale * varied(scratchJitter))));
  return { dust, scratches };
};

const srgbToLinear = (value: number): number => {
  const channel = unit(value);
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
};

const linearToSrgb = (value: number): number => {
  const channel = Math.max(0, Number.isFinite(value) ? value : 0);
  return unit(channel <= 0.0031308
    ? channel * 12.92
    : 1.055 * channel ** (1 / 2.4) - 0.055);
};

/** Add leak exposure in linear light without hidden channel weighting. */
export const linearLightLeakChannel = (
  sourceSrgb: number,
  leakSrgb: number,
  exposure: number,
): number => linearToSrgb(
  srgbToLinear(sourceSrgb) + srgbToLinear(leakSrgb) * unit(exposure),
);
