import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

export const optionTypes = {
  amplitude: { type: RANGE, range: [1, 50], step: 1, default: 10, desc: "Wave height in pixels" },
  wavelength: { type: RANGE, range: [5, 100], step: 1, default: 30, desc: "Distance between wave peaks" },
  centerX: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Horizontal center of ripple origin" },
  centerY: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Vertical center of ripple origin" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  amplitude: optionTypes.amplitude.default,
  wavelength: optionTypes.wavelength.default,
  centerX: optionTypes.centerX.default,
  centerY: optionTypes.centerY.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const rippleFilter = (input: any, options = defaults) => {
  const { amplitude, wavelength, centerX, centerY, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const cx = W * centerX, cy = H * centerY;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) {
        const i = getBufferIndex(x, y, W);
        fillBufferPixel(outBuf, i, buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
        continue;
      }

      const displacement = Math.sin(dist * 2 * Math.PI / wavelength) * amplitude;
      const sx = x + dx / dist * displacement;
      const sy = y + dy / dist * displacement;

      // Bilinear sample
      const sx0 = Math.floor(sx), sy0 = Math.floor(sy);
      const fx = sx - sx0, fy = sy - sy0;
      const sample = (ch: number) => {
        const get = (px: number, py: number) => buf[getBufferIndex(Math.max(0, Math.min(W - 1, px)), Math.max(0, Math.min(H - 1, py)), W) + ch];
        return get(sx0, sy0) * (1 - fx) * (1 - fy) + get(sx0 + 1, sy0) * fx * (1 - fy) + get(sx0, sy0 + 1) * (1 - fx) * fy + get(sx0 + 1, sy0 + 1) * fx * fy;
      };

      const di = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(Math.round(sample(0)), Math.round(sample(1)), Math.round(sample(2)), Math.round(sample(3))), palette.options, false);
      fillBufferPixel(outBuf, di, color[0], color[1], color[2], Math.round(sample(3)));
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Ripple", func: rippleFilter, optionTypes, options: defaults, defaults });
