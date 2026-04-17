import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { applyPalettePassToCanvas } from "palettes/backend";
import { defineFilter } from "filters/types";
import { renderLcdDisplayGL } from "./lcdDisplayGL";

const LAYOUT = { STRIPE: "STRIPE", PENTILE: "PENTILE", DIAMOND: "DIAMOND" };

export const optionTypes = {
  pixelSize: { type: RANGE, range: [3, 20], step: 1, default: 6, desc: "LCD pixel cell size" },
  subpixelLayout: { type: ENUM, options: [
    { name: "RGB Stripe", value: LAYOUT.STRIPE },
    { name: "PenTile", value: LAYOUT.PENTILE },
    { name: "Diamond", value: LAYOUT.DIAMOND }
  ], default: LAYOUT.STRIPE, desc: "Subpixel arrangement pattern" },
  brightness: { type: RANGE, range: [0.5, 2], step: 0.1, default: 1.2, desc: "Backlight brightness multiplier" },
  gapDarkness: { type: RANGE, range: [0, 1], step: 0.05, default: 0.3, desc: "Darkness of grid gaps between pixels" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  pixelSize: optionTypes.pixelSize.default,
  subpixelLayout: optionTypes.subpixelLayout.default,
  brightness: optionTypes.brightness.default,
  gapDarkness: optionTypes.gapDarkness.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const lcdDisplay = (input: any, options: typeof defaults = defaults) => {
  const { pixelSize, subpixelLayout, brightness, gapDarkness, palette } = options;
  const W = input.width, H = input.height;
  const paletteOpts = palette?.options as { levels?: number } | undefined;
  const isNearest = (palette as { name?: string })?.name === "nearest";
  const levels = isNearest ? (paletteOpts?.levels ?? 256) : 256;
  const rendered = renderLcdDisplayGL(input, W, H, pixelSize, subpixelLayout, brightness, gapDarkness, levels);
  if (!rendered) return input;
  const out = isNearest ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("LCD Display", "WebGL2", `layout=${subpixelLayout}${isNearest ? ` levels=${levels}` : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "LCD Display",
  func: lcdDisplay,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true,
});
