import { PALETTE, RANGE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { logFilterBackend } from "../utils/index";
import { renderDaguerreotypeGL } from "./daguerreotypeGL";
import { defineFilter } from "./types";

export const optionTypes = {
  silverTone: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.35,
    desc: "Warm the neutral silver image particles toward a subtly gilded plate tone",
  },
  softFocus: {
    type: RANGE,
    range: [0, 4],
    step: 1,
    default: 0,
    desc: "Optional lens diffusion; zero preserves the medium's characteristic fine detail",
  },
  vignette: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.18,
    desc: "Restrained edge falloff from lens coverage and plate presentation",
  },
  metallic: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.7,
    desc: "Strength of the polished silver plate's directional mirror reflection",
  },
  gilding: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.65,
    desc: "Gold-chloride toning that strengthens image contrast and warms highlights",
  },
  viewAngle: {
    type: RANGE,
    range: [0, 360],
    step: 5,
    default: 25,
    desc: "Direction of the reflected viewing field across the mirror-polished plate",
  },
  plateAge: {
    type: RANGE,
    range: [0, 1],
    step: 0.02,
    default: 0.08,
    desc: "Subtle edge tarnish, plate speckling, and handling scratches",
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};

export const defaults = {
  silverTone: optionTypes.silverTone.default,
  softFocus: optionTypes.softFocus.default,
  vignette: optionTypes.vignette.default,
  metallic: optionTypes.metallic.default,
  gilding: optionTypes.gilding.default,
  viewAngle: optionTypes.viewAngle.default,
  plateAge: optionTypes.plateAge.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const daguerreotype = (input: any, options: Partial<typeof defaults> = defaults) => {
  const resolved = { ...defaults, ...options };
  const { silverTone, softFocus, vignette, metallic, gilding, viewAngle, plateAge, palette } =
    resolved;
  const width = input.width;
  const height = input.height;
  const rendered = renderDaguerreotypeGL(
    input,
    width,
    height,
    silverTone,
    softFocus,
    vignette,
    metallic,
    gilding,
    viewAngle,
    plateAge,
  );
  if (!rendered) return input;

  const identity = paletteIsIdentity(palette);
  const output = identity ? rendered : applyPalettePassToCanvas(rendered, width, height, palette);
  logFilterBackend(
    "Daguerreotype",
    "WebGL2",
    `gilding=${gilding} reflection=${metallic}${identity ? "" : "+palettePass"}`,
  );
  return output ?? input;
};

export default defineFilter({
  name: "Daguerreotype",
  func: daguerreotype,
  optionTypes,
  options: defaults,
  defaults,
  description:
    "Highly detailed direct-positive image particles over a mirror-polished, subtly aged silver plate",
  requiresGL: true,
});
