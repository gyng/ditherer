import { RANGE, ENUM, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, getBufferIndex, rgba, srgbPaletteGetColor } from "utils";
import { computeLuminance, sobelEdges } from "utils/edges";
import { defineFilter } from "filters/types";

const ANGLE_MODE = {
  CONSTANT: "CONSTANT",
  LUMINANCE: "LUMINANCE",
  GRADIENT: "GRADIENT"
};

export const optionTypes = {
  cellSize: { type: RANGE, range: [8, 48], step: 1, default: 16, desc: "Grid cell size in pixels" },
  angleMode: {
    type: ENUM,
    options: [
      { name: "Constant", value: ANGLE_MODE.CONSTANT },
      { name: "Vary by luminance", value: ANGLE_MODE.LUMINANCE },
      { name: "Vary by gradient", value: ANGLE_MODE.GRADIENT }
    ],
    default: ANGLE_MODE.CONSTANT,
    desc: "How line angle is chosen per cell"
  },
  baseAngle: { type: RANGE, range: [0, 180], step: 1, default: 45, desc: "Base line angle in degrees" },
  inkColor: { type: COLOR, default: [20, 18, 15], desc: "Ink color of the rendered line marks" },
  paperColor: { type: COLOR, default: [245, 240, 226], desc: "Paper color behind the halftone lines" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  cellSize: optionTypes.cellSize.default,
  angleMode: optionTypes.angleMode.default,
  baseAngle: optionTypes.baseAngle.default,
  inkColor: optionTypes.inkColor.default,
  paperColor: optionTypes.paperColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const drawLine = (buf, W, H, cx, cy, angle, halfLen, thickness, ink) => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const radius = Math.ceil(halfLen + thickness);
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(H - 1, Math.ceil(cy + radius)); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(W - 1, Math.ceil(cx + radius)); x++) {
      const dx = x - cx;
      const dy = y - cy;
      const along = dx * cos + dy * sin;
      const across = -dx * sin + dy * cos;
      if (Math.abs(along) <= halfLen && Math.abs(across) <= thickness) {
        const i = getBufferIndex(x, y, W);
        buf[i] = ink[0];
        buf[i + 1] = ink[1];
        buf[i + 2] = ink[2];
        buf[i + 3] = 255;
      }
    }
  }
};

const halftoneLine = (input, options = defaults) => {
  const { cellSize, angleMode, baseAngle, inkColor, paperColor, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const lum = computeLuminance(buf, W, H);
  const edges = sobelEdges(lum, W, H);
  const ink = srgbPaletteGetColor(palette, rgba(inkColor[0], inkColor[1], inkColor[2], 255), palette.options);
  const paper = srgbPaletteGetColor(palette, rgba(paperColor[0], paperColor[1], paperColor[2], 255), palette.options);

  for (let i = 0; i < outBuf.length; i += 4) {
    outBuf[i] = paper[0];
    outBuf[i + 1] = paper[1];
    outBuf[i + 2] = paper[2];
    outBuf[i + 3] = 255;
  }

  for (let cy = 0; cy < H; cy += cellSize) {
    for (let cx = 0; cx < W; cx += cellSize) {
      let sumLum = 0;
      let sumDir = 0;
      let count = 0;
      const endX = Math.min(W, cx + cellSize);
      const endY = Math.min(H, cy + cellSize);
      for (let y = cy; y < endY; y++) {
        for (let x = cx; x < endX; x++) {
          const idx = y * W + x;
          sumLum += lum[idx];
          sumDir += edges.direction[idx];
          count++;
        }
      }

      const avgLum = count === 0 ? 0 : sumLum / count;
      let angle = (baseAngle * Math.PI) / 180;
      if (angleMode === ANGLE_MODE.LUMINANCE) {
        angle += (avgLum / 255) * (Math.PI / 2);
      } else if (angleMode === ANGLE_MODE.GRADIENT) {
        angle = (sumDir / Math.max(1, count)) + Math.PI / 2;
      }

      const darkness = 1 - avgLum / 255;
      const halfLen = Math.max(1, darkness * cellSize * 0.45);
      const thickness = Math.max(0.5, darkness * 2.25);
      drawLine(outBuf, W, H, cx + cellSize / 2, cy + cellSize / 2, angle, halfLen, thickness, ink);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Halftone Line",
  func: halftoneLine,
  optionTypes,
  options: defaults,
  defaults
});
