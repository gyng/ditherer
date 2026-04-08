import { PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  palette: optionTypes.palette.default
};

// Triangular probability density function noise in [-1, 1]
// Better spectral properties than uniform noise: blue-ish noise distribution
const tpdf = () => Math.random() - Math.random();

const triangleDither = (input, options = defaults) => {
  const { palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      const i = getBufferIndex(x, y, W);
      // Add triangular noise before palette quantization
      const noiseScale = 255;
      const r = buf[i]     + tpdf() * noiseScale * 0.5;
      const g = buf[i + 1] + tpdf() * noiseScale * 0.5;
      const b = buf[i + 2] + tpdf() * noiseScale * 0.5;
      const col = paletteGetColor(
        palette,
        rgba(r, g, b, buf[i + 3]),
        palette.options,
        options._linearize
      );
      fillBufferPixel(buf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(buf, W, H), 0, 0);
  return output;
};

export default {
  name: "Triangle dither",
  func: triangleDither,
  options: defaults,
  optionTypes,
  defaults
};
