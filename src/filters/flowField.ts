import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderFlowFieldGL } from "./flowFieldGL";

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

const flowField = (input: any, options: typeof defaults = defaults) => {
  const { scale, strength, steps, seed, palette } = options;
  const W = input.width, H = input.height;

  const rendered = renderFlowFieldGL(input, W, H, scale, strength, steps, seed);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Flow Field", "WebGL2", `scale=${scale} strength=${strength} steps=${steps}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({ name: "Flow Field", func: flowField, optionTypes, options: defaults, defaults });
