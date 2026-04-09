import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

export const optionTypes = {
  dotSize: { type: RANGE, range: [2, 12], step: 1, default: 4 },
  spacing: { type: RANGE, range: [1, 8], step: 1, default: 2 },
  inkDensity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.8 },
  inkColor: { type: COLOR, default: [10, 10, 40] },
  paperColor: { type: COLOR, default: [240, 235, 220] },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  dotSize: optionTypes.dotSize.default,
  spacing: optionTypes.spacing.default,
  inkDensity: optionTypes.inkDensity.default,
  inkColor: optionTypes.inkColor.default,
  paperColor: optionTypes.paperColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const dotMatrix = (input, options: any = defaults) => {
  const { dotSize, spacing, inkDensity, inkColor, paperColor, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const cellSize = dotSize + spacing;

  // Fill paper
  for (let i = 0; i < outBuf.length; i += 4) {
    outBuf[i] = paperColor[0];
    outBuf[i + 1] = paperColor[1];
    outBuf[i + 2] = paperColor[2];
    outBuf[i + 3] = 255;
  }

  // For each cell, sample average luminance and draw a dot sized by darkness
  for (let cy = 0; cy < H; cy += cellSize) {
    for (let cx = 0; cx < W; cx += cellSize) {
      // Average luminance of the cell
      let totalLum = 0;
      let count = 0;
      for (let dy = 0; dy < cellSize && cy + dy < H; dy++) {
        for (let dx = 0; dx < cellSize && cx + dx < W; dx++) {
          const i = getBufferIndex(cx + dx, cy + dy, W);
          totalLum += 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
          count++;
        }
      }
      const avgLum = totalLum / count / 255;
      const darkness = (1 - avgLum) * inkDensity;

      // Dot radius proportional to darkness
      const maxR = dotSize / 2;
      const dotR = maxR * darkness;
      if (dotR < 0.3) continue;

      // Draw square pin-strike dot (dot matrix printers use pins, not circles)
      const centerX = cx + cellSize / 2;
      const centerY = cy + cellSize / 2;
      const halfDot = Math.ceil(dotR);

      for (let dy = -halfDot; dy <= halfDot; dy++) {
        for (let dx = -halfDot; dx <= halfDot; dx++) {
          const px = Math.round(centerX + dx);
          const py = Math.round(centerY + dy);
          if (px < 0 || px >= W || py < 0 || py >= H) continue;

          const i = getBufferIndex(px, py, W);
          // Slightly vary ink intensity for pin-strike character
          const intensity = Math.min(1, darkness * (0.8 + 0.2 * Math.abs(dy / halfDot)));
          const r = Math.round(paperColor[0] + (inkColor[0] - paperColor[0]) * intensity);
          const g = Math.round(paperColor[1] + (inkColor[1] - paperColor[1]) * intensity);
          const b = Math.round(paperColor[2] + (inkColor[2] - paperColor[2]) * intensity);

          const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
          fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
        }
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Dot Matrix",
  func: dotMatrix,
  optionTypes,
  options: defaults,
  defaults
};
