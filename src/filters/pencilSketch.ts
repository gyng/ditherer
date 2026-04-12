import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { computeLuminance, sobelEdges } from "utils/edges";
import { defineFilter } from "filters/types";

export const optionTypes = {
  strokeDensity: { type: RANGE, range: [1, 10], step: 1, default: 4, desc: "Hatching line density" },
  contrast: { type: RANGE, range: [0.5, 3], step: 0.1, default: 1.5, desc: "Contrast boost for pencil strokes" },
  pencilColor: { type: COLOR, default: [30, 25, 20], desc: "Pencil graphite color" },
  paperColor: { type: COLOR, default: [250, 245, 235], desc: "Background paper color" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  strokeDensity: optionTypes.strokeDensity.default,
  contrast: optionTypes.contrast.default,
  pencilColor: optionTypes.pencilColor.default,
  paperColor: optionTypes.paperColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const pencilSketch = (input, options = defaults) => {
  const { strokeDensity, contrast, pencilColor, paperColor, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // Luminance (normalized to 0-1 range)
  const lum = computeLuminance(buf, W, H);
  for (let i = 0; i < lum.length; i++) lum[i] /= 255;

  // Sobel edges for stroke direction
  const { magnitude, direction } = sobelEdges(lum, W, H);

  // Render: paper + pencil strokes
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const l = lum[y * W + x];
      const edge = magnitude[y * W + x];
      const dir = direction[y * W + x];

      // Base: paper lightness proportional to luminance
      let darkness = (1 - l) * contrast;
      darkness = Math.max(0, Math.min(1, darkness));

      // Directional stroke lines following edge flow (perpendicular to edge)
      const perpDir = dir + Math.PI / 2;
      const proj = x * Math.cos(perpDir) + y * Math.sin(perpDir);
      const linePos = ((proj % strokeDensity) + strokeDensity) % strokeDensity;
      const onStroke = linePos < strokeDensity * 0.4;

      // Edges get stronger strokes
      const edgeFactor = Math.min(1, edge / 100);
      const strokeIntensity = onStroke ? darkness * (0.3 + edgeFactor * 0.7) : darkness * 0.15;

      const r = Math.round(paperColor[0] + (pencilColor[0] - paperColor[0]) * strokeIntensity);
      const g = Math.round(paperColor[1] + (pencilColor[1] - paperColor[1]) * strokeIntensity);
      const b = Math.round(paperColor[2] + (pencilColor[2] - paperColor[2]) * strokeIntensity);

      const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Pencil Sketch", func: pencilSketch, optionTypes, options: defaults, defaults });
