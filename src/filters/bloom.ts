import { RANGE } from "constants/controlTypes";
import { cloneCanvas, getBufferIndex } from "utils";

export const optionTypes = {
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 180 },
  strength: { type: RANGE, range: [0, 3], step: 0.05, default: 0.8 },
  radius: { type: RANGE, range: [1, 30], step: 1, default: 8 }
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  strength: optionTypes.strength.default,
  radius: optionTypes.radius.default
};

const bloom = (input, options = defaults) => {
  const { threshold, strength, radius } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  // Extract pixels above threshold
  const bright = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i += 4) {
    bright[i]     = Math.max(0, buf[i]     - threshold);
    bright[i + 1] = Math.max(0, buf[i + 1] - threshold);
    bright[i + 2] = Math.max(0, buf[i + 2] - threshold);
    bright[i + 3] = buf[i + 3];
  }

  // Separable box blur: horizontal pass
  const blurH = new Float32Array(buf.length);
  const r = radius;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      let sr = 0, sg = 0, sb = 0;
      let count = 0;
      for (let kx = -r; kx <= r; kx += 1) {
        const nx = Math.max(0, Math.min(W - 1, x + kx));
        const ki = getBufferIndex(nx, y, W);
        sr += bright[ki];
        sg += bright[ki + 1];
        sb += bright[ki + 2];
        count += 1;
      }
      const i = getBufferIndex(x, y, W);
      blurH[i]     = sr / count;
      blurH[i + 1] = sg / count;
      blurH[i + 2] = sb / count;
      blurH[i + 3] = bright[i + 3];
    }
  }

  // Vertical pass
  const blurHV = new Float32Array(buf.length);
  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      let sr = 0, sg = 0, sb = 0;
      let count = 0;
      for (let ky = -r; ky <= r; ky += 1) {
        const ny = Math.max(0, Math.min(H - 1, y + ky));
        const ki = getBufferIndex(x, ny, W);
        sr += blurH[ki];
        sg += blurH[ki + 1];
        sb += blurH[ki + 2];
        count += 1;
      }
      const i = getBufferIndex(x, y, W);
      blurHV[i]     = sr / count;
      blurHV[i + 1] = sg / count;
      blurHV[i + 2] = sb / count;
      blurHV[i + 3] = blurH[i + 3];
    }
  }

  // Composite: original + bloom * strength (additive)
  const outBuf = new Uint8ClampedArray(buf.length);
  for (let i = 0; i < buf.length; i += 4) {
    outBuf[i]     = Math.min(255, buf[i]     + blurHV[i]     * strength);
    outBuf[i + 1] = Math.min(255, buf[i + 1] + blurHV[i + 1] * strength);
    outBuf[i + 2] = Math.min(255, buf[i + 2] + blurHV[i + 2] * strength);
    outBuf[i + 3] = buf[i + 3];
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Bloom",
  func: bloom,
  options: defaults,
  optionTypes,
  defaults
};
