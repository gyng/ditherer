import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderAnimeColorGradeGL } from "./animeColorGradeGL";

export const optionTypes = {
  shadowCool: { type: RANGE, range: [0, 1], step: 0.05, default: 0.55, desc: "Push shadows toward blue/cyan, like anime background grading" },
  highlightWarm: { type: RANGE, range: [0, 1], step: 0.05, default: 0.4, desc: "Warm bright areas toward yellow/red highlights" },
  blackPoint: { type: RANGE, range: [0, 128], step: 1, default: 0, desc: "Optional shadow input clip, like Levels black point" },
  whitePoint: { type: RANGE, range: [128, 255], step: 1, default: 255, desc: "Optional highlight input clip, like Levels white point" },
  contrast: { type: RANGE, range: [-0.5, 0.5], step: 0.05, default: 0.1, desc: "Global contrast shaping before the anime grade" },
  midtoneLift: { type: RANGE, range: [-0.5, 0.5], step: 0.05, default: 0.05, desc: "Lift or darken midtones before color grading" },
  vibrance: { type: RANGE, range: [0, 1.5], step: 0.05, default: 0.55, desc: "Boost muted colors more than already-saturated ones" },
  mix: { type: RANGE, range: [0, 1], step: 0.05, default: 1, desc: "Opacity of the anime-style color grade over the base image" },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  shadowCool: optionTypes.shadowCool.default,
  highlightWarm: optionTypes.highlightWarm.default,
  blackPoint: optionTypes.blackPoint.default,
  whitePoint: optionTypes.whitePoint.default,
  contrast: optionTypes.contrast.default,
  midtoneLift: optionTypes.midtoneLift.default,
  vibrance: optionTypes.vibrance.default,
  mix: optionTypes.mix.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const animeColorGrade = (input: any, options: typeof defaults = defaults) => {
  const { shadowCool, highlightWarm, blackPoint, whitePoint, contrast, midtoneLift, vibrance, mix, palette } = options;
  const W = input.width, H = input.height;
  const rendered = renderAnimeColorGradeGL(
    input, W, H,
    shadowCool, highlightWarm, blackPoint, whitePoint,
    contrast, midtoneLift, vibrance, mix,
  );
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Anime Color Grade", "WebGL2", identity ? "grade" : "grade+palettePass");
  return out ?? input;
};

export default defineFilter({
  name: "Anime Color Grade",
  func: animeColorGrade,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true,
});
