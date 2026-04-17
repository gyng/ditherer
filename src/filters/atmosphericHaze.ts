import { COLOR, ENUM, PALETTE, RANGE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderAtmosphericHazeGL } from "./atmosphericHazeGL";

const DEPTH_MODE = {
  LUMA: "LUMA",
  VERTICAL: "VERTICAL",
  HYBRID: "HYBRID",
};

export const optionTypes = {
  strength: { type: RANGE, range: [0, 1], step: 0.05, default: 0.45, desc: "Blend strength of the atmospheric haze" },
  horizon: { type: RANGE, range: [0, 1], step: 0.01, default: 0.42, desc: "Approximate horizon line; higher values push haze lower in the frame" },
  softness: { type: RANGE, range: [0.05, 0.6], step: 0.01, default: 0.18, desc: "How gradually the haze rolls in around the horizon" },
  highlightBloom: { type: RANGE, range: [0, 1], step: 0.05, default: 0.25, desc: "Extra glow on bright regions within the haze" },
  tint: { type: COLOR, default: [168, 206, 255], desc: "Atmospheric tint color" },
  depthMode: {
    type: ENUM,
    options: [
      { name: "Hybrid", value: DEPTH_MODE.HYBRID },
      { name: "Vertical", value: DEPTH_MODE.VERTICAL },
      { name: "Luma", value: DEPTH_MODE.LUMA },
    ],
    default: DEPTH_MODE.HYBRID,
    desc: "How haze depth is estimated from the image",
  },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  strength: optionTypes.strength.default,
  horizon: optionTypes.horizon.default,
  softness: optionTypes.softness.default,
  highlightBloom: optionTypes.highlightBloom.default,
  tint: optionTypes.tint.default,
  depthMode: optionTypes.depthMode.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const atmosphericHaze = (input: any, options: typeof defaults = defaults) => {
  const { strength, horizon, softness, highlightBloom, tint, depthMode, palette } = options;
  const W = input.width, H = input.height;
  const depthModeInt = depthMode === DEPTH_MODE.HYBRID ? 0 : depthMode === DEPTH_MODE.VERTICAL ? 1 : 2;
  const rendered = renderAtmosphericHazeGL(
    input, W, H,
    strength, horizon, softness, highlightBloom,
    [tint[0], tint[1], tint[2]],
    depthModeInt as 0 | 1 | 2,
  );
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Atmospheric Haze", "WebGL2", `mode=${depthMode} strength=${strength}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Atmospheric Haze",
  func: atmosphericHaze,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true,
});
