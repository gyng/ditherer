import { cloneCanvas } from "utils";
import { defineFilter } from "filters/types";

// Pass-through filter. Used as the default chain entry after a "Clear chain"
// action so the user is left with a clean baseline they can build on without
// any pixel-level effect already applied.
export const optionTypes = {};
export const defaults = {};

const noop = (input: any) => cloneCanvas(input, true);

export default defineFilter({
  name: "None",
  func: noop,
  options: defaults,
  optionTypes,
  defaults
});
