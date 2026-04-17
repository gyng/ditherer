import { RANGE, COLOR } from "constants/controlTypes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { renderStampGL } from "./stampGL";

export const optionTypes = {
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 136, desc: "Brightness cutoff between paper and ink" },
  inkColor: { type: COLOR, default: [24, 16, 16], desc: "Color of the stamped ink" },
  paperColor: { type: COLOR, default: [244, 233, 210], desc: "Paper color behind the stamp" },
  roughness: { type: RANGE, range: [0, 1], step: 0.05, default: 0.25, desc: "Edge breakup and uneven inking amount" }
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  inkColor: optionTypes.inkColor.default,
  paperColor: optionTypes.paperColor.default,
  roughness: optionTypes.roughness.default
};

const stamp = (input: any, options: typeof defaults = defaults) => {
  const { threshold, inkColor, paperColor, roughness } = options;
  const W = input.width;
  const H = input.height;

  const rendered = renderStampGL(input, W, H,
      threshold, roughness,
      [inkColor[0], inkColor[1], inkColor[2]],
      [paperColor[0], paperColor[1], paperColor[2]],);
  if (!rendered) return input;
  logFilterBackend("Stamp", "WebGL2", `threshold=${threshold} roughness=${roughness}`);
  return rendered;
};

export default defineFilter({
  name: "Stamp",
  func: stamp,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true });
