import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

export const optionTypes = {
  density: { type: RANGE, range: [2, 20], step: 1, default: 6, desc: "Line spacing in pixels" },
  angle1: { type: RANGE, range: [0, 180], step: 5, default: 45, desc: "First hatch direction in degrees" },
  angle2: { type: RANGE, range: [0, 180], step: 5, default: 135, desc: "Second hatch direction in degrees" },
  threshold1: { type: RANGE, range: [0, 255], step: 1, default: 170, desc: "Luminance below which first hatch appears" },
  threshold2: { type: RANGE, range: [0, 255], step: 1, default: 100, desc: "Luminance below which second hatch appears" },
  lineWidth: { type: RANGE, range: [1, 4], step: 1, default: 1, desc: "Hatch line thickness" },
  inkColor: { type: COLOR, default: [0, 0, 0], desc: "Hatch line color" },
  paperColor: { type: COLOR, default: [255, 255, 240], desc: "Background paper color" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  density: optionTypes.density.default,
  angle1: optionTypes.angle1.default,
  angle2: optionTypes.angle2.default,
  threshold1: optionTypes.threshold1.default,
  threshold2: optionTypes.threshold2.default,
  lineWidth: optionTypes.lineWidth.default,
  inkColor: optionTypes.inkColor.default,
  paperColor: optionTypes.paperColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const crosshatch = (input, options = defaults) => {
  const { density, angle1, angle2, threshold1, threshold2, lineWidth, inkColor, paperColor, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // Compute luminance map
  const lum = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      lum[y * W + x] = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
    }
  }

  // Fill with paper color
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      fillBufferPixel(outBuf, i, paperColor[0], paperColor[1], paperColor[2], 255);
    }
  }

  // Draw hatch lines for each angle layer
  const drawHatch = (angleDeg: number, threshold: number) => {
    const rad = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (lum[y * W + x] >= threshold) continue;

        // Project onto perpendicular axis to determine line membership
        const proj = x * cosA + y * sinA;
        const distToLine = ((proj % density) + density) % density;

        if (distToLine < lineWidth) {
          const i = getBufferIndex(x, y, W);
          const color = paletteGetColor(palette, rgba(inkColor[0], inkColor[1], inkColor[2], 255), palette.options, false);
          fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
        }
      }
    }
  };

  drawHatch(angle1, threshold1);
  drawHatch(angle2, threshold2);

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Crosshatch",
  func: crosshatch,
  optionTypes,
  options: defaults,
  defaults
});
