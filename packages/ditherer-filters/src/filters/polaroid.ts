import { RANGE, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { defineFilter } from "./types";
import { logFilterBackend } from "../utils/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { renderPolaroidGL } from "./polaroidGL";

export const optionTypes = {
  warmth: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.4,
    desc: "Warm color cast intensity",
  },
  fadedBlacks: {
    type: RANGE,
    range: [0, 50],
    step: 1,
    default: 20,
    desc: "Lift shadows for faded film look",
  },
  saturation: {
    type: RANGE,
    range: [0, 2],
    step: 0.05,
    default: 0.8,
    desc: "Color saturation level",
  },
  grain: {
    type: RANGE,
    range: [0, 0.5],
    step: 0.01,
    default: 0.08,
    desc: "Fixed developed-film grain amount",
  },
  vignette: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.35,
    desc: "Edge darkening intensity",
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette and quantization" },
};

export const defaults = {
  warmth: optionTypes.warmth.default,
  fadedBlacks: optionTypes.fadedBlacks.default,
  saturation: optionTypes.saturation.default,
  grain: optionTypes.grain.default,
  vignette: optionTypes.vignette.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const polaroid = (input: any, options: Partial<typeof defaults> = defaults) => {
  const {
    warmth = defaults.warmth,
    fadedBlacks = defaults.fadedBlacks,
    saturation = defaults.saturation,
    grain = defaults.grain,
    vignette = defaults.vignette,
    palette = defaults.palette,
  } = options;
  const W = input.width,
    H = input.height;
  const rendered = renderPolaroidGL(input, W, H, warmth, fadedBlacks, saturation, grain, vignette);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend(
    "Polaroid",
    "WebGL2",
    `warmth=${warmth} grain=${grain}${identity ? "" : "+palettePass"}`,
  );
  return out ?? input;
};

export default defineFilter({
  name: "Polaroid",
  func: polaroid,
  options: defaults,
  optionTypes,
  defaults,
  description:
    "Developed instant-film grade with warm dye balance, lifted shadows, restrained saturation, fixed grain, and optical vignetting",
  requiresGL: true,
});
