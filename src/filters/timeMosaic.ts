import { RANGE, ENUM, ACTION } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { cloneCanvas, getBufferIndex } from "utils";

const PATTERN = { RANDOM: "RANDOM", CHECKERBOARD: "CHECKERBOARD", RADIAL: "RADIAL", GRADIENT: "GRADIENT" };
const BEHAVIOR = { DELAY_MAP: "DELAY_MAP", STABILIZER: "STABILIZER" };

// Module-level ring buffer of full frames
let ringBuf: Uint8ClampedArray[] = [];
let ringHead = 0;
let ringW = 0;
let ringH = 0;
let ringDepth = 0;
let stabilizerFrame: Uint8ClampedArray | null = null;
let stabilizerAges: Uint16Array | null = null;
let stabilizerBlocksX = 0;
let stabilizerBlocksY = 0;
let stabilizerTileSize = 0;
let stabilizerBehavior = "";
let lastFrameIndex = -1;

const resetStabilizerState = (width: number, height: number, tileSize: number, behavior: string) => {
  stabilizerFrame = null;
  stabilizerBlocksX = Math.ceil(width / tileSize);
  stabilizerBlocksY = Math.ceil(height / tileSize);
  stabilizerAges = new Uint16Array(stabilizerBlocksX * stabilizerBlocksY);
  stabilizerTileSize = tileSize;
  stabilizerBehavior = behavior;
};

export const optionTypes = {
  behavior: {
    type: ENUM,
    options: [
      { name: "Delay map", value: BEHAVIOR.DELAY_MAP },
      { name: "Stabilizer", value: BEHAVIOR.STABILIZER },
    ],
    default: BEHAVIOR.DELAY_MAP,
    desc: "Use a fixed per-tile delay map or hold tiles until motion forces them to refresh",
  },
  tileSize: { type: RANGE, range: [8, 64], step: 4, default: 24, desc: "Tile dimensions in pixels" },
  maxDelay: { type: RANGE, range: [2, 30], step: 1, default: 10, desc: "Maximum frame delay for any tile" },
  pattern: {
    type: ENUM,
    options: [
      { name: "Random", value: PATTERN.RANDOM },
      { name: "Checkerboard", value: PATTERN.CHECKERBOARD },
      { name: "Radial (center live)", value: PATTERN.RADIAL },
      { name: "Gradient (left→right)", value: PATTERN.GRADIENT },
    ],
    default: PATTERN.RANDOM,
    desc: "How delays are distributed across tiles",
    visibleWhen: (options: TimeMosaicOptions) => (options.behavior || BEHAVIOR.DELAY_MAP) === BEHAVIOR.DELAY_MAP,
  },
  motionThreshold: {
    type: RANGE,
    range: [0, 255],
    step: 1,
    default: 72,
    desc: "Tile difference needed before the stabilizer refreshes from the live frame",
    visibleWhen: (options: TimeMosaicOptions) => options.behavior === BEHAVIOR.STABILIZER,
  },
  holdFrames: {
    type: RANGE,
    range: [1, 30],
    step: 1,
    default: 8,
    desc: "Maximum number of quiet frames a stabilizer tile can hold before it refreshes",
    visibleWhen: (options: TimeMosaicOptions) => options.behavior === BEHAVIOR.STABILIZER,
  },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  behavior: optionTypes.behavior.default,
  tileSize: optionTypes.tileSize.default,
  maxDelay: optionTypes.maxDelay.default,
  pattern: optionTypes.pattern.default,
  motionThreshold: optionTypes.motionThreshold.default,
  holdFrames: optionTypes.holdFrames.default,
  animSpeed: optionTypes.animSpeed.default,
};

// Simple hash for deterministic per-tile delay
const tileHash = (tx: number, ty: number) => {
  let h = tx * 374761393 + ty * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
};

type TimeMosaicOptions = FilterOptionValues & {
  behavior?: string;
  tileSize?: number;
  maxDelay?: number;
  pattern?: string;
  motionThreshold?: number;
  holdFrames?: number;
  animSpeed?: number;
  _prevInput?: Uint8ClampedArray | null;
  _frameIndex?: number;
};

const timeMosaic = (input: any, options: TimeMosaicOptions = defaults) => {
  const {
    behavior = defaults.behavior,
    tileSize = defaults.tileSize,
    maxDelay = defaults.maxDelay,
    pattern = defaults.pattern,
    motionThreshold = defaults.motionThreshold,
    holdFrames = defaults.holdFrames,
  } = options;
  const prevInput = options._prevInput ?? null;
  const frameIndex = Number(options._frameIndex ?? 0);
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const restartedAnimation = frameIndex === 0 && lastFrameIndex > 0;
  lastFrameIndex = frameIndex;

  if (behavior === BEHAVIOR.STABILIZER) {
    if (
      !stabilizerAges ||
      stabilizerTileSize !== tileSize ||
      stabilizerBlocksX !== Math.ceil(W / tileSize) ||
      stabilizerBlocksY !== Math.ceil(H / tileSize) ||
      stabilizerBehavior !== behavior ||
      restartedAnimation ||
      ringW !== W ||
      ringH !== H
    ) {
      resetStabilizerState(W, H, tileSize, behavior);
      stabilizerFrame = new Uint8ClampedArray(buf);
      ringW = W;
      ringH = H;
    }

    const outBuf = stabilizerFrame ? new Uint8ClampedArray(stabilizerFrame) : new Uint8ClampedArray(buf);
    const blocksX = Math.ceil(W / tileSize);
    const blocksY = Math.ceil(H / tileSize);

    for (let by = 0; by < blocksY; by++) {
      for (let bx = 0; bx < blocksX; bx++) {
        const blockIndex = by * blocksX + bx;
        const startX = bx * tileSize;
        const startY = by * tileSize;
        const endX = Math.min(startX + tileSize, W);
        const endY = Math.min(startY + tileSize, H);

        let motion = 0;
        let samples = 0;
        if (prevInput) {
          for (let y = startY; y < endY; y++) {
            for (let x = startX; x < endX; x++) {
              const i = getBufferIndex(x, y, W);
              motion += (
                Math.abs(buf[i] - prevInput[i]) +
                Math.abs(buf[i + 1] - prevInput[i + 1]) +
                Math.abs(buf[i + 2] - prevInput[i + 2])
              ) / 3;
              samples++;
            }
          }
        }

        const avgMotion = samples > 0 ? motion / samples : 255;
        const shouldRefresh = !stabilizerFrame || avgMotion > motionThreshold || stabilizerAges![blockIndex] >= holdFrames;

        if (shouldRefresh) {
          for (let y = startY; y < endY; y++) {
            for (let x = startX; x < endX; x++) {
              const i = getBufferIndex(x, y, W);
              outBuf[i] = buf[i];
              outBuf[i + 1] = buf[i + 1];
              outBuf[i + 2] = buf[i + 2];
              outBuf[i + 3] = buf[i + 3];
            }
          }
          stabilizerAges![blockIndex] = 0;
        } else {
          stabilizerAges![blockIndex] += 1;
        }
      }
    }

    stabilizerFrame = new Uint8ClampedArray(outBuf);
    outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
    return output;
  }

  // Reset ring buffer if dimensions changed
  if (ringW !== W || ringH !== H || ringDepth !== maxDelay) {
    ringBuf = [];
    ringHead = 0;
    ringW = W;
    ringH = H;
    ringDepth = maxDelay;
  }

  ringBuf[ringHead % maxDelay] = new Uint8ClampedArray(buf);
  ringHead++;

  const filled = Math.min(ringHead, maxDelay);
  const outBuf = new Uint8ClampedArray(buf.length);
  const blocksX = Math.ceil(W / tileSize);
  const blocksY = Math.ceil(H / tileSize);
  const cx = blocksX / 2, cy = blocksY / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      let delay: number;
      if (pattern === PATTERN.CHECKERBOARD) {
        delay = ((bx + by) % 2 === 0) ? 0 : maxDelay - 1;
      } else if (pattern === PATTERN.RADIAL) {
        const dist = Math.sqrt((bx - cx) ** 2 + (by - cy) ** 2) / maxDist;
        delay = Math.floor(dist * (maxDelay - 1));
      } else if (pattern === PATTERN.GRADIENT) {
        delay = Math.floor((bx / Math.max(1, blocksX - 1)) * (maxDelay - 1));
      } else {
        delay = Math.floor(tileHash(bx, by) * maxDelay);
      }
      delay = Math.min(delay, filled - 1);

      const frameData = ringBuf[((ringHead - 1 - delay) % maxDelay + maxDelay) % maxDelay];
      if (!frameData) continue;

      const startX = bx * tileSize, startY = by * tileSize;
      const endX = Math.min(startX + tileSize, W);
      const endY = Math.min(startY + tileSize, H);

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const i = getBufferIndex(x, y, W);
          outBuf[i] = frameData[i]; outBuf[i + 1] = frameData[i + 1];
          outBuf[i + 2] = frameData[i + 2]; outBuf[i + 3] = 255;
        }
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Time Mosaic", func: timeMosaic, optionTypes, options: defaults, defaults, description: "Use either fixed per-tile delays or motion-triggered tile holds for staggered, patchwork temporal views" });
