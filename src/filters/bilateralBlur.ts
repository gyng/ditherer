import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  sigmaSpatial: { type: RANGE, range: [1, 20], step: 1, default: 5 },
  sigmaRange: { type: RANGE, range: [5, 100], step: 5, default: 30 },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  sigmaSpatial: optionTypes.sigmaSpatial.default,
  sigmaRange: optionTypes.sigmaRange.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const bilateralBlur = (input, options: any = defaults) => {
  const { sigmaSpatial, sigmaRange, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const r = Math.ceil(sigmaSpatial * 2);
  const spatialDenom = 2 * sigmaSpatial * sigmaSpatial;
  const rangeDenom = 2 * sigmaRange * sigmaRange;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ci = getBufferIndex(x, y, W);
      const cr = buf[ci], cg = buf[ci + 1], cb = buf[ci + 2];
      let sr = 0, sg = 0, sb = 0, sw = 0;

      for (let ky = -r; ky <= r; ky++) {
        const ny = Math.max(0, Math.min(H - 1, y + ky));
        for (let kx = -r; kx <= r; kx++) {
          const nx = Math.max(0, Math.min(W - 1, x + kx));
          const ni = getBufferIndex(nx, ny, W);
          const nr = buf[ni], ng = buf[ni + 1], nb = buf[ni + 2];

          const spatialW = Math.exp(-(kx * kx + ky * ky) / spatialDenom);
          const dr = cr - nr, dg = cg - ng, db = cb - nb;
          const rangeW = Math.exp(-(dr * dr + dg * dg + db * db) / rangeDenom);
          const w = spatialW * rangeW;

          sr += nr * w; sg += ng * w; sb += nb * w; sw += w;
        }
      }

      const color = paletteGetColor(palette, rgba(
        Math.round(sr / sw), Math.round(sg / sw), Math.round(sb / sw), buf[ci + 3]
      ), palette.options, false);
      fillBufferPixel(outBuf, ci, color[0], color[1], color[2], buf[ci + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Bilateral Blur", func: bilateralBlur, optionTypes, options: defaults, defaults };
