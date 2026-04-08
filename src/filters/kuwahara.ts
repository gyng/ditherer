import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  radius: { type: RANGE, range: [1, 16], step: 1, default: 3 },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  radius: optionTypes.radius.default,
  palette: optionTypes.palette.default
};

// Build a summed-area table (SAT) for one channel
const buildSat = (buf: Uint8ClampedArray, W: number, H: number, ch: number): Float64Array => {
  const sat = new Float64Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const v = buf[getBufferIndex(x, y, W) + ch];
      sat[y * W + x] = v
        + (x > 0 ? sat[y * W + (x - 1)] : 0)
        + (y > 0 ? sat[(y - 1) * W + x] : 0)
        - (x > 0 && y > 0 ? sat[(y - 1) * W + (x - 1)] : 0);
    }
  }
  return sat;
};

// Build a SAT for squared values (for variance computation)
const buildSatSq = (buf: Uint8ClampedArray, W: number, H: number, ch: number): Float64Array => {
  const sat = new Float64Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const v = buf[getBufferIndex(x, y, W) + ch];
      sat[y * W + x] = v * v
        + (x > 0 ? sat[y * W + (x - 1)] : 0)
        + (y > 0 ? sat[(y - 1) * W + x] : 0)
        - (x > 0 && y > 0 ? sat[(y - 1) * W + (x - 1)] : 0);
    }
  }
  return sat;
};

// Query a rectangular region sum from a SAT in O(1)
const rectSum = (sat: Float64Array, W: number, x0: number, y0: number, x1: number, y1: number): number => {
  const s = sat[y1 * W + x1];
  const a = x0 > 0 ? sat[y1 * W + (x0 - 1)] : 0;
  const b = y0 > 0 ? sat[(y0 - 1) * W + x1] : 0;
  const c = x0 > 0 && y0 > 0 ? sat[(y0 - 1) * W + (x0 - 1)] : 0;
  return s - a - b + c;
};

const kuwahara = (input, options = defaults) => {
  const { radius, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const r = Math.max(1, Math.round(radius));

  // Build SATs for all three channels (sum and sum-of-squares)
  const satR  = buildSat(buf, W, H, 0);
  const satG  = buildSat(buf, W, H, 1);
  const satB  = buildSat(buf, W, H, 2);
  const satR2 = buildSatSq(buf, W, H, 0);
  const satG2 = buildSatSq(buf, W, H, 1);
  const satB2 = buildSatSq(buf, W, H, 2);

  // Four Kuwahara quadrants: [x_min_offset, x_max_offset, y_min_offset, y_max_offset]
  const QUADRANTS = [
    [-r, 0, -r, 0],
    [0, r, -r, 0],
    [-r, 0, 0, r],
    [0, r, 0, r]
  ] as const;

  const outBuf = new Uint8ClampedArray(buf.length);

  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      let bestVar = Infinity;
      let bestR = 0, bestG = 0, bestB = 0;

      for (const [qx0, qx1, qy0, qy1] of QUADRANTS) {
        const x0 = Math.max(0, x + qx0);
        const x1 = Math.min(W - 1, x + qx1);
        const y0 = Math.max(0, y + qy0);
        const y1 = Math.min(H - 1, y + qy1);
        const n = (x1 - x0 + 1) * (y1 - y0 + 1);
        if (n === 0) continue;

        const sr  = rectSum(satR,  W, x0, y0, x1, y1);
        const sg  = rectSum(satG,  W, x0, y0, x1, y1);
        const sb  = rectSum(satB,  W, x0, y0, x1, y1);
        const sr2 = rectSum(satR2, W, x0, y0, x1, y1);
        const sg2 = rectSum(satG2, W, x0, y0, x1, y1);
        const sb2 = rectSum(satB2, W, x0, y0, x1, y1);

        const mr = sr / n, mg = sg / n, mb = sb / n;
        const variance = (sr2 / n - mr * mr) + (sg2 / n - mg * mg) + (sb2 / n - mb * mb);

        if (variance < bestVar) {
          bestVar = variance;
          bestR = mr; bestG = mg; bestB = mb;
        }
      }

      const i = getBufferIndex(x, y, W);
      const col = paletteGetColor(
        palette,
        rgba(Math.round(bestR), Math.round(bestG), Math.round(bestB), buf[i + 3]),
        palette.options,
        options._linearize
      );
      fillBufferPixel(outBuf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Kuwahara",
  func: kuwahara,
  options: defaults,
  optionTypes,
  defaults
};
