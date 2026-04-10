import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, srgbPaletteGetColor, clamp } from "utils";

export const optionTypes = {
  shadowR:    { type: RANGE, range: [-100, 100], step: 1, default: 0, desc: "Red shift in shadows" },
  shadowG:    { type: RANGE, range: [-100, 100], step: 1, default: 0, desc: "Green shift in shadows" },
  shadowB:    { type: RANGE, range: [-100, 100], step: 1, default: 0, desc: "Blue shift in shadows" },
  midtoneR:   { type: RANGE, range: [-100, 100], step: 1, default: 0, desc: "Red shift in midtones" },
  midtoneG:   { type: RANGE, range: [-100, 100], step: 1, default: 0, desc: "Green shift in midtones" },
  midtoneB:   { type: RANGE, range: [-100, 100], step: 1, default: 0, desc: "Blue shift in midtones" },
  highlightR: { type: RANGE, range: [-100, 100], step: 1, default: 0, desc: "Red shift in highlights" },
  highlightG: { type: RANGE, range: [-100, 100], step: 1, default: 0, desc: "Green shift in highlights" },
  highlightB: { type: RANGE, range: [-100, 100], step: 1, default: 0, desc: "Blue shift in highlights" },
  palette:    { type: PALETTE, default: nearest }
};

export const defaults = {
  shadowR: 0, shadowG: 0, shadowB: 0,
  midtoneR: 0, midtoneG: 0, midtoneB: 0,
  highlightR: 0, highlightG: 0, highlightB: 0,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Smooth masks for shadow / midtone / highlight regions
const shadowMask    = (t: number) => Math.max(0, 1 - t * 4);
const highlightMask = (t: number) => Math.max(0, t * 4 - 3);
const midtoneMask   = (t: number) => 1 - shadowMask(t) - highlightMask(t);

const colorBalance = (input, options = defaults) => {
  const {
    shadowR, shadowG, shadowB,
    midtoneR, midtoneG, midtoneB,
    highlightR, highlightG, highlightB,
    palette
  } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      const i = getBufferIndex(x, y, W);
      const t = (buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722) / 255;
      const sw = shadowMask(t);
      const mw = midtoneMask(t);
      const hw = highlightMask(t);

      const dr = sw * shadowR + mw * midtoneR + hw * highlightR;
      const dg = sw * shadowG + mw * midtoneG + hw * highlightG;
      const db = sw * shadowB + mw * midtoneB + hw * highlightB;

      const r = clamp(0, 255, Math.round(buf[i]     + dr * 2.55));
      const g = clamp(0, 255, Math.round(buf[i + 1] + dg * 2.55));
      const b = clamp(0, 255, Math.round(buf[i + 2] + db * 2.55));

      const col = srgbPaletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options);
      fillBufferPixel(outBuf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Color balance",
  func: colorBalance,
  options: defaults,
  optionTypes,
  defaults
};
