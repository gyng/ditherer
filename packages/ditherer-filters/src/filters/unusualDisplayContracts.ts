/** Pure geometry and timing contracts shared by unusual display simulations. */

const finite = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

export const bairdScanColumn = (normalizedX: number): number =>
  Math.max(0, Math.min(29, Math.floor(finite(normalizedX, 0) * 30)));

export const bairdFrameIndex = (frameIndex: number, previewFps: number): number => {
  const frame = Math.max(0, Math.floor(finite(frameIndex, 0)));
  const fps = Math.max(1, Math.min(120, finite(previewFps, 25)));
  return Math.floor((frame * 12.5) / fps);
};

export const cgaCarrierPhase = (pixel: number): number => {
  const integer = Math.floor(finite(pixel, 0));
  return ((integer % 4) + 4) % 4;
};

export type PlatoGridCoordinate = { inside: boolean; x: number; y: number };

export const platoGridCoordinate = (
  outputX: number,
  outputY: number,
  outputWidth: number,
  outputHeight: number,
): PlatoGridCoordinate => {
  const width = Math.max(1, finite(outputWidth, 1));
  const height = Math.max(1, finite(outputHeight, 1));
  const size = Math.min(width, height);
  const left = (width - size) * 0.5;
  const top = (height - size) * 0.5;
  const localX = finite(outputX, -1) - left;
  const localY = finite(outputY, -1) - top;
  const inside = localX >= 0 && localY >= 0 && localX < size && localY < size;
  return {
    inside,
    x: Math.max(0, Math.min(511, Math.floor((localX * 512) / size))),
    y: Math.max(0, Math.min(511, Math.floor((localY * 512) / size))),
  };
};

export type DlpSubfieldOffsets = {
  red: { x: number; y: number };
  green: { x: number; y: number };
  blue: { x: number; y: number };
};

export const dlpSubfieldOffsets = (
  motionX: number,
  motionY: number,
  colorCycles: number,
): DlpSubfieldOffsets => {
  const cycles = Math.max(1, Math.min(12, Math.round(finite(colorCycles, 1))));
  const spanX = finite(motionX, 0) / cycles;
  const spanY = finite(motionY, 0) / cycles;
  return {
    red: { x: -spanX / 3, y: -spanY / 3 },
    green: { x: 0, y: 0 },
    blue: { x: spanX / 3, y: spanY / 3 },
  };
};
