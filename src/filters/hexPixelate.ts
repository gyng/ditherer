import { RANGE, BOOL, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, clamp, getBufferIndex, rgba, srgbPaletteGetColor } from "utils";
import { defineFilter } from "filters/types";

const SQRT3 = Math.sqrt(3);

const roundHex = (qf: number, rf: number): [number, number] => {
  const x = qf;
  const z = rf;
  const y = -x - z;
  let rx = Math.round(x);
  const ry = Math.round(y);
  let rz = Math.round(z);

  const xDiff = Math.abs(rx - x);
  const yDiff = Math.abs(ry - y);
  const zDiff = Math.abs(rz - z);

  if (xDiff > yDiff && xDiff > zDiff) rx = -ry - rz;
  else rz = -rx - ry;

  return [rx, rz];
};

const pixelToHex = (x: number, y: number, size: number): [number, number] => {
  const px = x - size;
  const py = y - size;
  const q = (SQRT3 / 3 * px - py / 3) / size;
  const r = (2 / 3 * py) / size;
  return roundHex(q, r);
};

const hexToCenter = (q: number, r: number, size: number): [number, number] => ([
  size * SQRT3 * (q + r / 2) + size,
  size * 1.5 * r + size
]);

const sameHex = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];

export const optionTypes = {
  cellSize: { type: RANGE, range: [4, 64], step: 1, default: 16, desc: "Hex cell diameter in pixels" },
  outline: { type: BOOL, default: false, desc: "Draw 1px seams between neighboring hex cells" },
  outlineColor: { type: COLOR, default: [0, 0, 0], desc: "Outline color when seam drawing is enabled" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  cellSize: optionTypes.cellSize.default,
  outline: optionTypes.outline.default,
  outlineColor: optionTypes.outlineColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const hexPixelate = (input: any, options = defaults) => {
  const { cellSize, outline, outlineColor, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const size = Math.max(2, cellSize * 0.5);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cell = pixelToHex(x, y, size);
      const i = getBufferIndex(x, y, W);

      if (outline) {
        const right = pixelToHex(Math.min(W - 1, x + 1), y, size);
        const down = pixelToHex(x, Math.min(H - 1, y + 1), size);
        if (!sameHex(cell, right) || !sameHex(cell, down)) {
          outBuf[i] = outlineColor[0];
          outBuf[i + 1] = outlineColor[1];
          outBuf[i + 2] = outlineColor[2];
          outBuf[i + 3] = 255;
          continue;
        }
      }

      const [cx, cy] = hexToCenter(cell[0], cell[1], size);
      const sx = clamp(0, W - 1, Math.round(cx));
      const sy = clamp(0, H - 1, Math.round(cy));
      const si = getBufferIndex(sx, sy, W);
      const color = srgbPaletteGetColor(
        palette,
        rgba(buf[si], buf[si + 1], buf[si + 2], buf[si + 3]),
        palette.options
      );

      outBuf[i] = color[0];
      outBuf[i + 1] = color[1];
      outBuf[i + 2] = color[2];
      outBuf[i + 3] = buf[si + 3];
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Hex Pixelate",
  func: hexPixelate,
  optionTypes,
  options: defaults,
  defaults
});
