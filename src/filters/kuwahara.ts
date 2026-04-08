import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  radius: { type: RANGE, range: [1, 8], step: 1, default: 3 },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  radius: optionTypes.radius.default,
  palette: optionTypes.palette.default
};

// [x0, x1, y0, y1] offsets for the four Kuwahara quadrants
const QUADRANTS = [
  [-1, 0, -1, 0],
  [0, 1, -1, 0],
  [-1, 0, 0, 1],
  [0, 1, 0, 1]
] as const;

const kuwahara = (input, options = defaults) => {
  const { radius, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const r = Math.max(1, Math.round(radius));

  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      let bestVar = Infinity;
      let bestR = 0, bestG = 0, bestB = 0;

      for (const [qx0, qx1, qy0, qy1] of QUADRANTS) {
        let sr = 0, sg = 0, sb = 0;
        let sr2 = 0, sg2 = 0, sb2 = 0;
        let n = 0;

        for (let kx = qx0 * r; kx <= qx1 * r; kx += 1) {
          for (let ky = qy0 * r; ky <= qy1 * r; ky += 1) {
            const nx = Math.max(0, Math.min(W - 1, x + kx));
            const ny = Math.max(0, Math.min(H - 1, y + ky));
            const ki = getBufferIndex(nx, ny, W);
            const pr = buf[ki], pg = buf[ki + 1], pb = buf[ki + 2];
            sr += pr; sg += pg; sb += pb;
            sr2 += pr * pr; sg2 += pg * pg; sb2 += pb * pb;
            n += 1;
          }
        }

        if (n === 0) continue;
        const mr = sr / n, mg = sg / n, mb = sb / n;
        const variance = (sr2 / n - mr * mr) + (sg2 / n - mg * mg) + (sb2 / n - mb * mb);

        if (variance < bestVar) {
          bestVar = variance;
          bestR = mr;
          bestG = mg;
          bestB = mb;
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
