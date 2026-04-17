import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import { logFilterBackend } from "utils";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderSwirlGL } from "./swirlGL";

export const optionTypes = {
  angle: { type: RANGE, range: [-720, 720], step: 5, default: 180, desc: "Maximum rotation in degrees at the center of the swirl" },
  radius: { type: RANGE, range: [0, 1], step: 0.01, default: 0.8, desc: "Swirl area size as fraction of image diagonal" },
  centerX: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Horizontal center of the swirl (0=left, 1=right)" },
  centerY: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5, desc: "Vertical center of the swirl (0=top, 1=bottom)" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  angle: optionTypes.angle.default,
  radius: optionTypes.radius.default,
  centerX: optionTypes.centerX.default,
  centerY: optionTypes.centerY.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const swirlFilter = (input: any, options: typeof defaults = defaults) => {
  const { angle, radius, centerX, centerY, palette } = options;
  const W = input.width;
  const H = input.height;

  const cx = W * centerX;
  const cy = H * centerY;
  const maxDim = Math.max(W, H);
  const effectRadius = radius * maxDim;
  const angleRad = (angle * Math.PI) / 180;

  const rendered = renderSwirlGL(input, W, H, cx, cy, effectRadius, angleRad);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Swirl", "WebGL2", `angle=${angle} r=${radius}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Swirl",
  func: swirlFilter,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true });
