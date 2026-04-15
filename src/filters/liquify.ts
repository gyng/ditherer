import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  logFilterBackend,
} from "utils";
import { applyPalettePassToCanvas } from "palettes/backend";
import { liquifyGLAvailable, renderLiquifyGL } from "./liquifyGL";

export const optionTypes = {
  strength: { type: RANGE, range: [0, 100], step: 1, default: 20, desc: "Maximum warp displacement" },
  smoothness: { type: RANGE, range: [1, 20], step: 1, default: 5, desc: "Blur radius controlling warp smoothness" },
  direction: { type: RANGE, range: [0, 360], step: 5, default: 90, desc: "Push direction in degrees" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  strength: optionTypes.strength.default,
  smoothness: optionTypes.smoothness.default,
  direction: optionTypes.direction.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const liquify = (input: any, options = defaults) => {
  const { strength, smoothness, direction, palette } = options;
  const W = input.width;
  const H = input.height;

  if (
    liquifyGLAvailable()
    && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false
  ) {
    const isNearest = (palette as { name?: string }).name === "nearest";
    const levels = isNearest ? ((palette as { options?: { levels?: number } }).options?.levels ?? 256) : 256;
    const rendered = renderLiquifyGL(input, W, H, strength, smoothness, direction, levels);
    if (rendered) {
      const out = isNearest ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
      if (out) {
        logFilterBackend("Liquify", "WebGL2", `strength=${strength} smoothness=${smoothness}${isNearest ? "" : "+palettePass"}`);
        return out;
      }
    }
  }

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // Compute luminance
  const lum = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      lum[y * W + x] = (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255;
    }
  }

  // Blur luminance for smooth displacement
  const blurR = smoothness;
  const blurred = new Float32Array(W * H);
  // Horizontal
  const tempH = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0, cnt = 0;
      for (let k = -blurR; k <= blurR; k++) {
        const nx = Math.max(0, Math.min(W - 1, x + k));
        sum += lum[y * W + nx]; cnt++;
      }
      tempH[y * W + x] = sum / cnt;
    }
  }
  // Vertical
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0, cnt = 0;
      for (let k = -blurR; k <= blurR; k++) {
        const ny = Math.max(0, Math.min(H - 1, y + k));
        sum += tempH[ny * W + x]; cnt++;
      }
      blurred[y * W + x] = sum / cnt;
    }
  }

  // Compute gradients for displacement
  const dirRad = (direction * Math.PI) / 180;
  const cosD = Math.cos(dirRad);
  const sinD = Math.sin(dirRad);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Gradient
      const l = blurred[y * W + Math.max(0, x - 1)];
      const r = blurred[y * W + Math.min(W - 1, x + 1)];
      const t = blurred[Math.max(0, y - 1) * W + x];
      const b = blurred[Math.min(H - 1, y + 1) * W + x];
      const gx = (r - l) * 0.5;
      const gy = (b - t) * 0.5;

      // Project gradient onto direction
      const proj = gx * cosD + gy * sinD;
      const dispX = proj * strength * cosD;
      const dispY = proj * strength * sinD;

      // Bilinear sample from displaced position
      const sx = x - dispX;
      const sy = y - dispY;
      const sx0 = Math.floor(sx);
      const sy0 = Math.floor(sy);
      const fx = sx - sx0;
      const fy = sy - sy0;

      const sample = (ch: number) => {
        const get = (px: number, py: number) => {
          const cpx = Math.max(0, Math.min(W - 1, px));
          const cpy = Math.max(0, Math.min(H - 1, py));
          return buf[getBufferIndex(cpx, cpy, W) + ch];
        };
        return get(sx0, sy0) * (1 - fx) * (1 - fy) +
               get(sx0 + 1, sy0) * fx * (1 - fy) +
               get(sx0, sy0 + 1) * (1 - fx) * fy +
               get(sx0 + 1, sy0 + 1) * fx * fy;
      };

      const di = getBufferIndex(x, y, W);
      const cr = Math.round(sample(0));
      const cg = Math.round(sample(1));
      const cb = Math.round(sample(2));
      const ca = Math.round(sample(3));

      const color = paletteGetColor(palette, rgba(cr, cg, cb, ca), palette.options, false);
      fillBufferPixel(outBuf, di, color[0], color[1], color[2], ca);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Liquify",
  func: liquify,
  optionTypes,
  options: defaults,
  defaults
});
