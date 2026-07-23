import { RANGE, ENUM, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { logFilterBackend } from "../utils/index";
import { applyPalettePassToCanvas } from "../palettes/backend";
import { defineFilter } from "./types";
import { renderLcdDisplayGL } from "./lcdDisplayGL";
import {
  normalizeEnumOption,
  normalizePaletteOption,
  normalizeRangeOption,
} from "../utils/filterOptions";

const LAYOUT = { STRIPE: "STRIPE", PENTILE: "PENTILE", DIAMOND: "DIAMOND" };

export const optionTypes = {
  pixelSize: { type: RANGE, range: [4, 24], step: 1, default: 9, desc: "Logical pixel-cell size in output pixels" },
  subpixelLayout: { type: ENUM, options: [
    { name: "RGB Stripe", value: LAYOUT.STRIPE },
    { name: "PenTile", value: LAYOUT.PENTILE },
    { name: "Diamond", value: LAYOUT.DIAMOND }
  ], default: LAYOUT.STRIPE, desc: "Emitter topology: equal RGB stripes, shared-chroma RGBG, or diamond-shaped RGBG" },
  brightness: { type: RANGE, range: [0.5, 2], step: 0.05, default: 1, desc: "Emitting-subpixel brightness multiplier" },
  gapDarkness: { type: RANGE, range: [0, 1], step: 0.05, default: 0.65, desc: "Black-matrix darkness between emitting subpixels" },
  palette: { type: PALETTE, default: nearest, desc: "Optional final palette mapping after subpixel rendering" }
};

export const defaults = {
  pixelSize: optionTypes.pixelSize.default,
  subpixelLayout: optionTypes.subpixelLayout.default,
  brightness: optionTypes.brightness.default,
  gapDarkness: optionTypes.gapDarkness.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type LcdDisplayOptions = Partial<typeof defaults> & Record<string, unknown>;

const lcdDisplay = (input: any, options: LcdDisplayOptions = defaults) => {
  const supplied = { ...defaults, ...options };
  const resolved = {
    ...supplied,
    pixelSize: normalizeRangeOption(supplied.pixelSize, defaults.pixelSize, 4, 24, true),
    subpixelLayout: normalizeEnumOption(
      supplied.subpixelLayout,
      [LAYOUT.STRIPE, LAYOUT.PENTILE, LAYOUT.DIAMOND],
      defaults.subpixelLayout,
    ),
    brightness: normalizeRangeOption(supplied.brightness, defaults.brightness, 0.5, 2),
    gapDarkness: normalizeRangeOption(supplied.gapDarkness, defaults.gapDarkness, 0, 1),
    palette: normalizePaletteOption(supplied.palette, defaults.palette),
  };
  const { pixelSize, subpixelLayout, brightness, gapDarkness, palette } = resolved;
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
  description: "Magnified display-emitter proxy with equal RGB stripe, shared-chroma PenTile RGBG, and diamond-shaped RGBG layouts",
  requiresGL: true,
});
