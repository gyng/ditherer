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
  angle: { type: RANGE, range: [-720, 720], step: 5, default: 180, desc: "Maximum rotation in degrees at the center of the swirl" },
  radius: { type: RANGE, range: [0, 1], step: 0.01, default: 0.8, desc: "Swirl area size as fraction of image diagonal" },
  centerX: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Horizontal center of the swirl (0=left, 1=right)" },
  centerY: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Vertical center of the swirl (0=top, 1=bottom)" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  angle: optionTypes.angle.default,
  radius: optionTypes.radius.default,
  centerX: optionTypes.centerX.default,
  centerY: optionTypes.centerY.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const swirlFilter = (input, options = defaults) => {
  const { angle, radius, centerX, centerY, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const cx = W * centerX;
  const cy = H * centerY;
  const maxDim = Math.max(W, H);
  const effectRadius = radius * maxDim;
  const angleRad = (angle * Math.PI) / 180;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dstIdx = getBufferIndex(x, y, W);
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let sx: number, sy: number;

      if (dist < effectRadius && effectRadius > 0) {
        const t = 1 - dist / effectRadius;
        const theta = angleRad * t * t; // quadratic falloff for smoother swirl
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        sx = cx + dx * cosT - dy * sinT;
        sy = cy + dx * sinT + dy * cosT;
      } else {
        sx = x;
        sy = y;
      }

      // Bilinear sample
      const sx0 = Math.floor(sx);
      const sy0 = Math.floor(sy);
      const sx1 = sx0 + 1;
      const sy1 = sy0 + 1;
      const fx = sx - sx0;
      const fy = sy - sy0;

      const sample = (ch: number) => {
        const get = (px: number, py: number) => {
          const cpx = Math.max(0, Math.min(W - 1, px));
          const cpy = Math.max(0, Math.min(H - 1, py));
          return buf[getBufferIndex(cpx, cpy, W) + ch];
        };
        return (
          get(sx0, sy0) * (1 - fx) * (1 - fy) +
          get(sx1, sy0) * fx * (1 - fy) +
          get(sx0, sy1) * (1 - fx) * fy +
          get(sx1, sy1) * fx * fy
        );
      };

      const r = Math.round(sample(0));
      const g = Math.round(sample(1));
      const b = Math.round(sample(2));
      const a = Math.round(sample(3));

      const color = paletteGetColor(palette, rgba(r, g, b, a), palette.options, false);
      fillBufferPixel(outBuf, dstIdx, color[0], color[1], color[2], a);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Swirl",
  func: swirlFilter,
  optionTypes,
  options: defaults,
  defaults
});
