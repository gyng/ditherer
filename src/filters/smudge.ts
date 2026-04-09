import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  strength: { type: RANGE, range: [1, 30], step: 1, default: 10 },
  direction: { type: RANGE, range: [0, 360], step: 5, default: 90 },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  strength: optionTypes.strength.default,
  direction: optionTypes.direction.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const smudge = (input, options: any = defaults) => {
  const { strength, direction, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  outBuf.set(buf);

  const rad = (direction * Math.PI) / 180;
  const dx = Math.cos(rad), dy = Math.sin(rad);

  // Process in direction order for accumulating smudge
  // Determine scan order based on direction
  const xStart = dx >= 0 ? 0 : W - 1;
  const xEnd = dx >= 0 ? W : -1;
  const xStep = dx >= 0 ? 1 : -1;
  const yStart = dy >= 0 ? 0 : H - 1;
  const yEnd = dy >= 0 ? H : -1;
  const yStep = dy >= 0 ? 1 : -1;

  // Running smudge color per scanline
  for (let y = yStart; y !== yEnd; y += yStep) {
    for (let x = xStart; x !== xEnd; x += xStep) {
      const i = getBufferIndex(x, y, W);

      // Sample behind this pixel along direction
      let sr = 0, sg = 0, sb = 0, sw = 0;
      for (let t = 1; t <= strength; t++) {
        const bx = Math.round(x - dx * t);
        const by = Math.round(y - dy * t);
        if (bx < 0 || bx >= W || by < 0 || by >= H) break;
        const bi = getBufferIndex(bx, by, W);
        const w = 1 / t; // closer samples weighted more
        sr += outBuf[bi] * w; sg += outBuf[bi + 1] * w; sb += outBuf[bi + 2] * w; sw += w;
      }

      if (sw > 0) {
        // Blend: 50% current pixel + 50% smudge trail
        const r = Math.round(buf[i] * 0.5 + (sr / sw) * 0.5);
        const g = Math.round(buf[i + 1] * 0.5 + (sg / sw) * 0.5);
        const b = Math.round(buf[i + 2] * 0.5 + (sb / sw) * 0.5);
        const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Smudge", func: smudge, optionTypes, options: defaults, defaults };
