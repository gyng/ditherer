import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

const MODE = {
  LOW: "LOW",
  HIGH: "HIGH",
  BAND: "BAND"
};

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Low-pass", value: MODE.LOW },
      { name: "High-pass", value: MODE.HIGH },
      { name: "Band-pass", value: MODE.BAND }
    ],
    default: MODE.HIGH,
    desc: "Which frequency band to keep"
  },
  radius: { type: RANGE, range: [1, 24], step: 1, default: 6, desc: "Approximate cutoff radius for the low-frequency blur" },
  bandWidth: { type: RANGE, range: [1, 24], step: 1, default: 6, desc: "Additional blur width used for the outer edge of band-pass mode" },
  gain: { type: RANGE, range: [0, 4], step: 0.05, default: 1.5, desc: "Boost the kept band before remapping back into the image" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  mode: optionTypes.mode.default,
  radius: optionTypes.radius.default,
  bandWidth: optionTypes.bandWidth.default,
  gain: optionTypes.gain.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

const boxBlur = (src: Uint8ClampedArray, width: number, height: number, radius: number) => {
  const tmp = new Float32Array(src.length);
  const out = new Uint8ClampedArray(src.length);
  const r = Math.max(1, Math.round(radius));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = getBufferIndex(x, y, width);
      for (let c = 0; c < 4; c += 1) {
        let sum = 0;
        let count = 0;
        for (let k = -r; k <= r; k += 1) {
          const sx = Math.max(0, Math.min(width - 1, x + k));
          sum += src[getBufferIndex(sx, y, width) + c];
          count += 1;
        }
        tmp[i + c] = sum / count;
      }
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = getBufferIndex(x, y, width);
      for (let c = 0; c < 4; c += 1) {
        let sum = 0;
        let count = 0;
        for (let k = -r; k <= r; k += 1) {
          const sy = Math.max(0, Math.min(height - 1, y + k));
          sum += tmp[getBufferIndex(x, sy, width) + c];
          count += 1;
        }
        out[i + c] = Math.round(sum / count);
      }
    }
  }

  return out;
};

const frequencyFilter = (input: any, options = defaults) => {
  const { mode, radius, bandWidth, gain, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const width = input.width;
  const height = input.height;
  const buf = inputCtx.getImageData(0, 0, width, height).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const lowA = boxBlur(buf, width, height, radius);
  const lowB = mode === MODE.BAND ? boxBlur(buf, width, height, radius + bandWidth) : null;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = getBufferIndex(x, y, width);
      let r = buf[i];
      let g = buf[i + 1];
      let b = buf[i + 2];

      if (mode === MODE.LOW) {
        r = lowA[i];
        g = lowA[i + 1];
        b = lowA[i + 2];
      } else if (mode === MODE.HIGH) {
        r = clamp255(128 + (buf[i] - lowA[i]) * gain);
        g = clamp255(128 + (buf[i + 1] - lowA[i + 1]) * gain);
        b = clamp255(128 + (buf[i + 2] - lowA[i + 2]) * gain);
      } else if (lowB) {
        r = clamp255(128 + (lowA[i] - lowB[i]) * gain);
        g = clamp255(128 + (lowA[i + 1] - lowB[i + 1]) * gain);
        b = clamp255(128 + (lowA[i + 2] - lowB[i + 2]) * gain);
      }

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, width, height), 0, 0);
  return output;
};

export default defineFilter({
  name: "Frequency Filter",
  func: frequencyFilter,
  optionTypes,
  options: defaults,
  defaults,
  description: "Approximate low, high, or mid-band frequency separation using spatial-domain filtering"
});
