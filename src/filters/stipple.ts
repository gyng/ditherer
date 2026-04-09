import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  density: { type: RANGE, range: [1, 20], step: 1, default: 4 },
  maxDotSize: { type: RANGE, range: [1, 8], step: 0.5, default: 3 },
  inkColor: { type: COLOR, default: [0, 0, 0] },
  paperColor: { type: COLOR, default: [255, 250, 240] },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  density: optionTypes.density.default,
  maxDotSize: optionTypes.maxDotSize.default,
  inkColor: optionTypes.inkColor.default,
  paperColor: optionTypes.paperColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

const stipple = (input, options: any = defaults) => {
  const { density, maxDotSize, inkColor, paperColor, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const rng = mulberry32(42);

  // Fill paper
  for (let i = 0; i < outBuf.length; i += 4) {
    outBuf[i] = paperColor[0]; outBuf[i + 1] = paperColor[1]; outBuf[i + 2] = paperColor[2]; outBuf[i + 3] = 255;
  }

  // Place dots randomly, sized by local darkness
  const cellSize = density;
  for (let cy = 0; cy < H; cy += cellSize) {
    for (let cx = 0; cx < W; cx += cellSize) {
      // Sample average darkness
      let totalLum = 0, count = 0;
      for (let dy = 0; dy < cellSize && cy + dy < H; dy++)
        for (let dx = 0; dx < cellSize && cx + dx < W; dx++) {
          const i = getBufferIndex(cx + dx, cy + dy, W);
          totalLum += 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
          count++;
        }
      const darkness = 1 - totalLum / count / 255;
      if (darkness < 0.05) continue;

      // Random position within cell
      const dotX = cx + rng() * cellSize;
      const dotY = cy + rng() * cellSize;
      const dotR = maxDotSize * darkness;

      // Draw circular dot
      const r2 = dotR * dotR;
      for (let dy = -Math.ceil(dotR); dy <= Math.ceil(dotR); dy++)
        for (let dx = -Math.ceil(dotR); dx <= Math.ceil(dotR); dx++) {
          if (dx * dx + dy * dy > r2) continue;
          const px = Math.round(dotX + dx), py = Math.round(dotY + dy);
          if (px < 0 || px >= W || py < 0 || py >= H) continue;
          const i = getBufferIndex(px, py, W);
          const color = paletteGetColor(palette, rgba(inkColor[0], inkColor[1], inkColor[2], 255), palette.options, false);
          fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
        }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Stipple", func: stipple, optionTypes, options: defaults, defaults };
