import { COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, srgbPaletteGetColor } from "utils";

// Parse color that may be hex string (legacy URLs) or [r,g,b] array
const parseColor = (c: any): [number, number, number] => {
  if (Array.isArray(c)) return [c[0], c[1], c[2]];
  if (typeof c === "string") {
    const h = c.trim().replace("#", "");
    if (h.length === 6) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    if (h.length === 3) return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
  }
  return [0, 0, 0];
};

export const optionTypes = {
  shadowColor: { type: COLOR, default: [13, 2, 33], desc: "Color mapped to dark tones" },
  highlightColor: { type: COLOR, default: [255, 107, 107], desc: "Color mapped to bright tones" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  shadowColor: optionTypes.shadowColor.default,
  highlightColor: optionTypes.highlightColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const duotone = (input, options = defaults) => {
  const { shadowColor, highlightColor, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  const shadow = parseColor(shadowColor);
  const highlight = parseColor(highlightColor);

  const outBuf = new Uint8ClampedArray(buf.length);
  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      const i = getBufferIndex(x, y, W);
      const t = (buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722) / 255;
      const r = Math.round(shadow[0] + t * (highlight[0] - shadow[0]));
      const g = Math.round(shadow[1] + t * (highlight[1] - shadow[1]));
      const b = Math.round(shadow[2] + t * (highlight[2] - shadow[2]));
      const col = srgbPaletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options);
      fillBufferPixel(outBuf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Duotone",
  func: duotone,
  options: defaults,
  optionTypes,
  defaults
};
