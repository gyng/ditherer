import { RANGE, ENUM, ACTION } from "constants/controlTypes";
import { cloneCanvas, getBufferIndex } from "utils";

const PATTERN = { RANDOM: "RANDOM", CHECKERBOARD: "CHECKERBOARD", RADIAL: "RADIAL", GRADIENT: "GRADIENT" };

// Module-level ring buffer of full frames
let ringBuf: Uint8ClampedArray[] = [];
let ringHead = 0;
let ringW = 0;
let ringH = 0;
let ringDepth = 0;

export const optionTypes = {
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
  },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions, inputCanvas, _f, options) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  tileSize: optionTypes.tileSize.default,
  maxDelay: optionTypes.maxDelay.default,
  pattern: optionTypes.pattern.default,
  animSpeed: optionTypes.animSpeed.default,
};

// Simple hash for deterministic per-tile delay
const tileHash = (tx: number, ty: number) => {
  let h = tx * 374761393 + ty * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
};

const timeMosaic = (input, options: any = defaults) => {
  const { tileSize, maxDelay, pattern } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

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

export default { name: "Time Mosaic", func: timeMosaic, optionTypes, options: defaults, defaults, description: "Tiles update at different rates — staggered surveillance-wall aesthetic" };
