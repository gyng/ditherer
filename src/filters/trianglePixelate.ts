import { RANGE, BOOL, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, clamp, getBufferIndex, rgba, srgbPaletteGetColor } from "utils";
import { defineFilter } from "filters/types";

const getTriangleCell = (x: number, y: number, size: number): [number, number, number] => {
  const tx = Math.floor(x / size);
  const ty = Math.floor(y / size);
  const localX = x - tx * size;
  const localY = y - ty * size;
  const up = localX + localY < size;
  return [tx, ty, up ? 0 : 1];
};

const sameCell = (a: [number, number, number], b: [number, number, number]) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

const getTriangleSample = (tx: number, ty: number, tri: number, size: number): [number, number] => {
  const baseX = tx * size;
  const baseY = ty * size;
  if (tri === 0) return [baseX + size / 3, baseY + size / 3];
  return [baseX + size * 2 / 3, baseY + size * 2 / 3];
};

export const optionTypes = {
  cellSize: { type: RANGE, range: [4, 64], step: 1, default: 16, desc: "Triangle cell size in pixels" },
  outline: { type: BOOL, default: false, desc: "Draw seams between neighboring triangle cells" },
  outlineColor: { type: COLOR, default: [0, 0, 0], desc: "Outline color when seam drawing is enabled" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  cellSize: optionTypes.cellSize.default,
  outline: optionTypes.outline.default,
  outlineColor: optionTypes.outlineColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const trianglePixelate = (input, options = defaults) => {
  const { cellSize, outline, outlineColor, palette } = options;
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
      const cell = getTriangleCell(x, y, cellSize);
      const i = getBufferIndex(x, y, W);

      if (outline) {
        const right = getTriangleCell(Math.min(W - 1, x + 1), y, cellSize);
        const down = getTriangleCell(x, Math.min(H - 1, y + 1), cellSize);
        if (!sameCell(cell, right) || !sameCell(cell, down)) {
          outBuf[i] = outlineColor[0];
          outBuf[i + 1] = outlineColor[1];
          outBuf[i + 2] = outlineColor[2];
          outBuf[i + 3] = 255;
          continue;
        }
      }

      const [sxRaw, syRaw] = getTriangleSample(cell[0], cell[1], cell[2], cellSize);
      const sx = clamp(0, W - 1, Math.round(sxRaw));
      const sy = clamp(0, H - 1, Math.round(syRaw));
      const si = getBufferIndex(sx, sy, W);
      const color = srgbPaletteGetColor(palette, rgba(buf[si], buf[si + 1], buf[si + 2], buf[si + 3]), palette.options);

      outBuf[i] = color[0];
      outBuf[i + 1] = color[1];
      outBuf[i + 2] = color[2];
      outBuf[i + 3] = 255;
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Triangle Pixelate",
  func: trianglePixelate,
  optionTypes,
  options: defaults,
  defaults
});
