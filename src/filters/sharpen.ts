import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

export const optionTypes = {
  strength: { type: RANGE, range: [0, 5], step: 0.1, default: 1.5, desc: "Sharpening intensity applied via unsharp mask" },
  radius: { type: RANGE, range: [1, 20], step: 1, default: 3, desc: "Blur radius for the unsharp mask kernel" },
  threshold: { type: RANGE, range: [0, 50], step: 1, default: 0, desc: "Minimum difference required to sharpen a pixel" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  strength: optionTypes.strength.default,
  radius: optionTypes.radius.default,
  threshold: optionTypes.threshold.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const sharpenFilter = (input, options = defaults) => {
  const { strength, radius, threshold, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // Separable box blur — horizontal pass
  const blurH = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sr = 0, sg = 0, sb = 0, count = 0;
      for (let kx = -radius; kx <= radius; kx++) {
        const nx = Math.max(0, Math.min(W - 1, x + kx));
        const i = getBufferIndex(nx, y, W);
        sr += buf[i];
        sg += buf[i + 1];
        sb += buf[i + 2];
        count++;
      }
      const idx = (y * W + x) * 3;
      blurH[idx] = sr / count;
      blurH[idx + 1] = sg / count;
      blurH[idx + 2] = sb / count;
    }
  }

  // Vertical pass
  const blurred = new Float32Array(W * H * 3);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let sr = 0, sg = 0, sb = 0, count = 0;
      for (let ky = -radius; ky <= radius; ky++) {
        const ny = Math.max(0, Math.min(H - 1, y + ky));
        const idx = (ny * W + x) * 3;
        sr += blurH[idx];
        sg += blurH[idx + 1];
        sb += blurH[idx + 2];
        count++;
      }
      const idx = (y * W + x) * 3;
      blurred[idx] = sr / count;
      blurred[idx + 1] = sg / count;
      blurred[idx + 2] = sb / count;
    }
  }

  // Unsharp mask: output = original + (original - blurred) * strength
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const bIdx = (y * W + x) * 3;
      const dr = buf[i] - blurred[bIdx];
      const dg = buf[i + 1] - blurred[bIdx + 1];
      const db = buf[i + 2] - blurred[bIdx + 2];

      // Only sharpen if difference exceeds threshold
      const diff = Math.abs(dr) + Math.abs(dg) + Math.abs(db);
      if (diff < threshold * 3) {
        fillBufferPixel(outBuf, i, buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
        continue;
      }

      const r = Math.max(0, Math.min(255, Math.round(buf[i] + dr * strength)));
      const g = Math.max(0, Math.min(255, Math.round(buf[i + 1] + dg * strength)));
      const b = Math.max(0, Math.min(255, Math.round(buf[i + 2] + db * strength)));

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Sharpen",
  func: sharpenFilter,
  optionTypes,
  options: defaults,
  defaults
});
