import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderNewspaperGL } from "./newspaperGL";

export const optionTypes = {
  dotSize: { type: RANGE, range: [3, 16], step: 1, default: 6, desc: "Halftone dot size" },
  yellowing: { type: RANGE, range: [0, 1], step: 0.05, default: 0.4, desc: "Aged newsprint yellowing" },
  foldCrease: { type: RANGE, range: [0, 1], step: 0.05, default: 0.3, desc: "Visible fold crease intensity" },
  inkSmear: { type: RANGE, range: [0, 1], step: 0.05, default: 0.2, desc: "Ink bleeding/smearing amount" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  dotSize: optionTypes.dotSize.default,
  yellowing: optionTypes.yellowing.default,
  foldCrease: optionTypes.foldCrease.default,
  inkSmear: optionTypes.inkSmear.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type NewspaperOptions = typeof defaults & { _frameIndex?: number };

const newspaper = (input: any, options: NewspaperOptions = defaults) => {
  const { dotSize, yellowing, foldCrease, inkSmear, palette } = options;
  const frameIndex = options._frameIndex || 0;
  const W = input.width, H = input.height;
  const rendered = renderNewspaperGL(input, W, H, dotSize, yellowing, foldCrease, inkSmear, frameIndex);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Newspaper", "WebGL2", `dotSize=${dotSize}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Newspaper",
  func: newspaper,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true,
});
