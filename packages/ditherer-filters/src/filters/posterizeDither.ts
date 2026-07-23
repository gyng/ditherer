import { RANGE, ENUM, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { defineFilter } from "./types";
import { logFilterBackend } from "../utils/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { renderPosterizeDitherGL } from "./posterizeDitherGL";

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
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette and quantization" }
};

export const defaults = {
  levelsR: optionTypes.levelsR.default,
  levelsG: optionTypes.levelsG.default,
  levelsB: optionTypes.levelsB.default,
  matrixSize: optionTypes.matrixSize.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const posterizeDither = (
  input: any,
  options: Partial<typeof defaults> = defaults
) => {
  const level = (value: unknown, fallback: number) => {
    const parsed = typeof value === "number" ? value : Number.NaN;
    return Math.round(Math.max(2, Math.min(16, Number.isFinite(parsed) ? parsed : fallback)));
  };
  const levelsR = level(options.levelsR, defaults.levelsR);
  const levelsG = level(options.levelsG, defaults.levelsG);
  const levelsB = level(options.levelsB, defaults.levelsB);
  const matrixSize = Object.values(MATRIX_SIZE).includes(options.matrixSize as string)
    ? options.matrixSize as string
    : defaults.matrixSize;
  const palette = options.palette ?? defaults.palette;

  const W = input.width;
  const H = input.height;
  const { matrix, n } = getBayerMatrix(matrixSize);

  const rendered = renderPosterizeDitherGL(input, W, H, matrix, n, levelsR, levelsG, levelsB);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Posterize Dither", "WebGL2", `matrix=${matrixSize}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Posterize Dither",
  func: posterizeDither,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true });
