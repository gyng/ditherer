import { RANGE, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { logFilterBackend } from "../utils/index";
import { defineFilter } from "./types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { renderLenticularGL } from "./lenticularGL";

export const optionTypes = {
  stripWidth: {
    type: RANGE,
    range: [6, 48],
    step: 1,
    default: 18,
    desc: "Lenticule pitch in output pixels",
  },
  angle: {
    type: RANGE,
    range: [0, 180],
    step: 1,
    default: 0,
    desc: "Orientation of the parallel cylindrical lenses",
  },
  viewAngle: {
    type: RANGE,
    range: [-1, 1],
    step: 0.01,
    default: 0,
    desc: "Normalized viewing angle through the lens sheet",
  },
  viewCount: {
    type: RANGE,
    range: [2, 12],
    step: 1,
    default: 6,
    desc: "Synthetic source views interlaced beneath each lenticule",
  },
  parallax: {
    type: RANGE,
    range: [0, 24],
    step: 0.5,
    default: 6,
    desc: "Maximum source displacement between synthetic views",
  },
  crosstalk: {
    type: RANGE,
    range: [0, 0.5],
    step: 0.01,
    default: 0.12,
    desc: "Leakage from the neighboring interlaced views",
  },
  lensStrength: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.3,
    desc: "Cylindrical lens transmission and highlight strength",
  },
  palette: {
    type: PALETTE,
    default: nearest,
    desc: "Optional final palette mapping after the lens-sheet simulation",
  },
};

export const defaults = {
  stripWidth: optionTypes.stripWidth.default,
  angle: optionTypes.angle.default,
  viewAngle: optionTypes.viewAngle.default,
  viewCount: optionTypes.viewCount.default,
  parallax: optionTypes.parallax.default,
  crosstalk: optionTypes.crosstalk.default,
  lensStrength: optionTypes.lensStrength.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

type LenticularOptions = Partial<typeof defaults> & Record<string, unknown>;

const lenticular = (input: any, options: LenticularOptions = defaults) => {
  const resolved = { ...defaults, ...options };
  const { stripWidth, angle, viewAngle, viewCount, parallax, crosstalk, lensStrength, palette } =
    resolved;
  const W = input.width,
    H = input.height;
  const rad = (angle * Math.PI) / 180;

  const rendered = renderLenticularGL(
    input,
    W,
    H,
    stripWidth,
    rad,
    viewAngle,
    viewCount,
    parallax,
    crosstalk,
    lensStrength,
  );
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend(
    "Lenticular",
    "WebGL2",
    `pitch=${stripWidth} views=${viewCount} angle=${viewAngle}${identity ? "" : "+palettePass"}`,
  );
  return out ?? input;
};

export default defineFilter({
  name: "Lenticular",
  func: lenticular,
  optionTypes,
  options: defaults,
  defaults,
  description:
    "Single-image lenticular-sheet proxy with synthetic interlaced views, viewing-angle selection, cylindrical transmission, and crosstalk",
  requiresGL: true,
});
