import { RANGE, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { logFilterBackend } from "../utils/index";
import { normalizeRangeOption } from "../utils/filterOptions";
import { defineFilter } from "./types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { renderSolarizeGL } from "./solarizeGL";

export const optionTypes = {
  threshold: {
    type: RANGE,
    range: [0, 255],
    step: 1,
    default: 128,
    desc: "Reversal point — the tone at which the Sabattier curve turns over",
  },
  strength: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 1,
    desc: "Reversal strength (0 = no change, 1 = full tone reversal)",
  },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  strength: optionTypes.strength.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const solarize = (input: any, options: Partial<typeof defaults> = defaults) => {
  const threshold = normalizeRangeOption(options.threshold, defaults.threshold, 0, 255, true);
  const strength = normalizeRangeOption(options.strength, defaults.strength, 0, 1);
  const palette = options.palette ?? defaults.palette;
  const W = input.width,
    H = input.height;

  const rendered = renderSolarizeGL(input, W, H, threshold / 255, strength);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend(
    "Solarize",
    "WebGL2",
    `reversal=${threshold} strength=${strength}${identity ? "" : "+palettePass"}`,
  );
  return out ?? input;
};

export default defineFilter({
  name: "Solarize",
  func: solarize,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true,
});
