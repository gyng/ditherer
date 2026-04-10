import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

const MODE = { DILATE: "DILATE", ERODE: "ERODE", OPEN: "OPEN", CLOSE: "CLOSE" };

export const optionTypes = {
  mode: { type: ENUM, options: [
    { name: "Dilate", value: MODE.DILATE },
    { name: "Erode", value: MODE.ERODE },
    { name: "Open (erode then dilate)", value: MODE.OPEN },
    { name: "Close (dilate then erode)", value: MODE.CLOSE }
  ], default: MODE.DILATE, desc: "Morphological operation type" },
  radius: { type: RANGE, range: [1, 10], step: 1, default: 2, desc: "Structuring element radius" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  mode: optionTypes.mode.default,
  radius: optionTypes.radius.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const applyMorphOp = (buf: Uint8ClampedArray, W: number, H: number, radius: number, isDilate: boolean): Uint8ClampedArray => {
  const out = new Uint8ClampedArray(buf.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const di = getBufferIndex(x, y, W);
      let bestR = isDilate ? 0 : 255;
      let bestG = isDilate ? 0 : 255;
      let bestB = isDilate ? 0 : 255;
      let bestLum = isDilate ? -1 : 256;

      for (let ky = -radius; ky <= radius; ky++) {
        const ny = Math.max(0, Math.min(H - 1, y + ky));
        for (let kx = -radius; kx <= radius; kx++) {
          if (kx * kx + ky * ky > radius * radius) continue;
          const nx = Math.max(0, Math.min(W - 1, x + kx));
          const ni = getBufferIndex(nx, ny, W);
          const lum = 0.2126 * buf[ni] + 0.7152 * buf[ni + 1] + 0.0722 * buf[ni + 2];
          if (isDilate ? lum > bestLum : lum < bestLum) {
            bestLum = lum;
            bestR = buf[ni]; bestG = buf[ni + 1]; bestB = buf[ni + 2];
          }
        }
      }

      out[di] = bestR; out[di + 1] = bestG; out[di + 2] = bestB; out[di + 3] = buf[di + 3];
    }
  }
  return out;
};

const morphology = (input, options: any = defaults) => {
  const { mode, radius, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  let result: Uint8ClampedArray;
  switch (mode) {
    case MODE.DILATE: result = applyMorphOp(buf, W, H, radius, true); break;
    case MODE.ERODE: result = applyMorphOp(buf, W, H, radius, false); break;
    case MODE.OPEN: result = applyMorphOp(applyMorphOp(buf, W, H, radius, false), W, H, radius, true); break;
    case MODE.CLOSE: result = applyMorphOp(applyMorphOp(buf, W, H, radius, true), W, H, radius, false); break;
    default: result = new Uint8ClampedArray(buf);
  }

  // Apply palette
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(result[i], result[i + 1], result[i + 2], result[i + 3]), palette.options, false);
      fillBufferPixel(result, i, color[0], color[1], color[2], result[i + 3]);
    }

  outputCtx.putImageData(new ImageData(new Uint8ClampedArray(result), W, H), 0, 0);
  return output;
};

export default { name: "Dilate / Erode", func: morphology, optionTypes, options: defaults, defaults };
