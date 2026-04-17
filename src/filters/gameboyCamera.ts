import { ACTION, RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import { logFilterBackend } from "utils";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderGameboyCameraGL } from "./gameboyCameraGL";

export const optionTypes = {
  resolution: { type: RANGE, range: [64, 256], step: 1, default: 128, desc: "Output resolution (square)" },
  contrast: { type: RANGE, range: [0.5, 3], step: 0.05, default: 1.8, desc: "Contrast boost before quantization" },
  edgeEnhance: { type: RANGE, range: [0, 2], step: 0.05, default: 0.8, desc: "Edge sharpening strength" },
  ditherStrength: { type: RANGE, range: [0, 1], step: 0.01, default: 0.7, desc: "Bayer dither intensity" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 10 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
      if (actions.isAnimating()) { actions.stopAnimLoop(); }
      else { actions.startAnimLoop(inputCanvas, options.animSpeed || 10); }
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  resolution: optionTypes.resolution.default,
  contrast: optionTypes.contrast.default,
  edgeEnhance: optionTypes.edgeEnhance.default,
  ditherStrength: optionTypes.ditherStrength.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 4 } }
};

const gameboyCamera = (input: any, options: typeof defaults = defaults) => {
  const { resolution, contrast, edgeEnhance, ditherStrength, palette } = options;
  const W = input.width, H = input.height;
  const aspect = W / H;
  const downW = resolution;
  const downH = Math.round(resolution / aspect);
  const rendered = renderGameboyCameraGL(input, W, H, downW, downH, contrast, edgeEnhance, ditherStrength);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Gameboy Camera", "WebGL2", `res=${resolution}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Gameboy Camera",
  func: gameboyCamera,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true,
});
