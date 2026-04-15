import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor, logFilterBackend } from "utils";
import { applyPalettePassToCanvas } from "palettes/backend";
import { defineFilter } from "filters/types";
import { spherizeGLAvailable, renderSpherizeGL } from "./spherizeGL";

export const optionTypes = {
  strength: { type: RANGE, range: [-1, 1], step: 0.05, default: 0.5, desc: "Spherize (+) or flatten (-) intensity" },
  centerX: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Horizontal center of distortion" },
  centerY: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Vertical center of distortion" },
  radius: { type: RANGE, range: [0.1, 1.5], step: 0.05, default: 0.8, desc: "Affected area radius as fraction of image" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  strength: optionTypes.strength.default,
  centerX: optionTypes.centerX.default,
  centerY: optionTypes.centerY.default,
  radius: optionTypes.radius.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const spherize = (input: any, options = defaults) => {
  const { strength, centerX, centerY, radius, palette } = options;
  const W = input.width, H = input.height;

  if (
    spherizeGLAvailable()
    && (options as { _webglAcceleration?: boolean })._webglAcceleration !== false
  ) {
    const isNearest = (palette as { name?: string }).name === "nearest";
    const levels = isNearest ? ((palette as { options?: { levels?: number } }).options?.levels ?? 256) : 256;
    const rendered = renderSpherizeGL(input, W, H, strength, centerX, centerY, radius, levels);
    if (rendered) {
      const out = isNearest ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
      if (out) {
        logFilterBackend("Spherize", "WebGL2", `strength=${strength}${isNearest ? ` levels=${levels}` : "+palettePass"}`);
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

  const cx = W * centerX, cy = H * centerY;
  const maxDim = Math.max(W, H);
  const effectR = radius * maxDim / 2;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const di = getBufferIndex(x, y, W);

      if (dist >= effectR || effectR < 1) {
        fillBufferPixel(outBuf, di, buf[di], buf[di + 1], buf[di + 2], buf[di + 3]);
        continue;
      }

      // Spherize: remap based on sphere surface projection
      const normDist = dist / effectR; // 0 at center, 1 at edge
      const newDist = strength > 0
        ? Math.pow(normDist, 1 + strength) * effectR // inflate (pinch center)
        : Math.pow(normDist, 1 / (1 - strength)) * effectR; // deflate (bulge center)

      const scale = dist > 0 ? newDist / dist : 1;
      const sx = cx + dx * scale;
      const sy = cy + dy * scale;

      // Bilinear sample
      const sx0 = Math.floor(sx), sy0 = Math.floor(sy);
      const fx = sx - sx0, fy = sy - sy0;
      const sample = (ch: number) => {
        const get = (px: number, py: number) => buf[getBufferIndex(Math.max(0, Math.min(W - 1, px)), Math.max(0, Math.min(H - 1, py)), W) + ch];
        return get(sx0, sy0) * (1 - fx) * (1 - fy) + get(sx0 + 1, sy0) * fx * (1 - fy) + get(sx0, sy0 + 1) * (1 - fx) * fy + get(sx0 + 1, sy0 + 1) * fx * fy;
      };

      const color = paletteGetColor(palette, rgba(Math.round(sample(0)), Math.round(sample(1)), Math.round(sample(2)), Math.round(sample(3))), palette.options, false);
      fillBufferPixel(outBuf, di, color[0], color[1], color[2], Math.round(sample(3)));
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Spherize", func: spherize, optionTypes, options: defaults, defaults });
