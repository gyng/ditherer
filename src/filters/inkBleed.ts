import { RANGE, COLOR } from "constants/controlTypes";
import { cloneCanvas, getBufferIndex, clamp } from "utils";
import { defineFilter } from "filters/types";

export const optionTypes = {
  spread: { type: RANGE, range: [0, 12], step: 1, default: 3, desc: "How far dark ink blooms into neighboring paper fibers" },
  absorbency: { type: RANGE, range: [0, 1], step: 0.05, default: 0.35, desc: "How strongly paper softness pulls dark values outward" },
  paperTint: { type: COLOR, default: [242, 235, 217], desc: "Paper color blended underneath the spread ink" },
  grain: { type: RANGE, range: [0, 1], step: 0.05, default: 0.2, desc: "Paper texture amount added after the bleed pass" }
};

export const defaults = {
  spread: optionTypes.spread.default,
  absorbency: optionTypes.absorbency.default,
  paperTint: optionTypes.paperTint.default,
  grain: optionTypes.grain.default
};

const noise = (x: number, y: number) => {
  const n = Math.sin(x * 91.7 + y * 317.3) * 43758.5453;
  return n - Math.floor(n);
};

const inkBleed = (input: any, options = defaults) => {
  const { spread, absorbency, paperTint, grain } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const lum = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
      let darkest = lum;

      for (let ky = -spread; ky <= spread; ky++) {
        for (let kx = -spread; kx <= spread; kx++) {
          const nx = clamp(0, W - 1, x + kx);
          const ny = clamp(0, H - 1, y + ky);
          const ni = getBufferIndex(nx, ny, W);
          const neighborLum = 0.2126 * buf[ni] + 0.7152 * buf[ni + 1] + 0.0722 * buf[ni + 2];
          const dist = Math.sqrt(kx * kx + ky * ky);
          const weight = Math.max(0, 1 - dist / Math.max(1, spread));
          darkest = Math.min(darkest, lum * (1 - absorbency * weight) + neighborLum * absorbency * weight);
        }
      }

      const inkAmount = 1 - darkest / 255;
      const grainJitter = (noise(x, y) - 0.5) * grain * 40;

      outBuf[i] = Math.round(paperTint[0] * (1 - inkAmount) + Math.max(0, buf[i] + grainJitter) * inkAmount);
      outBuf[i + 1] = Math.round(paperTint[1] * (1 - inkAmount) + Math.max(0, buf[i + 1] + grainJitter) * inkAmount);
      outBuf[i + 2] = Math.round(paperTint[2] * (1 - inkAmount) + Math.max(0, buf[i + 2] + grainJitter) * inkAmount);
      outBuf[i + 3] = 255;
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Ink Bleed",
  func: inkBleed,
  optionTypes,
  options: defaults,
  defaults
});
