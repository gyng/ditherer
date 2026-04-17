import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { applyPalettePassToCanvas } from "palettes/backend";
import { defineFilter } from "filters/types";
import { renderLensDistortionGL } from "./lensDistortionGL";

export const optionTypes = {
  k1: { type: RANGE, range: [-2, 2], step: 0.01, default: 0.3, desc: "Primary distortion (+barrel, -pincushion)" },
  k2: { type: RANGE, range: [-1, 1], step: 0.01, default: 0, desc: "Secondary radial distortion for fine-tuning edges" },
  zoom: { type: RANGE, range: [0.1, 3], step: 0.01, default: 1, desc: "Zoom factor to compensate for distortion cropping" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  k1: optionTypes.k1.default,
  k2: optionTypes.k2.default,
  zoom: optionTypes.zoom.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const lensDistortion = (input: any, options: typeof defaults = defaults) => {
  const { k1, k2, zoom, palette } = options;
  const W = input.width, H = input.height;
  const paletteOpts = palette?.options as { levels?: number } | undefined;
  const isNearest = (palette as { name?: string })?.name === "nearest";
  const levels = isNearest ? (paletteOpts?.levels ?? 256) : 256;
  const rendered = renderLensDistortionGL(input, W, H, k1, k2, zoom, levels);
  if (!rendered) return input;
  const out = isNearest ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Lens distortion", "WebGL2", `k1=${k1} k2=${k2} zoom=${zoom}${isNearest ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Lens distortion",
  func: lensDistortion,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true,
});
