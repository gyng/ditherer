import { COLOR, ENUM, RANGE } from "constants/controlTypes";
import { cloneCanvas, getBufferIndex } from "utils";
import { defineFilter } from "filters/types";

let stateBits: Uint8Array | null = null;
let flipFromBits: Uint8Array | null = null;
let flipToBits: Uint8Array | null = null;
let flipProgress: Float32Array | null = null;
let stuckMask: Uint8Array | null = null;
let jitterMap: Float32Array | null = null;
let cachedCols = 0;
let cachedRows = 0;
let cachedW = 0;
let cachedH = 0;
let cachedCellSize = 0;
let cachedStuckDotRate = -1;
let lastFrameIndex = -1;

const BASE_SEED = 0x7f4a7c15;
const DEFAULT_ON_COLOR: [number, number, number] = [242, 194, 48];
const DEFAULT_OFF_COLOR: [number, number, number] = [27, 27, 27];
const DEFAULT_BOARD_COLOR: [number, number, number] = [16, 18, 21];

const hash01 = (v: number): number => {
  let t = (v + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967295;
};

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const clampByte = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));

const toColor = (input: unknown, fallback: [number, number, number]): [number, number, number] => {
  if (Array.isArray(input) && input.length >= 3) {
    return [
      clampByte(Number(input[0])),
      clampByte(Number(input[1])),
      clampByte(Number(input[2])),
    ];
  }
  return fallback;
};

export const optionTypes = {
  cellSize: { type: RANGE, range: [4, 24], step: 1, default: 10, desc: "Size of each physical dot cell" },
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 128, desc: "Luminance threshold for dot on/off" },
  hysteresis: { type: RANGE, range: [0, 64], step: 1, default: 12, desc: "Deadband to avoid rapid state chatter near threshold" },
  maxFlipRate: { type: RANGE, range: [0.01, 1], step: 0.01, default: 0.2, desc: "Max fraction of dots allowed to flip this frame" },
  responseFrames: { type: RANGE, range: [1, 12], step: 1, default: 3, desc: "Frames a dot takes to mechanically settle after a flip command" },
  flipPriority: {
    type: ENUM,
    options: [
      { name: "Largest error first", value: "errorFirst" },
      { name: "Random", value: "random" },
      { name: "Scanline", value: "scanline" },
    ],
    default: "errorFirst",
    desc: "How the flip budget is allocated when many dots need updates",
  },
  dotRoundness: { type: RANGE, range: [0, 1], step: 0.05, default: 1, desc: "Circle (1) to rounded-square (0) dot face shape" },
  gap: { type: RANGE, range: [0, 4], step: 0.5, default: 1, desc: "Visible board gap between neighboring dot faces" },
  onColor: { type: COLOR, default: DEFAULT_ON_COLOR, desc: "Lit/front-face color of active dots" },
  offColor: { type: COLOR, default: DEFAULT_OFF_COLOR, desc: "Unlit/back-face color of inactive dots" },
  boardColor: { type: COLOR, default: DEFAULT_BOARD_COLOR, desc: "Panel color visible between dots" },
  specular: { type: RANGE, range: [0, 1], step: 0.05, default: 0.2, desc: "Subtle highlight amount on each dot face" },
  stuckDotRate: { type: RANGE, range: [0, 0.2], step: 0.005, default: 0, desc: "Fraction of dots that stay stuck and ignore flips" },
  jitter: { type: RANGE, range: [0, 1], step: 0.05, default: 0.1, desc: "Per-dot brightness variation for mechanical realism" },
};

export const defaults = {
  cellSize: optionTypes.cellSize.default,
  threshold: optionTypes.threshold.default,
  hysteresis: optionTypes.hysteresis.default,
  maxFlipRate: optionTypes.maxFlipRate.default,
  responseFrames: optionTypes.responseFrames.default,
  flipPriority: optionTypes.flipPriority.default,
  dotRoundness: optionTypes.dotRoundness.default,
  gap: optionTypes.gap.default,
  onColor: DEFAULT_ON_COLOR,
  offColor: DEFAULT_OFF_COLOR,
  boardColor: DEFAULT_BOARD_COLOR,
  specular: optionTypes.specular.default,
  stuckDotRate: optionTypes.stuckDotRate.default,
  jitter: optionTypes.jitter.default,
};

const resetGridState = (cols: number, rows: number, stuckDotRate: number) => {
  const n = cols * rows;
  stateBits = new Uint8Array(n);
  flipFromBits = new Uint8Array(n);
  flipToBits = new Uint8Array(n);
  flipProgress = new Float32Array(n);
  stuckMask = new Uint8Array(n);
  jitterMap = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const r0 = hash01(BASE_SEED ^ (i * 0x9e3779b1));
    const r1 = hash01(BASE_SEED ^ (i * 0x85ebca6b));
    stuckMask[i] = r0 < stuckDotRate ? 1 : 0;
    jitterMap[i] = r1 * 2 - 1;
  }

  cachedCols = cols;
  cachedRows = rows;
  cachedStuckDotRate = stuckDotRate;
};

const flipDotDisplay = (input, options = defaults) => {
  const cellSize = Math.max(1, Math.round(options.cellSize ?? defaults.cellSize));
  const threshold = Number(options.threshold ?? defaults.threshold);
  const hysteresis = Math.max(0, Number(options.hysteresis ?? defaults.hysteresis));
  const maxFlipRate = clamp01(Number(options.maxFlipRate ?? defaults.maxFlipRate));
  const responseFrames = Math.max(1, Math.round(options.responseFrames ?? defaults.responseFrames));
  const flipPriority = options.flipPriority ?? defaults.flipPriority;
  const dotRoundness = clamp01(Number(options.dotRoundness ?? defaults.dotRoundness));
  const gap = Math.max(0, Number(options.gap ?? defaults.gap));
  const specular = clamp01(Number(options.specular ?? defaults.specular));
  const stuckDotRate = clamp01(Number(options.stuckDotRate ?? defaults.stuckDotRate));
  const jitter = clamp01(Number(options.jitter ?? defaults.jitter));
  const frameIndex = Number((options as any)._frameIndex ?? 0);

  const onColor = toColor(options.onColor, defaults.onColor);
  const offColor = toColor(options.offColor, defaults.offColor);
  const boardColor = toColor(options.boardColor, defaults.boardColor);

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const inBuf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(inBuf.length);

  const cols = Math.ceil(W / cellSize);
  const rows = Math.ceil(H / cellSize);
  const cellCount = cols * rows;

  const newAnimationCycle = frameIndex === 0 && lastFrameIndex > 0;
  const needsReset = (
    !stateBits ||
    !stuckMask ||
    !jitterMap ||
    cachedW !== W ||
    cachedH !== H ||
    cachedCellSize !== cellSize ||
    cachedCols !== cols ||
    cachedRows !== rows ||
    cachedStuckDotRate !== stuckDotRate ||
    newAnimationCycle
  );

  if (needsReset) {
    resetGridState(cols, rows, stuckDotRate);
    cachedW = W;
    cachedH = H;
    cachedCellSize = cellSize;
  }
  lastFrameIndex = frameIndex;

  const flipCandidates: Array<{ idx: number; score: number }> = [];

  const progressStep = 1 / responseFrames;
  for (let idx = 0; idx < cellCount; idx++) {
    const p = flipProgress![idx];
    if (p <= 0) continue;
    const next = p + progressStep;
    if (next >= 1) {
      stateBits![idx] = flipToBits![idx];
      flipProgress![idx] = 0;
    } else {
      flipProgress![idx] = next;
    }
  }

  for (let cy = 0; cy < rows; cy++) {
    const y0 = cy * cellSize;
    const y1 = Math.min(H, y0 + cellSize);
    for (let cx = 0; cx < cols; cx++) {
      const x0 = cx * cellSize;
      const x1 = Math.min(W, x0 + cellSize);
      const idx = cx + cy * cols;

      let lumSum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = getBufferIndex(x, y, W);
          lumSum += 0.2126 * inBuf[p] + 0.7152 * inBuf[p + 1] + 0.0722 * inBuf[p + 2];
          count++;
        }
      }

      const lum = count > 0 ? (lumSum / count) : 0;
      const currentOn = flipProgress![idx] > 0 ? (flipToBits![idx] === 1) : (stateBits![idx] === 1);
      let targetOn = currentOn;

      if (currentOn) {
        if (lum > threshold + hysteresis) targetOn = false;
      } else if (lum < threshold - hysteresis) {
        targetOn = true;
      }

      const isFlipping = flipProgress![idx] > 0;
      if (!isFlipping && targetOn !== currentOn) {
        const score = flipPriority === "random"
          ? hash01(BASE_SEED ^ frameIndex ^ (idx * 0x27d4eb2d))
          : flipPriority === "scanline"
            ? -idx
            : Math.abs(threshold - lum);
        flipCandidates.push({ idx, score });
      }
    }
  }

  if (flipCandidates.length > 0 && maxFlipRate > 0) {
    const maxFlips = Math.min(
      flipCandidates.length,
      Math.max(1, Math.floor(cellCount * maxFlipRate))
    );

    flipCandidates.sort((a, b) => b.score - a.score);

    for (let i = 0; i < maxFlips; i++) {
      const idx = flipCandidates[i].idx;
      if (stuckMask![idx] === 1) continue;
      flipFromBits![idx] = stateBits![idx];
      flipToBits![idx] = stateBits![idx] === 1 ? 0 : 1;
      flipProgress![idx] = Math.min(0.999, progressStep);
    }
  }

  for (let i = 0; i < outBuf.length; i += 4) {
    outBuf[i] = boardColor[0];
    outBuf[i + 1] = boardColor[1];
    outBuf[i + 2] = boardColor[2];
    outBuf[i + 3] = inBuf[i + 3];
  }

  const faceSize = Math.max(1, cellSize - gap);
  const radius = Math.max(0.5, faceSize * 0.5);
  const squareRadius = Math.max(1, Math.ceil(radius));

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const idx = cx + cy * cols;
      const centerX = cx * cellSize + cellSize * 0.5;
      const centerY = cy * cellSize + cellSize * 0.5;
      const p = flipProgress![idx];
      let stateMix = stateBits![idx];
      let transitionDim = 1;
      if (p > 0) {
        const eased = p * p * (3 - 2 * p);
        stateMix = flipFromBits![idx] + (flipToBits![idx] - flipFromBits![idx]) * eased;
        transitionDim = 1 - 0.35 * (1 - Math.abs(2 * p - 1));
      }
      const baseR = offColor[0] + (onColor[0] - offColor[0]) * stateMix;
      const baseG = offColor[1] + (onColor[1] - offColor[1]) * stateMix;
      const baseB = offColor[2] + (onColor[2] - offColor[2]) * stateMix;
      const jitterScale = 1 + (jitterMap![idx] * jitter * 0.25);

      for (let oy = -squareRadius; oy <= squareRadius; oy++) {
        const py = Math.round(centerY + oy);
        if (py < 0 || py >= H) continue;
        for (let ox = -squareRadius; ox <= squareRadius; ox++) {
          const px = Math.round(centerX + ox);
          if (px < 0 || px >= W) continue;

          const nx = ox / radius;
          const ny = oy / radius;
          const radial = nx * nx + ny * ny;
          const box = Math.max(Math.abs(nx), Math.abs(ny));
          const shapeMetric = radial * dotRoundness + box * (1 - dotRoundness);
          if (shapeMetric > 1) continue;

          const p = getBufferIndex(px, py, W);
          const edgeDarken = 1 - clamp01(Math.sqrt(radial)) * 0.3;
          const highlight = specular * Math.max(0, 1 - (((nx + 0.35) * (nx + 0.35) + (ny + 0.35) * (ny + 0.35)) / 0.2));
          const shade = Math.max(0, edgeDarken + highlight) * jitterScale * transitionDim;

          outBuf[p] = clampByte(baseR * shade);
          outBuf[p + 1] = clampByte(baseG * shade);
          outBuf[p + 2] = clampByte(baseB * shade);
          outBuf[p + 3] = inBuf[p + 3];
        }
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Flip-Dot Display",
  func: flipDotDisplay,
  optionTypes,
  options: defaults,
  defaults,
  mainThread: true,
  description: "Electromechanical split-flap style dot board with hysteresis, flip-rate limits, and subtle mechanical imperfections",
});
