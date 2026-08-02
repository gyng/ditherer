import { COLOR, RANGE, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { logFilterBackend } from "../utils/index";
import { defineFilter } from "./types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import {
  normalizeColorOption,
  normalizePaletteOption,
  normalizeRangeOption,
} from "../utils/filterOptions";
import { renderDuotoneGL } from "./duotoneGL";

// Parse color that may be hex string (legacy URLs) or [r,g,b] array
const parseColor = (c: unknown): [number, number, number] => {
  if (Array.isArray(c)) return [c[0], c[1], c[2]];
  if (typeof c === "string") {
    const h = c.trim().replace("#", "");
    if (h.length === 6)
      return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
      ];
    if (h.length === 3)
      return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
  }
  return [0, 0, 0];
};

export const optionTypes = {
  shadowColor: {
    type: COLOR,
    default: [13, 2, 33],
    desc: "Shadow ink laid over paper through the deep tones",
  },
  highlightColor: {
    type: COLOR,
    default: [255, 107, 107],
    desc: "Second ink overprinting through the midtones",
  },
  paperColor: {
    type: COLOR,
    default: [244, 237, 224],
    desc: "Paper stock shown through the highlights",
  },
  shadowCurve: {
    type: RANGE,
    range: [0.5, 2],
    step: 0.05,
    default: 1,
    desc: "Gamma of the shadow-ink density curve",
  },
  highlightCurve: {
    type: RANGE,
    range: [0.5, 2],
    step: 0.05,
    default: 1,
    desc: "Width of the second-ink midtone density bump",
  },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  shadowColor: optionTypes.shadowColor.default,
  highlightColor: optionTypes.highlightColor.default,
  paperColor: optionTypes.paperColor.default,
  shadowCurve: optionTypes.shadowCurve.default,
  highlightCurve: optionTypes.highlightCurve.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const duotone = (input: any, options: Partial<typeof defaults> = defaults) => {
  const opts = { ...defaults, ...options };
  const W = input.width,
    H = input.height;
  const shadow = normalizeColorOption(parseColor(opts.shadowColor), defaults.shadowColor);
  const highlight = normalizeColorOption(parseColor(opts.highlightColor), defaults.highlightColor);
  const paper = normalizeColorOption(parseColor(opts.paperColor), defaults.paperColor);
  const shadowCurve = normalizeRangeOption(opts.shadowCurve, defaults.shadowCurve, 0.5, 2);
  const highlightCurve = normalizeRangeOption(opts.highlightCurve, defaults.highlightCurve, 0.5, 2);
  const palette = normalizePaletteOption(opts.palette, defaults.palette);

  const rendered = renderDuotoneGL(
    input,
    W,
    H,
    [shadow[0], shadow[1], shadow[2]],
    [highlight[0], highlight[1], highlight[2]],
    [paper[0], paper[1], paper[2]],
    shadowCurve,
    highlightCurve,
  );
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Duotone", "WebGL2", identity ? "" : "+palettePass");
  return out ?? input;
};

export default defineFilter({
  name: "Duotone",
  func: duotone,
  options: defaults,
  optionTypes,
  defaults,
  description:
    "Two-ink print duotone: shadow and midtone inks with separate density curves overprinted over paper for a true tonal crossover",
  requiresGL: true,
});
