const finite = (value: number, fallback = 0): number => (Number.isFinite(value) ? value : fallback);

const clamp01 = (value: number): number => Math.max(0, Math.min(1, finite(value)));

export const anaglyphDisparity = (
  depth: number,
  maximumDisparity: number,
  convergence: number,
): number => {
  const normalizedDepth = clamp01(depth);
  const span = Math.max(0, Math.min(40, finite(maximumDisparity)));
  const plane = clamp01(convergence);
  return (normalizedDepth - plane) * span;
};

type LinearRgb = readonly [number, number, number];

/** Dubois least-squares red/cyan projection, before display-range clipping. */
export const duboisRedCyanLinear = (
  left: LinearRgb,
  right: LinearRgb,
): [number, number, number] => {
  const [lr, lg, lb] = left.map((channel) => finite(channel)) as [number, number, number];
  const [rr, rg, rb] = right.map((channel) => finite(channel)) as [number, number, number];
  return [
    0.4561 * lr + 0.500484 * lg + 0.176381 * lb - 0.0434706 * rr - 0.0879388 * rg - 0.00155529 * rb,
    -0.0400822 * lr -
      0.0378246 * lg -
      0.0157589 * lb +
      0.378476 * rr +
      0.73364 * rg -
      0.0184503 * rb,
    -0.0152161 * lr -
      0.0205971 * lg -
      0.00546856 * lb -
      0.0721527 * rr -
      0.112961 * rg +
      1.2264 * rb,
  ];
};

/** Returns R=0, G=1, or B=2 for a Bayer photosite. */
export const bayerColorAt = (cfa: string, x: number, y: number): number => {
  const px = ((Math.floor(finite(x)) % 2) + 2) % 2;
  const py = ((Math.floor(finite(y)) % 2) + 2) % 2;
  const cell = py * 2 + px;
  const layouts: Record<string, readonly [number, number, number, number]> = {
    RGGB: [0, 1, 1, 2],
    BGGR: [2, 1, 1, 0],
    GRBG: [1, 0, 2, 1],
    GBRG: [1, 2, 0, 1],
  };
  return (layouts[cfa] ?? layouts.RGGB)[cell];
};

export const bayerNoiseSigma = (
  signal: number,
  shotNoiseAtWhite: number,
  readNoise: number,
): number => {
  const level = clamp01(signal);
  const shot = Math.max(0, Math.min(1, finite(shotNoiseAtWhite)));
  const read = Math.max(0, Math.min(1, finite(readNoise)));
  return Math.sqrt(level * shot * shot + read * read);
};

export const moireBeatFrequency = (
  sourcePitch: number,
  samplePitch: number,
  relativeAngleDegrees: number,
): number => {
  const sourceFrequency = 1 / Math.max(0.25, Math.abs(finite(sourcePitch, 1)));
  const sampleFrequency = 1 / Math.max(0.25, Math.abs(finite(samplePitch, 1)));
  const angle = (finite(relativeAngleDegrees) * Math.PI) / 180;
  return Math.sqrt(
    Math.max(
      0,
      sourceFrequency ** 2 +
        sampleFrequency ** 2 -
        2 * sourceFrequency * sampleFrequency * Math.cos(angle),
    ),
  );
};

export const processScreenAngle = (channel: string): number =>
  ({
    C: 15,
    M: 75,
    Y: 0,
    K: 45,
  })[channel] ?? 0;
