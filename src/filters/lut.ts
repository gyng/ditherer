import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderLUTGL, LUT_PRESET } from "./lutGL";

const PRESET_NAMES = {
  ACES:          "ACES Filmic",
  REINHARD:      "Reinhard",
  UNCHARTED2:    "Uncharted 2 (Hable)",
  TEAL_ORANGE:   "Teal & Orange",
  BLEACH_BYPASS: "Bleach Bypass",
  CROSS_PROCESS: "Cross Process",
  KODACHROME:    "Kodachrome",
  FADED_FILM:    "Faded Film",
  TECHNICOLOR:   "Technicolor",
  MATRIX_GREEN:  "Matrix Green",
  AMBER_NOIR:    "Amber Noir",
  COLD_WINTER:   "Cold Winter",
  LOMO:          "Lomo",
  VELVIA:        "Velvia (Fuji)",
  PORTRA:        "Portra (Kodak)",
  TRIX_BW:       "Tri-X B&W",
  DUNE:          "Dune",
  MOONRISE:      "Moonrise",
  CLARENDON:     "Clarendon",
  NASHVILLE:     "Nashville",
  MAGIC_HOUR:    "Magic Hour",
  JOHN_WICK:     "John Wick",
  WES_ANDERSON:  "Wes Anderson",
  FURY_ROAD:     "Fury Road",
  NEGATIVE:      "Negative",
  KODAK_GOLD:    "Kodak Gold 200",
  FUJI_PRO_400H: "Fuji Pro 400H",
  CINESTILL_800T:"CineStill 800T",
  ILFORD_HP5:    "Ilford HP5+",
  EKTACHROME:    "Kodak Ektachrome",
  AGFA_VISTA:    "Agfa Vista",
  DEAKINS:       "Deakins (cool moody)",
  AMELIE:        "Amélie (storybook)",
  SAVING_RYAN:   "Saving Private Ryan",
  THREE_HUNDRED: "300",
  BLADE_RUNNER:  "Blade Runner (1982)",
  SIN_CITY:      "Sin City",
  BREAKING_BAD:  "Breaking Bad",
  MR_ROBOT:      "Mr. Robot",
  REVENANT:      "The Revenant",
  INCEPTION:     "Inception",
  DRIVE:         "Drive",
  STRANGER_THINGS: "Stranger Things",
  JOKER_2019:    "Joker (2019)" } as const;

const PRESET_KEYS = [
  "ACES", "REINHARD", "UNCHARTED2", "TEAL_ORANGE", "BLEACH_BYPASS",
  "CROSS_PROCESS", "KODACHROME", "FADED_FILM", "TECHNICOLOR",
  "MATRIX_GREEN", "AMBER_NOIR", "COLD_WINTER",
  "LOMO", "VELVIA", "PORTRA", "TRIX_BW", "DUNE", "MOONRISE",
  "CLARENDON", "NASHVILLE", "MAGIC_HOUR", "JOHN_WICK",
  "WES_ANDERSON", "FURY_ROAD", "NEGATIVE",
  "KODAK_GOLD", "FUJI_PRO_400H", "CINESTILL_800T", "ILFORD_HP5",
  "EKTACHROME", "AGFA_VISTA", "DEAKINS", "AMELIE",
  "SAVING_RYAN", "THREE_HUNDRED", "BLADE_RUNNER", "SIN_CITY",
  "BREAKING_BAD", "MR_ROBOT", "REVENANT", "INCEPTION",
  "DRIVE", "STRANGER_THINGS", "JOKER_2019",
] as const;

export const optionTypes = {
  preset: {
    type: ENUM,
    options: PRESET_KEYS.map(k => ({ name: PRESET_NAMES[k], value: k })),
    default: "ACES" as typeof PRESET_KEYS[number],
    desc: "Colour-grade lookup — iconic tonemap and film-style looks" },
  strength: { type: RANGE, range: [0, 1.5], step: 0.05, default: 1, desc: "Blend/overshoot toward graded image (0 = source, 1 = fully graded, >1 = push past grade for extreme looks)" },
  exposure: { type: RANGE, range: [-5, 5], step: 0.1, default: 0, desc: "Pre-grade exposure in stops (2^exposure multiplier)" },
  palette: { type: PALETTE, default: nearest } };

export const defaults = {
  preset: optionTypes.preset.default,
  strength: optionTypes.strength.default,
  exposure: optionTypes.exposure.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } } };


const lut = (input: any, options: typeof defaults = defaults) => {
  const { preset, strength, exposure, palette } = options;
  const W = input.width, H = input.height;
  const presetId = LUT_PRESET[preset] ?? 0;

  const rendered = renderLUTGL(input, W, H, presetId, strength, exposure);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("LUT", "WebGL2", `${preset} str=${strength}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "LUT",
  func: lut,
  optionTypes,
  options: defaults,
  defaults,
  description: "Colour grading lookup with iconic tonemaps (ACES, Reinhard, Hable) and film styles (Teal & Orange, Bleach Bypass, Kodachrome, Technicolor, Cross Process, Matrix Green, Amber Noir, Faded Film, Cold Winter)",
  requiresGL: true });
