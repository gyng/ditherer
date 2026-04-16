import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor, logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { flowFieldGLAvailable, renderFlowFieldGL } from "./flowFieldGL";

export const optionTypes = {
  scale: { type: RANGE, range: [5, 200], step: 5, default: 50, desc: "Flow noise feature size" },
  strength: { type: RANGE, range: [0, 50], step: 1, default: 15, desc: "Pixel displacement distance" },
  steps: { type: RANGE, range: [1, 20], step: 1, default: 5, desc: "Flow advection iterations" },
  seed: { type: RANGE, range: [0, 999], step: 1, default: 42, desc: "Random seed for flow pattern" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  scale: optionTypes.scale.default,
  strength: optionTypes.strength.default,
  steps: optionTypes.steps.default,
  seed: optionTypes.seed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const hash = (x: number, y: number, seed: number) => {
  let h = seed + x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
};

const noise2d = (px: number, py: number, seed: number) => {
  const x0 = Math.floor(px), y0 = Math.floor(py);
  const fx = px - x0, fy = py - y0;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const n00 = hash(x0, y0, seed) * 2 - 1;
  const n10 = hash(x0 + 1, y0, seed) * 2 - 1;
  const n01 = hash(x0, y0 + 1, seed) * 2 - 1;
  const n11 = hash(x0 + 1, y0 + 1, seed) * 2 - 1;
  return n00 * (1 - u) * (1 - v) + n10 * u * (1 - v) + n01 * (1 - u) * v + n11 * u * v;
};

// Curl noise: divergence-free 2D flow from scalar noise
const curlAngle = (px: number, py: number, seed: number) => {
  const eps = 0.01;
  const dndx = (noise2d(px + eps, py, seed) - noise2d(px - eps, py, seed)) / (2 * eps);
  const dndy = (noise2d(px, py + eps, seed) - noise2d(px, py - eps, seed)) / (2 * eps);
  return Math.atan2(dndx, -dndy);
};

type FlowFieldOptions = typeof defaults & { _webglAcceleration?: boolean };

const flowField = (input: any, options: FlowFieldOptions = defaults) => {
  const { scale, strength, steps, seed, palette } = options;
  const W = input.width, H = input.height;

  if (options._webglAcceleration !== false && flowFieldGLAvailable()) {
    const rendered = renderFlowFieldGL(input, W, H, scale, strength, steps, seed);
    if (rendered) {
      const identity = paletteIsIdentity(palette);
      const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
      if (out) {
        logFilterBackend("Flow Field", "WebGL2", `scale=${scale} strength=${strength} steps=${steps}${identity ? "" : "+palettePass"}`);
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
  const stepDist = strength / Math.max(1, steps);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let px = x, py = y;
      let sr = 0, sg = 0, sb = 0, sa = 0;

      // Sample original position
      const oi = getBufferIndex(x, y, W);
      sr += buf[oi]; sg += buf[oi + 1]; sb += buf[oi + 2]; sa += buf[oi + 3];

      // Trace along flow field
      for (let s = 0; s < steps; s++) {
        const angle = curlAngle(px / scale, py / scale, seed);
        px += Math.cos(angle) * stepDist;
        py += Math.sin(angle) * stepDist;

        // Bilinear sample at traced position
        const sx = Math.max(0, Math.min(W - 1, px));
        const sy = Math.max(0, Math.min(H - 1, py));
        const sx0 = Math.floor(sx), sy0 = Math.floor(sy);
        const sx1 = Math.min(sx0 + 1, W - 1), sy1 = Math.min(sy0 + 1, H - 1);
        const fx = sx - sx0, fy = sy - sy0;

        for (let ch = 0; ch < 4; ch++) {
          const v = buf[getBufferIndex(sx0, sy0, W) + ch] * (1-fx) * (1-fy) +
                    buf[getBufferIndex(sx1, sy0, W) + ch] * fx * (1-fy) +
                    buf[getBufferIndex(sx0, sy1, W) + ch] * (1-fx) * fy +
                    buf[getBufferIndex(sx1, sy1, W) + ch] * fx * fy;
          if (ch === 0) sr += v;
          else if (ch === 1) sg += v;
          else if (ch === 2) sb += v;
          else sa += v;
        }
      }

      const n = steps + 1;
      const di = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(
        Math.round(sr / n), Math.round(sg / n), Math.round(sb / n), Math.round(sa / n)
      ), palette.options, false);
      fillBufferPixel(outBuf, di, color[0], color[1], color[2], Math.round(sa / n));
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Flow Field", func: flowField, optionTypes, options: defaults, defaults });
