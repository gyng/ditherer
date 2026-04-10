import { RANGE, BOOL, ACTION } from "constants/controlTypes";
import { cloneCanvas, getBufferIndex } from "utils";

export const optionTypes = {
  blockSize: { type: RANGE, range: [4, 32], step: 2, default: 12, desc: "Pixelation block size for affected areas" },
  invert: { type: BOOL, default: false, desc: "Pixelate static areas instead of moving" },
  threshold: { type: RANGE, range: [5, 50], step: 1, default: 15, desc: "Motion sensitivity threshold" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions, inputCanvas, _f, options) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  blockSize: optionTypes.blockSize.default,
  invert: optionTypes.invert.default,
  threshold: optionTypes.threshold.default,
  animSpeed: optionTypes.animSpeed.default,
};

const motionPixelate = (input, options: any = defaults) => {
  const { blockSize, invert, threshold } = options;
  const ema: Float32Array | null = (options as any)._ema || null;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const blocksX = Math.ceil(W / blockSize);
  const blocksY = Math.ceil(H / blockSize);
  const thresholdNorm = threshold / 100;

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const startX = bx * blockSize, startY = by * blockSize;
      const endX = Math.min(startX + blockSize, W);
      const endY = Math.min(startY + blockSize, H);

      // Compute per-block motion
      let blockMotion = 0;
      let pixelCount = 0;
      if (ema) {
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const i = getBufferIndex(x, y, W);
            blockMotion += (Math.abs(buf[i] - ema[i]) + Math.abs(buf[i + 1] - ema[i + 1]) + Math.abs(buf[i + 2] - ema[i + 2])) / 765;
            pixelCount++;
          }
        }
        blockMotion /= Math.max(1, pixelCount);
      }

      const shouldPixelate = invert ? (blockMotion < thresholdNorm) : (blockMotion > thresholdNorm);

      if (shouldPixelate && ema) {
        // Average block color
        let rSum = 0, gSum = 0, bSum = 0, count = 0;
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const i = getBufferIndex(x, y, W);
            rSum += buf[i]; gSum += buf[i + 1]; bSum += buf[i + 2]; count++;
          }
        }
        const avgR = Math.round(rSum / count);
        const avgG = Math.round(gSum / count);
        const avgB = Math.round(bSum / count);
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const i = getBufferIndex(x, y, W);
            outBuf[i] = avgR; outBuf[i + 1] = avgG; outBuf[i + 2] = avgB; outBuf[i + 3] = 255;
          }
        }
      } else {
        // Pass through
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const i = getBufferIndex(x, y, W);
            outBuf[i] = buf[i]; outBuf[i + 1] = buf[i + 1]; outBuf[i + 2] = buf[i + 2]; outBuf[i + 3] = 255;
          }
        }
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Motion Pixelate", func: motionPixelate, optionTypes, options: defaults, defaults, description: "Moving areas become pixelated — privacy/censorship or artistic motion effect" };
