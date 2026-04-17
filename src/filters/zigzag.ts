import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import { logFilterBackend } from "utils";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderZigzagGL } from "./zigzagGL";

export const optionTypes = {
  lineSpacing: { type: RANGE, range: [2, 12], step: 1, default: 4, desc: "Distance between zigzag lines" },
  angle: { type: RANGE, range: [0, 180], step: 1, default: 45, desc: "Line angle in degrees" },
  amplitude: { type: RANGE, range: [1, 10], step: 1, default: 3, desc: "Zigzag wave height" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  lineSpacing: optionTypes.lineSpacing.default,
  angle: optionTypes.angle.default,
  amplitude: optionTypes.amplitude.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const clamp = (v: number): number => Math.max(0, Math.min(255, v));

const zigzag = (
  input: any,
  options: typeof defaults = defaults
) => {
  const {
    lineSpacing,
    angle,
    amplitude,
    palette
  } = options;

  const W = input.width;
  const H = input.height;
  const angleRad = (angle * Math.PI) / 180;

  const rendered = renderZigzagGL(input, W, H, lineSpacing, amplitude, angleRad);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Zigzag", "WebGL2", `spacing=${lineSpacing} angle=${angle}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Zigzag",
  func: zigzag,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true });
