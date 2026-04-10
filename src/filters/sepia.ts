import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

export const optionTypes = {
  intensity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.8, desc: "Sepia tone intensity" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  intensity: optionTypes.intensity.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const sepiaFilter = (input, options: any = defaults) => {
  const { intensity, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const sr = buf[i], sg = buf[i + 1], sb = buf[i + 2];

      // Standard sepia tone matrix
      const sepR = Math.min(255, 0.393 * sr + 0.769 * sg + 0.189 * sb);
      const sepG = Math.min(255, 0.349 * sr + 0.686 * sg + 0.168 * sb);
      const sepB = Math.min(255, 0.272 * sr + 0.534 * sg + 0.131 * sb);

      // Lerp between original and sepia
      const r = Math.round(sr + (sepR - sr) * intensity);
      const g = Math.round(sg + (sepG - sg) * intensity);
      const b = Math.round(sb + (sepB - sb) * intensity);

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Sepia",
  func: sepiaFilter,
  optionTypes,
  options: defaults,
  defaults
};
