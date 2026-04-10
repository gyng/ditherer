import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  threshold: { type: RANGE, range: [0, 50], step: 1, default: 15, desc: "Difference threshold to detect speckle noise" },
  radius: { type: RANGE, range: [1, 5], step: 1, default: 2, desc: "Neighborhood radius for median sampling" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  radius: optionTypes.radius.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const despeckle = (input, options: any = defaults) => {
  const { threshold, radius, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const threshSq = threshold * threshold;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      // Compute neighborhood mean and variance
      let sumR = 0, sumG = 0, sumB = 0;
      let sumR2 = 0, sumG2 = 0, sumB2 = 0;
      let count = 0;

      for (let ky = -radius; ky <= radius; ky++) {
        const ny = Math.max(0, Math.min(H - 1, y + ky));
        for (let kx = -radius; kx <= radius; kx++) {
          const nx = Math.max(0, Math.min(W - 1, x + kx));
          const ni = getBufferIndex(nx, ny, W);
          sumR += buf[ni]; sumG += buf[ni + 1]; sumB += buf[ni + 2];
          sumR2 += buf[ni] * buf[ni]; sumG2 += buf[ni + 1] * buf[ni + 1]; sumB2 += buf[ni + 2] * buf[ni + 2];
          count++;
        }
      }

      const meanR = sumR / count, meanG = sumG / count, meanB = sumB / count;
      const varR = sumR2 / count - meanR * meanR;
      const varG = sumG2 / count - meanG * meanG;
      const varB = sumB2 / count - meanB * meanB;
      const variance = (varR + varG + varB) / 3;

      // High variance = noisy → smooth. Low variance = structured → preserve.
      if (variance > threshSq) {
        const color = paletteGetColor(palette, rgba(Math.round(meanR), Math.round(meanG), Math.round(meanB), buf[i + 3]), palette.options, false);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
      } else {
        const color = paletteGetColor(palette, rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]), palette.options, false);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Despeckle", func: despeckle, optionTypes, options: defaults, defaults };
