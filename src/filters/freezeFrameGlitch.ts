import { RANGE, BOOL, ACTION } from "constants/controlTypes";
import { cloneCanvas, getBufferIndex } from "utils";

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Module-level freeze grid persists across frames
let freezeGrid: Uint8Array | null = null;
let freezeGridW = 0;
let freezeGridH = 0;

export const optionTypes = {
  blockSize: { type: RANGE, range: [8, 64], step: 4, default: 24, desc: "Dimensions of freeze grid cells" },
  freezeChance: { type: RANGE, range: [0, 0.5], step: 0.01, default: 0.1, desc: "Probability per block per frame of freezing" },
  thawRate: { type: RANGE, range: [0.01, 0.2], step: 0.01, default: 0.05, desc: "Probability of a frozen block unfreezing each frame" },
  channelIndependent: { type: BOOL, default: false, desc: "Freeze R/G/B channels independently for color-split glitches" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions, inputCanvas, _f, options) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 12); }
  }},
};

export const defaults = {
  blockSize: optionTypes.blockSize.default,
  freezeChance: optionTypes.freezeChance.default,
  thawRate: optionTypes.thawRate.default,
  channelIndependent: optionTypes.channelIndependent.default,
  animSpeed: optionTypes.animSpeed.default,
};

const freezeFrameGlitch = (input, options: any = defaults) => {
  const { blockSize, freezeChance, thawRate, channelIndependent } = options;
  const prevOutput: Uint8ClampedArray | null = (options as any)._prevOutput || null;
  const frameIndex = (options as any)._frameIndex || 0;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const blocksX = Math.ceil(W / blockSize);
  const blocksY = Math.ceil(H / blockSize);
  const totalBlocks = blocksX * blocksY;
  const channels = channelIndependent ? 3 : 1;
  const gridSize = totalBlocks * channels;

  // Reset grid if dimensions changed
  if (!freezeGrid || freezeGrid.length !== gridSize || freezeGridW !== W || freezeGridH !== H) {
    freezeGrid = new Uint8Array(gridSize);
    freezeGridW = W;
    freezeGridH = H;
  }

  // Update freeze/thaw state
  const rng = mulberry32(frameIndex * 7919 + 31337);
  for (let b = 0; b < gridSize; b++) {
    if (freezeGrid[b] && rng() < thawRate) freezeGrid[b] = 0;
    else if (!freezeGrid[b] && rng() < freezeChance) freezeGrid[b] = 1;
  }

  // Apply freeze/thaw per pixel
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const blockIdx = by * blocksX + bx;
      const startX = bx * blockSize;
      const startY = by * blockSize;
      const endX = Math.min(startX + blockSize, W);
      const endY = Math.min(startY + blockSize, H);

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const i = getBufferIndex(x, y, W);
          if (channelIndependent && prevOutput) {
            outBuf[i]     = freezeGrid[blockIdx * 3]     ? prevOutput[i]     : buf[i];
            outBuf[i + 1] = freezeGrid[blockIdx * 3 + 1] ? prevOutput[i + 1] : buf[i + 1];
            outBuf[i + 2] = freezeGrid[blockIdx * 3 + 2] ? prevOutput[i + 2] : buf[i + 2];
          } else if (freezeGrid[blockIdx] && prevOutput) {
            outBuf[i]     = prevOutput[i];
            outBuf[i + 1] = prevOutput[i + 1];
            outBuf[i + 2] = prevOutput[i + 2];
          } else {
            outBuf[i]     = buf[i];
            outBuf[i + 1] = buf[i + 1];
            outBuf[i + 2] = buf[i + 2];
          }
          outBuf[i + 3] = 255;
        }
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Freeze Frame Glitch", func: freezeFrameGlitch, optionTypes, options: defaults, defaults, description: "Random blocks freeze in time while the rest continues — corrupted buffer aesthetic" };
