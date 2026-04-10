import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";
import { computeLuminance, sobelEdges } from "utils/edges";

export const optionTypes = {
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 128, desc: "Black/white carving threshold" },
  lineWeight: { type: RANGE, range: [1, 5], step: 1, default: 2, desc: "Carved line thickness" },
  edgeStrength: { type: RANGE, range: [0, 3], step: 0.1, default: 1.5, desc: "Detail edge emphasis" },
  inkColor: { type: COLOR, default: [20, 15, 10], desc: "Ink color for printed areas" },
  paperColor: { type: COLOR, default: [240, 230, 210], desc: "Uncarved paper/wood color" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  lineWeight: optionTypes.lineWeight.default,
  edgeStrength: optionTypes.edgeStrength.default,
  inkColor: optionTypes.inkColor.default,
  paperColor: optionTypes.paperColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const woodcut = (input, options: any = defaults) => {
  const { threshold, lineWeight, edgeStrength, inkColor, paperColor, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // Compute luminance
  const lum = computeLuminance(buf, W, H);

  // Sobel edge detection — compute edge magnitude and direction
  const { magnitude, direction } = sobelEdges(lum, W, H);
  // Apply edge strength scaling
  for (let i = 0; i < magnitude.length; i++) magnitude[i] *= edgeStrength;

  // Render: combine threshold binarization with edge-following lines
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const pi = y * W + x;
      const l = lum[pi];
      const edge = magnitude[pi];
      const dir = direction[pi];

      // Base: threshold binarization
      let isInk = l < threshold;

      // Edge lines: draw lines perpendicular to edge direction
      // This creates the carved-line texture of woodcuts
      if (edge > 30) {
        // Perpendicular direction for line texture
        const perpX = Math.cos(dir + Math.PI / 2);
        const perpY = Math.sin(dir + Math.PI / 2);
        // Project position onto perpendicular axis
        const proj = x * perpX + y * perpY;
        const linePos = ((proj % lineWeight) + lineWeight) % lineWeight;
        if (linePos < lineWeight * 0.5) {
          isInk = true;
        }
      }

      // Dark areas get denser line fill based on luminance
      if (!isInk && l < threshold * 1.5) {
        const density = (threshold * 1.5 - l) / (threshold * 0.5);
        const lineFreq = lineWeight + 2;
        const linePos = ((x + y) % lineFreq);
        if (linePos < lineFreq * density * 0.3) {
          isInk = true;
        }
      }

      const i = getBufferIndex(x, y, W);
      const ic = isInk ? inkColor : paperColor;
      const color = paletteGetColor(palette, rgba(ic[0], ic[1], ic[2], 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Woodcut",
  func: woodcut,
  optionTypes,
  options: defaults,
  defaults
};
