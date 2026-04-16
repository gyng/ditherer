import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
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
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { posterizeDitherGLAvailable, renderPosterizeDitherGL } from "./posterizeDitherGL";

const MATRIX_SIZE = { "2x2": "2x2", "4x4": "4x4", "8x8": "8x8" };

// Build Bayer matrix of a given order recursively
const buildBayer = (order: number): number[][] => {
  if (order === 1) {
    return [[0, 2], [3, 1]];
  }
  const prev = buildBayer(order - 1);
  const n = prev.length;
  const size = n * 2;
  const result: number[][] = [];
  for (let y = 0; y < size; y++) {
    result[y] = [];
    for (let x = 0; x < size; x++) {
      const py = y % n;
      const px = x % n;
      const quadrant =
        (y < n ? 0 : 2) + (x < n ? 0 : 1);
      const base = [0, 2, 3, 1][quadrant];
      result[y][x] = 4 * prev[py][px] + base;
    }
  }
  return result;
};

const getBayerMatrix = (sizeStr: string): { matrix: number[][]; n: number } => {
  let order: number;
  if (sizeStr === "2x2") order = 1;
  else if (sizeStr === "4x4") order = 2;
  else order = 3; // 8x8
  const matrix = buildBayer(order);
  const n = matrix.length;
  return { matrix, n };
};

export const optionTypes = {
  levelsR: { type: RANGE, range: [2, 16], step: 1, default: 4, desc: "Quantization levels for red" },
  levelsG: { type: RANGE, range: [2, 16], step: 1, default: 4, desc: "Quantization levels for green" },
  levelsB: { type: RANGE, range: [2, 16], step: 1, default: 4, desc: "Quantization levels for blue" },
  matrixSize: {
    type: ENUM,
    options: [
      { name: "2x2", value: MATRIX_SIZE["2x2"] },
      { name: "4x4", value: MATRIX_SIZE["4x4"] },
      { name: "8x8", value: MATRIX_SIZE["8x8"] }
    ],
    default: MATRIX_SIZE["4x4"],
    desc: "Bayer dither matrix size"
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  levelsR: optionTypes.levelsR.default,
  levelsG: optionTypes.levelsG.default,
  levelsB: optionTypes.levelsB.default,
  matrixSize: optionTypes.matrixSize.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const clamp = (v: number): number => Math.max(0, Math.min(255, v));

type PosterizeDitherOptions = typeof defaults & { _webglAcceleration?: boolean };

const posterizeDither = (
  input: any,
  options: PosterizeDitherOptions = defaults
) => {
  const {
    levelsR,
    levelsG,
    levelsB,
    matrixSize,
    palette
  } = options;

  const W = input.width;
  const H = input.height;
  const { matrix, n } = getBayerMatrix(matrixSize);

  if (options._webglAcceleration !== false && posterizeDitherGLAvailable()) {
    const rendered = renderPosterizeDitherGL(input, W, H, matrix, n, levelsR, levelsG, levelsB);
    if (rendered) {
      const identity = paletteIsIdentity(palette);
      const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
      if (out) {
        logFilterBackend("Posterize Dither", "WebGL2", `matrix=${matrixSize}${identity ? "" : "+palettePass"}`);
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

  const maxVal = n * n;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      // Bayer threshold normalized to -0.5..0.5
      const threshold = (matrix[y % n][x % n] / maxVal) - 0.5;

      // Per-channel dithering and quantization
      const rIn = buf[i] / 255 + threshold / levelsR;
      const gIn = buf[i + 1] / 255 + threshold / levelsG;
      const bIn = buf[i + 2] / 255 + threshold / levelsB;

      const r = clamp(Math.round(rIn * (levelsR - 1)) / (levelsR - 1) * 255);
      const g = clamp(Math.round(gIn * (levelsG - 1)) / (levelsG - 1) * 255);
      const b = clamp(Math.round(bIn * (levelsB - 1)) / (levelsB - 1) * 255);

      const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);

  return output;
};

export default defineFilter({
  name: "Posterize Dither",
  func: posterizeDither,
  options: defaults,
  optionTypes,
  defaults
});
