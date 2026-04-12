import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

const MODE = {
  HORIZONTAL: "HORIZONTAL",
  VERTICAL: "VERTICAL",
  BOTH: "BOTH",
  KALEIDOSCOPE: "KALEIDOSCOPE"
};

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [
      { name: "Horizontal", value: MODE.HORIZONTAL },
      { name: "Vertical", value: MODE.VERTICAL },
      { name: "Both", value: MODE.BOTH },
      { name: "Kaleidoscope", value: MODE.KALEIDOSCOPE }
    ],
    default: MODE.KALEIDOSCOPE,
    desc: "Mirror mode — simple flip or kaleidoscope"
  },
  segments: { type: RANGE, range: [2, 16], step: 1, default: 6, desc: "Number of kaleidoscope wedge segments" },
  offsetX: { type: RANGE, range: [-1, 1], step: 0.01, default: 0, desc: "Horizontal center offset" },
  offsetY: { type: RANGE, range: [-1, 1], step: 0.01, default: 0, desc: "Vertical center offset" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  mode: optionTypes.mode.default,
  segments: optionTypes.segments.default,
  offsetX: optionTypes.offsetX.default,
  offsetY: optionTypes.offsetY.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const mirror = (input, options = defaults) => {
  const { mode, segments, offsetX, offsetY, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const cx = W * (0.5 + offsetX * 0.5);
  const cy = H * (0.5 + offsetY * 0.5);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sx = x, sy = y;

      if (mode === MODE.KALEIDOSCOPE) {
        const dx = x - cx;
        const dy = y - cy;
        let angle = Math.atan2(dy, dx);
        const dist = Math.sqrt(dx * dx + dy * dy);
        const sliceAngle = (2 * Math.PI) / segments;

        // Fold angle into first slice
        angle = ((angle % sliceAngle) + sliceAngle) % sliceAngle;
        // Reflect alternating slices
        if (angle > sliceAngle / 2) {
          angle = sliceAngle - angle;
        }

        sx = Math.round(cx + Math.cos(angle) * dist);
        sy = Math.round(cy + Math.sin(angle) * dist);
      } else {
        if (mode === MODE.HORIZONTAL || mode === MODE.BOTH) {
          if (x > cx) sx = Math.round(2 * cx - x);
        }
        if (mode === MODE.VERTICAL || mode === MODE.BOTH) {
          if (y > cy) sy = Math.round(2 * cy - y);
        }
      }

      // Clamp to image bounds
      sx = Math.max(0, Math.min(W - 1, sx));
      sy = Math.max(0, Math.min(H - 1, sy));

      const srcIdx = getBufferIndex(sx, sy, W);
      const dstIdx = getBufferIndex(x, y, W);
      const r = buf[srcIdx], g = buf[srcIdx + 1], b = buf[srcIdx + 2], a = buf[srcIdx + 3];

      const color = paletteGetColor(palette, rgba(r, g, b, a), palette.options, false);
      fillBufferPixel(outBuf, dstIdx, color[0], color[1], color[2], a);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Mirror",
  func: mirror,
  optionTypes,
  options: defaults,
  defaults
});
