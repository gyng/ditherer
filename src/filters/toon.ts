import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, srgbPaletteGetColor } from "utils";
import { computeLuminance, sobelEdges } from "utils/edges";

export const optionTypes = {
  levels: { type: RANGE, range: [2, 12], step: 1, default: 4, desc: "Number of flat color bands used for cel shading" },
  edgeThreshold: { type: RANGE, range: [0, 100], step: 1, default: 28, desc: "Edge sensitivity for the ink outline" },
  lineColor: { type: COLOR, default: [24, 18, 18], desc: "Outline color used for the cartoon ink pass" },
  lineWidth: { type: RANGE, range: [1, 4], step: 1, default: 1, desc: "Thickness of the outline" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  levels: optionTypes.levels.default,
  edgeThreshold: optionTypes.edgeThreshold.default,
  lineColor: optionTypes.lineColor.default,
  lineWidth: optionTypes.lineWidth.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const toon = (input, options: any = defaults) => {
  const { levels, edgeThreshold, lineColor, lineWidth, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const lum = computeLuminance(buf, W, H);
  const { magnitude } = sobelEdges(lum, W, H);
  const edgeMap = lineWidth > 1 ? new Float32Array(W * H) : magnitude;

  if (lineWidth > 1) {
    const radius = lineWidth - 1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let maxVal = 0;
        for (let ky = -radius; ky <= radius; ky++) {
          for (let kx = -radius; kx <= radius; kx++) {
            const nx = Math.max(0, Math.min(W - 1, x + kx));
            const ny = Math.max(0, Math.min(H - 1, y + ky));
            maxVal = Math.max(maxVal, magnitude[ny * W + nx]);
          }
        }
        edgeMap[y * W + x] = maxVal;
      }
    }
  }

  const step = 255 / Math.max(1, levels - 1);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      if (edgeMap[y * W + x] > edgeThreshold) {
        const edgeColor = srgbPaletteGetColor(palette, rgba(lineColor[0], lineColor[1], lineColor[2], 255), palette.options);
        fillBufferPixel(outBuf, i, edgeColor[0], edgeColor[1], edgeColor[2], 255);
        continue;
      }

      const r = Math.round(Math.round(buf[i] / step) * step);
      const g = Math.round(Math.round(buf[i + 1] / step) * step);
      const b = Math.round(Math.round(buf[i + 2] / step) * step);
      const color = srgbPaletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Toon",
  func: toon,
  optionTypes,
  options: defaults,
  defaults
};
