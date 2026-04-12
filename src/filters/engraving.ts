import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

export const optionTypes = {
  lineSpacing: { type: RANGE, range: [2, 12], step: 1, default: 4, desc: "Distance between engraved lines" },
  angle: { type: RANGE, range: [0, 180], step: 5, default: 45, desc: "Line angle in degrees" },
  inkColor: { type: COLOR, default: [10, 10, 20], desc: "Engraved line color" },
  paperColor: { type: COLOR, default: [250, 245, 235], desc: "Background paper color" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  lineSpacing: optionTypes.lineSpacing.default,
  angle: optionTypes.angle.default,
  inkColor: optionTypes.inkColor.default,
  paperColor: optionTypes.paperColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const engraving = (input: any, options = defaults) => {
  const { lineSpacing, angle, inkColor, paperColor, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const rad = (angle * Math.PI) / 180;
  const cosA = Math.cos(rad), sinA = Math.sin(rad);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const lum = (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255;
      const darkness = 1 - lum;

      // Project onto perpendicular of line direction
      const proj = x * cosA + y * sinA;
      const linePos = ((proj % lineSpacing) + lineSpacing) % lineSpacing;

      // Line thickness proportional to darkness
      const lineThickness = darkness * lineSpacing * 0.8;
      const distToCenter = Math.abs(linePos - lineSpacing / 2);
      const onLine = distToCenter < lineThickness / 2;

      if (onLine) {
        // Ink intensity varies smoothly across the line (rounded engraving profile)
        const t = 1 - distToCenter / (lineThickness / 2);
        const inkIntensity = t * t * darkness;
        const r = Math.round(paperColor[0] + (inkColor[0] - paperColor[0]) * inkIntensity);
        const g = Math.round(paperColor[1] + (inkColor[1] - paperColor[1]) * inkIntensity);
        const b = Math.round(paperColor[2] + (inkColor[2] - paperColor[2]) * inkIntensity);
        const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
      } else {
        const color = paletteGetColor(palette, rgba(paperColor[0], paperColor[1], paperColor[2], 255), palette.options, false);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Engraving", func: engraving, optionTypes, options: defaults, defaults });
