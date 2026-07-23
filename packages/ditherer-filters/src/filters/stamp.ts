import { RANGE, COLOR, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { logFilterBackend } from "../utils/index";
import { defineFilter } from "./types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import {
  normalizeRangeOption,
  normalizeColorOption,
  normalizePaletteOption,
} from "../utils/filterOptions";
import { renderStampGL } from "./stampGL";

export const optionTypes = {
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 136, desc: "Brightness cutoff between paper and ink" },
  roughness: { type: RANGE, range: [0, 1], step: 0.05, default: 0.25, desc: "Ink break-up at shape edges and uneven inking amount" },
  inkColor: { type: COLOR, default: [24, 16, 16], desc: "Color of the stamped ink" },
  paperColor: { type: COLOR, default: [244, 233, 210], desc: "Paper color behind the stamp" },
  palette: { type: PALETTE, default: nearest, desc: "Optional palette applied after the stamp" }
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  roughness: optionTypes.roughness.default,
  inkColor: optionTypes.inkColor.default,
  paperColor: optionTypes.paperColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const stamp = (input: any, options: typeof defaults = defaults) => {
  const threshold = normalizeRangeOption(options?.threshold, defaults.threshold, 0, 255, true);
  const roughness = normalizeRangeOption(options?.roughness, defaults.roughness, 0, 1);
  const inkColor = normalizeColorOption(options?.inkColor, defaults.inkColor);
  const paperColor = normalizeColorOption(options?.paperColor, defaults.paperColor);
  const palette = normalizePaletteOption(options?.palette, defaults.palette);
  const W = input.width;
  const H = input.height;

  const rendered = renderStampGL(input, W, H,
      threshold, roughness,
      [inkColor[0], inkColor[1], inkColor[2]],
      [paperColor[0], paperColor[1], paperColor[2]],);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Stamp", "WebGL2", `threshold=${threshold} roughness=${roughness}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Stamp",
  func: stamp,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true });
