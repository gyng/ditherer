import { RANGE, BOOL, ACTION } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { cloneCanvas, getBufferIndex } from "utils";

export const optionTypes = {
  blockSize: { type: RANGE, range: [4, 32], step: 2, default: 12, desc: "Pixelation block size for affected areas" },
  invert: { type: BOOL, default: false, desc: "Pixelate static areas instead of moving" },
  threshold: { type: RANGE, range: [1, 50], step: 1, default: 5, desc: "Motion sensitivity — lower = more reactive" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 15 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _f: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 15); }
  }},
};

export const defaults = {
  blockSize: optionTypes.blockSize.default,
  invert: optionTypes.invert.default,
  threshold: optionTypes.threshold.default,
  animSpeed: optionTypes.animSpeed.default,
};

type MotionPixelateOptions = FilterOptionValues & {
  blockSize?: number;
  invert?: boolean;
  threshold?: number;
  animSpeed?: number;
  _ema?: Float32Array | null;
};

const motionPixelate = (input: any, options: MotionPixelateOptions = defaults) => {
  const blockSize = Number(options.blockSize ?? defaults.blockSize);
  const invert = Boolean(options.invert ?? defaults.invert);
  const threshold = Number(options.threshold ?? defaults.threshold);
  const ema = options._ema ?? null;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // No EMA yet (filter just started, or not animating) — pass through
  if (!ema) {
    outBuf.set(buf);
    outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
    return output;
  }

  const blocksX = Math.ceil(W / blockSize);
  const blocksY = Math.ceil(H / blockSize);

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const startX = bx * blockSize, startY = by * blockSize;
      const endX = Math.min(startX + blockSize, W);
      const endY = Math.min(startY + blockSize, H);

      // Per-block average diff from EMA in 0–255 range (matches motionDetect)
      let diffSum = 0;
      let pixelCount = 0;
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const i = getBufferIndex(x, y, W);
          diffSum += (Math.abs(buf[i] - ema[i]) + Math.abs(buf[i + 1] - ema[i + 1]) + Math.abs(buf[i + 2] - ema[i + 2])) / 3;
          pixelCount++;
        }
      }
      const blockMotion = diffSum / Math.max(1, pixelCount);

      const shouldPixelate = invert ? (blockMotion < threshold) : (blockMotion > threshold);

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

export default defineFilter({ name: "Motion Pixelate", func: motionPixelate, optionTypes, options: defaults, defaults, description: "Moving areas become pixelated — privacy/censorship or artistic motion effect" , temporal: true });
