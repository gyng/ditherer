import { RANGE } from "constants/controlTypes";
import type { PaletteColor, PaletteDefinition } from "./types";

const optionTypes = {
  levels: { type: RANGE, range: [1, 256], default: 2 }
};

const defaults = {
  levels: optionTypes.levels.default
};

// Scratch buffer reused across getColor calls — avoids per-pixel allocations.
// Safe because all callers consume the return value immediately.
const _out: PaletteColor = [0, 0, 0, 0];

// Gets nearest color
const getColor = (
  color: number[],
  options = defaults
): number[] => {
  if (options.levels >= 256) {
    return color;
  }

  const step = 255 / (options.levels - 1);
  _out[0] = Math.round(Math.round(color[0] / step) * step);
  _out[1] = Math.round(Math.round(color[1] / step) * step);
  _out[2] = Math.round(Math.round(color[2] / step) * step);
  _out[3] = color[3];
  return _out;
};

const nearest: PaletteDefinition<typeof defaults> = {
  name: "nearest",
  getColor,
  options: defaults,
  optionTypes,
  defaults
};

export default nearest;
