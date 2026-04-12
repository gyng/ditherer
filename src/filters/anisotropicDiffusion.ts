import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, srgbPaletteGetColor } from "utils";
import { defineFilter } from "filters/types";

const CONDUCTANCE_EXP = "EXP";
const CONDUCTANCE_QUADRATIC = "QUADRATIC";

export const optionTypes = {
  iterations: { type: RANGE, range: [1, 50], step: 1, default: 10, desc: "Number of diffusion passes" },
  kappa: { type: RANGE, range: [1, 200], step: 1, default: 30, desc: "Edge sensitivity — higher preserves weaker edges" },
  lambda: { type: RANGE, range: [0.05, 0.25], step: 0.01, default: 0.2, desc: "Diffusion rate per iteration" },
  conductance: {
    type: ENUM,
    options: [
      { name: "Exponential (sharp edges)", value: CONDUCTANCE_EXP },
      { name: "Quadratic (wide edges)", value: CONDUCTANCE_QUADRATIC }
    ],
    default: CONDUCTANCE_EXP,
    desc: "Edge-stopping function shape"
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  iterations: optionTypes.iterations.default,
  kappa: optionTypes.kappa.default,
  lambda: optionTypes.lambda.default,
  conductance: optionTypes.conductance.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const anisotropicDiffusion = (input, options = defaults) => {
  const { iterations, kappa, lambda, conductance, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  // Work in Float32 for precision
  const channels = 3;
  const grid = new Float32Array(W * H * channels);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const bi = getBufferIndex(x, y, W);
      const gi = (y * W + x) * channels;
      grid[gi]     = buf[bi];
      grid[gi + 1] = buf[bi + 1];
      grid[gi + 2] = buf[bi + 2];
    }
  }

  const c = (grad: number) =>
    conductance === CONDUCTANCE_EXP
      ? Math.exp(-((grad / kappa) ** 2))
      : 1 / (1 + (grad / kappa) ** 2);

  const next = new Float32Array(grid.length);

  for (let iter = 0; iter < iterations; iter += 1) {
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const gi = (y * W + x) * channels;
        const gN = ((Math.max(0, y - 1)) * W + x) * channels;
        const gS = ((Math.min(H - 1, y + 1)) * W + x) * channels;
        const gW = (y * W + Math.max(0, x - 1)) * channels;
        const gE = (y * W + Math.min(W - 1, x + 1)) * channels;

        for (let ch = 0; ch < channels; ch += 1) {
          const v = grid[gi + ch];
          const dN = grid[gN + ch] - v;
          const dS = grid[gS + ch] - v;
          const dW = grid[gW + ch] - v;
          const dE = grid[gE + ch] - v;
          next[gi + ch] = v + lambda * (
            c(dN) * dN + c(dS) * dS + c(dW) * dW + c(dE) * dE
          );
        }
      }
    }
    grid.set(next);
  }

  const outBuf = new Uint8ClampedArray(buf.length);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const bi = getBufferIndex(x, y, W);
      const gi = (y * W + x) * channels;
      const r = Math.round(Math.max(0, Math.min(255, grid[gi])));
      const g = Math.round(Math.max(0, Math.min(255, grid[gi + 1])));
      const b = Math.round(Math.max(0, Math.min(255, grid[gi + 2])));
      const col = srgbPaletteGetColor(palette, rgba(r, g, b, buf[bi + 3]), palette.options);
      fillBufferPixel(outBuf, bi, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Anisotropic diffusion",
  func: anisotropicDiffusion,
  options: defaults,
  optionTypes,
  defaults
});
