const finite = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? value : fallback;

const clamp01 = (value: number): number =>
  Math.max(0, Math.min(1, finite(value)));

const fract = (value: number): number => value - Math.floor(value);

export const lenticularViewPosition = (
  stripPhase: number,
  viewAngle: number,
  viewCount: number,
): number => {
  const count = Math.max(2, Math.min(12, Math.round(finite(viewCount, 2))));
  const phase = fract(finite(stripPhase) + Math.max(-1, Math.min(1, finite(viewAngle))) * 0.5);
  const slot = Math.min(count - 1, Math.floor(phase * count));
  return slot / (count - 1) * 2 - 1;
};

export const lenticularParallaxOffset = (
  viewPosition: number,
  depthProxy: number,
  parallax: number,
): number => {
  const view = Math.max(-1, Math.min(1, finite(viewPosition)));
  const depth = 0.25 + clamp01(depthProxy) * 0.75;
  return view * depth * Math.max(0, Math.min(24, finite(parallax)));
};

export type LcdSubpixelLayout = "STRIPE" | "PENTILE" | "DIAMOND";

/** Returns R=0, G=1, B=2, or -1 for black matrix. */
export const lcdSubpixelChannel = (
  layout: string,
  localX: number,
  localY: number,
  cellX: number,
  cellY: number,
): number => {
  const x = clamp01(localX);
  const y = clamp01(localY);
  if (layout === "STRIPE") {
    const withinStripe = fract(x * 3);
    if (y < 0.06 || y > 0.94 || withinStripe < 0.06 || withinStripe > 0.94) return -1;
    if (x < 1 / 3) return 0;
    if (x < 2 / 3) return 1;
    return 2;
  }
  if (layout === "PENTILE") {
    if (x < 0.06 || x > 0.94 || y < 0.06 || y > 0.94 || Math.abs(x - 0.5) < 0.05) return -1;
    if (x >= 0.5) return 1;
    return (Math.floor(finite(cellX)) + Math.floor(finite(cellY))) % 2 === 0 ? 0 : 2;
  }
  if (layout !== "DIAMOND") return -1;

  const emitters = [
    { x: 0.5, y: 0.25, radius: 0.18, channel: 1 },
    { x: 0.5, y: 0.75, radius: 0.18, channel: 1 },
    { x: 0.25, y: 0.5, radius: 0.22, channel: 0 },
    { x: 0.75, y: 0.5, radius: 0.22, channel: 2 },
  ];
  for (const emitter of emitters) {
    const diamondDistance = Math.abs(x - emitter.x) + Math.abs(y - emitter.y);
    if (diamondDistance <= emitter.radius) return emitter.channel;
  }
  return -1;
};

export const lcdBlackMatrixLevel = (gapDarkness: number): number =>
  0.12 * (1 - clamp01(gapDarkness));

export const hannWindow = (sample: number, length: number): number => {
  const count = Math.max(1, Math.round(finite(length, 1)));
  // A symmetric Hann window has no non-zero samples below length three. Use
  // the only useful finite-signal convention there: a rectangular window.
  if (count <= 2) return 1;
  const index = Math.max(0, Math.min(count - 1, finite(sample)));
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (count - 1));
};

export const spectrogramNyquistBinCount = (
  signalLength: number,
  requestedBins: number,
): number => {
  const length = Math.max(1, Math.round(finite(signalLength, 1)));
  const requested = Math.max(1, Math.round(finite(requestedBins, 1)));
  return Math.min(requested, Math.floor(length / 2) + 1);
};

export const spectrogramMagnitudeLevel = (
  real: number,
  imaginary: number,
  windowSum: number,
  bin: number,
  signalLength: number,
  dynamicRangeDb: number,
): number => {
  const sum = Math.max(1e-6, Math.abs(finite(windowSum, 1)));
  const oneSidedScale = spectrogramOneSidedScale(bin, signalLength);
  const magnitude = Math.hypot(finite(real), finite(imaginary)) / sum * oneSidedScale;
  const range = Math.max(20, Math.min(100, finite(dynamicRangeDb, 60)));
  const floorMagnitude = 10 ** (-range / 20);
  const db = 20 * Math.log10(Math.max(floorMagnitude, magnitude));
  return clamp01((db + range) / range);
};

export const spectrogramOneSidedScale = (
  bin: number,
  signalLength: number,
): 1 | 2 => {
  const frequencyBin = Math.max(0, Math.round(finite(bin)));
  const length = Math.max(1, Math.round(finite(signalLength, 1)));
  const isEvenNyquist = length % 2 === 0 && frequencyBin === length / 2;
  return frequencyBin === 0 || isEvenNyquist ? 1 : 2;
};

export const spectrogramBinForRow = (
  row: number,
  height: number,
  binCount: number,
  logarithmic: boolean,
): number => {
  const rows = Math.max(2, Math.round(finite(height, 2)));
  const bins = Math.max(1, Math.round(finite(binCount, 1)));
  const axis = 1 - Math.max(0, Math.min(rows - 1, finite(row))) / (rows - 1);
  const mapped = logarithmic
    ? Math.exp(Math.log(bins) * axis) - 1
    : axis * (bins - 1);
  return Math.max(0, Math.min(bins - 1, Math.round(mapped)));
};
