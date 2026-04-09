import { RANGE } from "constants/controlTypes";

const optionTypes = {
  levels: { type: RANGE, range: [1, 256], default: 2 }
};

const defaults = {
  levels: optionTypes.levels.default
};

// Scratch buffer reused across getColor calls — avoids per-pixel allocations.
// Safe because all callers consume the return value immediately.
const _out = [0, 0, 0, 0];

// Gets nearest color
const getColor = (
  color,
  options = defaults
) => {
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

export default {
  name: "nearest",
  getColor,
  options: defaults,
  optionTypes,
  defaults
};
