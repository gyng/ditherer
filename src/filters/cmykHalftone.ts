import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import { logFilterBackend } from "utils";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderCmykHalftoneGL } from "./cmykHalftoneGL";

export const optionTypes = {
  dotSize: { type: RANGE, range: [2, 20], step: 1, default: 6, desc: "Halftone dot diameter" },
  angleC: { type: RANGE, range: [0, 180], step: 5, default: 15, desc: "Cyan screen angle in degrees" },
  angleM: { type: RANGE, range: [0, 180], step: 5, default: 75, desc: "Magenta screen angle in degrees" },
  angleY: { type: RANGE, range: [0, 180], step: 5, default: 0, desc: "Yellow screen angle in degrees" },
  angleK: { type: RANGE, range: [0, 180], step: 5, default: 45, desc: "Black (key) screen angle in degrees" },
  paperColor: { type: COLOR, default: [255, 250, 245], desc: "Background paper color" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  dotSize: optionTypes.dotSize.default,
  angleC: optionTypes.angleC.default,
  angleM: optionTypes.angleM.default,
  angleY: optionTypes.angleY.default,
  angleK: optionTypes.angleK.default,
  paperColor: optionTypes.paperColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const cmykHalftone = (input: any, options: typeof defaults = defaults) => {
  const { dotSize, angleC, angleM, angleY, angleK, paperColor, palette } = options;
  const W = input.width;
  const H = input.height;

  const rendered = renderCmykHalftoneGL(input, W, H,
      dotSize, angleC, angleM, angleY, angleK,
      [paperColor[0], paperColor[1], paperColor[2]],);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("CMYK Halftone", "WebGL2", `dotSize=${dotSize}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "CMYK Halftone",
  func: cmykHalftone,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true });
