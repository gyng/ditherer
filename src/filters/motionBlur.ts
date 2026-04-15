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
import { motionBlurGLAvailable, renderMotionBlurGL } from "./motionBlurGL";

export const optionTypes = {
  angle: { type: RANGE, range: [0, 360], step: 5, default: 0, desc: "Direction of the blur in degrees" },
  length: { type: RANGE, range: [1, 50], step: 1, default: 10, desc: "Number of pixels sampled along the blur direction" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  angle: optionTypes.angle.default,
  length: optionTypes.length.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const motionBlurFilter = (input: any, options = defaults) => {
  const { angle, length, palette } = options;
  const W = input.width;
  const H = input.height;

  if (
    motionBlurGLAvailable()
    && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false
  ) {
    const isNearest = (palette as { name?: string }).name === "nearest";
    const levels = isNearest ? ((palette as { options?: { levels?: number } }).options?.levels ?? 256) : 256;
    const rendered = renderMotionBlurGL(input, W, H, angle, length, levels);
    if (rendered) {
      const out = isNearest ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
      if (out) {
        logFilterBackend("Motion Blur", "WebGL2", `angle=${angle} length=${length}${isNearest ? "" : "+palettePass"}`);
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

  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const halfLen = length / 2;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sr = 0, sg = 0, sb = 0, sa = 0;
      let count = 0;

      for (let t = -halfLen; t <= halfLen; t++) {
        const sx = x + t * dx;
        const sy = y + t * dy;

        // Bilinear sample
        const sx0 = Math.floor(sx);
        const sy0 = Math.floor(sy);
        if (sx0 < 0 || sx0 >= W - 1 || sy0 < 0 || sy0 >= H - 1) {
          // Clamp to edge
          const cx = Math.max(0, Math.min(W - 1, Math.round(sx)));
          const cy = Math.max(0, Math.min(H - 1, Math.round(sy)));
          const ci = getBufferIndex(cx, cy, W);
          sr += buf[ci]; sg += buf[ci + 1]; sb += buf[ci + 2]; sa += buf[ci + 3];
        } else {
          const fx = sx - sx0;
          const fy = sy - sy0;
          const i00 = getBufferIndex(sx0, sy0, W);
          const i10 = getBufferIndex(sx0 + 1, sy0, W);
          const i01 = getBufferIndex(sx0, sy0 + 1, W);
          const i11 = getBufferIndex(sx0 + 1, sy0 + 1, W);
          for (let ch = 0; ch < 4; ch++) {
            const v = buf[i00 + ch] * (1 - fx) * (1 - fy) +
                      buf[i10 + ch] * fx * (1 - fy) +
                      buf[i01 + ch] * (1 - fx) * fy +
                      buf[i11 + ch] * fx * fy;
            if (ch === 0) sr += v;
            else if (ch === 1) sg += v;
            else if (ch === 2) sb += v;
            else sa += v;
          }
        }
        count++;
      }

      const di = getBufferIndex(x, y, W);
      const r = Math.round(sr / count);
      const g = Math.round(sg / count);
      const b = Math.round(sb / count);
      const a = Math.round(sa / count);

      const color = paletteGetColor(palette, rgba(r, g, b, a), palette.options, false);
      fillBufferPixel(outBuf, di, color[0], color[1], color[2], a);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Motion Blur",
  func: motionBlurFilter,
  optionTypes,
  options: defaults,
  defaults
});
