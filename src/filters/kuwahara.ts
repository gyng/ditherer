import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, srgbPaletteGetColor } from "utils";
import { defineFilter } from "filters/types";

export const optionTypes = {
  radius: { type: RANGE, range: [1, 16], step: 1, default: 3, desc: "Filter kernel radius — larger = more painterly" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  radius: optionTypes.radius.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const buildKuwaharaSats = (buf: Uint8ClampedArray, W: number, H: number) => {
  const stride = W + 1;
  const size = stride * (H + 1);
  const satR = new Float64Array(size);
  const satG = new Float64Array(size);
  const satB = new Float64Array(size);
  const satR2 = new Float64Array(size);
  const satG2 = new Float64Array(size);
  const satB2 = new Float64Array(size);

  for (let y = 1; y <= H; y += 1) {
    let rowR = 0;
    let rowG = 0;
    let rowB = 0;
    let rowR2 = 0;
    let rowG2 = 0;
    let rowB2 = 0;
    const srcRow = (y - 1) * W * 4;
    const satRow = y * stride;
    const prevSatRow = (y - 1) * stride;

    for (let x = 1; x <= W; x += 1) {
      const src = srcRow + (x - 1) * 4;
      const r = buf[src];
      const g = buf[src + 1];
      const b = buf[src + 2];

      rowR += r;
      rowG += g;
      rowB += b;
      rowR2 += r * r;
      rowG2 += g * g;
      rowB2 += b * b;

      const dst = satRow + x;
      satR[dst] = satR[prevSatRow + x] + rowR;
      satG[dst] = satG[prevSatRow + x] + rowG;
      satB[dst] = satB[prevSatRow + x] + rowB;
      satR2[dst] = satR2[prevSatRow + x] + rowR2;
      satG2[dst] = satG2[prevSatRow + x] + rowG2;
      satB2[dst] = satB2[prevSatRow + x] + rowB2;
    }
  }

  return { stride, satR, satG, satB, satR2, satG2, satB2 };
};

const kuwahara = (input: any, options = defaults) => {
  const { radius, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const r = Math.max(1, Math.round(radius));

  const { stride, satR, satG, satB, satR2, satG2, satB2 } = buildKuwaharaSats(buf, W, H);

  // Four Kuwahara quadrants: [x_min_offset, x_max_offset, y_min_offset, y_max_offset]
  const QUADRANTS = [
    [-r, 0, -r, 0],
    [0, r, -r, 0],
    [-r, 0, 0, r],
    [0, r, 0, r]
  ] as const;

  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      let bestVar = Infinity;
      let bestR = 0, bestG = 0, bestB = 0;

      for (const [qx0, qx1, qy0, qy1] of QUADRANTS) {
        const x0 = Math.max(0, x + qx0);
        const x1 = Math.min(W - 1, x + qx1);
        const y0 = Math.max(0, y + qy0);
        const y1 = Math.min(H - 1, y + qy1);
        const n = (x1 - x0 + 1) * (y1 - y0 + 1);
        if (n === 0) continue;

        const xa = x0;
        const xb = x1 + 1;
        const ya = y0;
        const yb = y1 + 1;
        const topLeft = ya * stride + xa;
        const topRight = ya * stride + xb;
        const bottomLeft = yb * stride + xa;
        const bottomRight = yb * stride + xb;

        const sr = satR[bottomRight] - satR[topRight] - satR[bottomLeft] + satR[topLeft];
        const sg = satG[bottomRight] - satG[topRight] - satG[bottomLeft] + satG[topLeft];
        const sb = satB[bottomRight] - satB[topRight] - satB[bottomLeft] + satB[topLeft];
        const sr2 = satR2[bottomRight] - satR2[topRight] - satR2[bottomLeft] + satR2[topLeft];
        const sg2 = satG2[bottomRight] - satG2[topRight] - satG2[bottomLeft] + satG2[topLeft];
        const sb2 = satB2[bottomRight] - satB2[topRight] - satB2[bottomLeft] + satB2[topLeft];

        const mr = sr / n, mg = sg / n, mb = sb / n;
        const variance = (sr2 / n - mr * mr) + (sg2 / n - mg * mg) + (sb2 / n - mb * mb);

        if (variance < bestVar) {
          bestVar = variance;
          bestR = mr; bestG = mg; bestB = mb;
        }
      }

      const i = getBufferIndex(x, y, W);
      const col = srgbPaletteGetColor(
        palette,
        rgba(Math.round(bestR), Math.round(bestG), Math.round(bestB), buf[i + 3]),
        palette.options
      );
      fillBufferPixel(outBuf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Kuwahara",
  func: kuwahara,
  options: defaults,
  optionTypes,
  defaults
});
