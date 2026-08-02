import { RANGE, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { logFilterBackend } from "../utils/index";
import { defineFilter } from "./types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { renderInfraredGL } from "./infraredGL";

export const optionTypes = {
  intensity: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.9,
    desc: "Blend from the visible source into the estimated infrared rendering",
  },
  falseColor: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.85,
    desc: "Blend from monochrome Wood effect into Aerochrome-style NIR/red/green channel mapping",
  },
  foliageResponse: {
    type: RANGE,
    range: [0, 2],
    step: 0.05,
    default: 1,
    desc: "How strongly visible green-excess materials contribute to the estimated near-infrared band",
  },
  skySuppression: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.65,
    desc: "Darken blue-dominant sky proxies in the estimated near-infrared band",
  },
  contrast: {
    type: RANGE,
    range: [0.5, 2],
    step: 0.05,
    default: 1.15,
    desc: "Film-density contrast applied after infrared channel mapping",
  },
  grain: {
    type: RANGE,
    range: [0, 0.12],
    step: 0.005,
    default: 0.015,
    desc: "Fine deterministic film-density grain",
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" },
};

export const defaults = {
  intensity: optionTypes.intensity.default,
  falseColor: optionTypes.falseColor.default,
  foliageResponse: optionTypes.foliageResponse.default,
  skySuppression: optionTypes.skySuppression.default,
  contrast: optionTypes.contrast.default,
  grain: optionTypes.grain.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const infrared = (input: any, options: Partial<typeof defaults> = defaults) => {
  const resolved = { ...defaults, ...options };
  const { intensity, falseColor, foliageResponse, skySuppression, contrast, grain, palette } =
    resolved;
  const W = input.width,
    H = input.height;

  const rendered = renderInfraredGL(
    input,
    W,
    H,
    intensity,
    falseColor,
    foliageResponse,
    skySuppression,
    contrast,
    grain,
  );
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Infrared", "WebGL2", `intensity=${intensity}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Infrared",
  func: infrared,
  optionTypes,
  options: defaults,
  defaults,
  description:
    "Estimated visible-RGB infrared film response with monochrome Wood effect and Aerochrome-style channel mapping",
  requiresGL: true,
});
