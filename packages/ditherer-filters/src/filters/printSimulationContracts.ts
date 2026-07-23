const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const unit = (value: number): number => Math.min(1, Math.max(0, finite(value)));

/** Separable stencil-ink softening radius; zero means an exact no-blur path. */
export const risographBlurRadius = (inkBleed: number): number =>
  Math.min(8, Math.max(0, Math.round(unit(inkBleed) * 3)));

/** Fixed, balanced registration offset for one plate on a completed sheet. */
export const fixedPrintPlateOffset = (
  layer: number,
  layers: number,
  maximumOffset: number,
): [number, number] => {
  const count = Math.max(1, Math.round(finite(layers, 1)));
  const index = Math.max(0, Math.round(finite(layer)));
  const radius = Math.max(0, finite(maximumOffset)) * (0.5 + 0.5 * index / Math.max(1, count - 1));
  const angle = index * 2.399963229728653 + 0.41;
  return [Math.round(Math.cos(angle) * radius), Math.round(Math.sin(angle) * radius)];
};

/** Bounded duplex plate coverages; both inks clear to paper in highlights. */
export const duplexPlateCoverages = (
  luminance: number,
  mixCurve: number,
): { dark: number; accent: number } => {
  const density = 1 - unit(luminance);
  const curve = Math.max(0.25, finite(mixCurve, 1));
  return {
    dark: unit(density ** curve * 0.9),
    accent: unit(density ** (1 / curve) * 0.65),
  };
};

const hash = (x: number, y: number, layer: number): number => {
  let value = Math.imul(Math.floor(x), 0x1f123bb5)
    ^ Math.imul(Math.floor(y), 0x5f356495)
    ^ Math.imul(layer | 0, 0x6c8e9cf5);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
};

const smooth = (value: number): number => value * value * (3 - 2 * value);
const noise = (x: number, y: number, layer: number): number => {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const top = hash(ix, iy, layer) * (1 - fx) + hash(ix + 1, iy, layer) * fx;
  const bottom = hash(ix, iy + 1, layer) * (1 - fx) + hash(ix + 1, iy + 1, layer) * fx;
  return top * (1 - fy) + bottom * fy;
};

/** Stable, correlated stencil/ink variation centered on zero. */
export const stencilInkVariation = (x: number, y: number, layer: number): number => {
  const safeX = finite(x);
  const safeY = finite(y);
  const safeLayer = Math.round(finite(layer));
  return Math.min(0.5, Math.max(-0.5,
    (noise(safeX / 3.5, safeY / 3.5, safeLayer) - 0.5) * 0.65
    + (noise(safeX / 13 + 17, safeY / 11 + 29, safeLayer + 11) - 0.5) * 0.35));
};

/** Binary clustered-dot decision for a rotated screen-print plate. */
export const screenHalftoneDecision = (
  coverage: number,
  x: number,
  y: number,
  cellSize: number,
  angleDegrees: number,
  dotGain: number,
): boolean => {
  const ink = unit(coverage + finite(dotGain));
  if (ink <= 0) return false;
  if (ink >= 1) return true;
  const cell = Math.max(1, finite(cellSize, 1));
  const angle = finite(angleDegrees) * Math.PI / 180;
  const qx = (finite(x) * Math.cos(angle) + finite(y) * Math.sin(angle)) / cell;
  const qy = (-finite(x) * Math.sin(angle) + finite(y) * Math.cos(angle)) / cell;
  const dx = qx - Math.floor(qx) - 0.5;
  const dy = qy - Math.floor(qy) - 0.5;
  const rank = Math.min(1, 4 * (dx * dx + dy * dy));
  return rank < ink;
};
