import { COLOR, RANGE } from "constants/controlTypes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { renderDuplexPrintGL } from "./duplexPrintGL";

export const optionTypes = {
  inkA: { type: COLOR, default: [28, 24, 24], desc: "Shadow ink color used for the darker end of the print" },
  inkB: { type: COLOR, default: [194, 58, 58], desc: "Highlight/accent ink color used for the lighter end of the print" },
  mixCurve: { type: RANGE, range: [0.5, 2], step: 0.05, default: 1, desc: "Bias toward the dark or accent plate across the tonal ramp" },
  paperColor: { type: COLOR, default: [244, 237, 224], desc: "Paper stock color visible under the duplex inks" }
};

export const defaults = {
  inkA: optionTypes.inkA.default,
  inkB: optionTypes.inkB.default,
  mixCurve: optionTypes.mixCurve.default,
  paperColor: optionTypes.paperColor.default
};

const duplexPrint = (input: any, options: typeof defaults = defaults) => {
  const { inkA, inkB, mixCurve, paperColor } = options;
  const W = input.width;
  const H = input.height;

  const rendered = renderDuplexPrintGL(input, W, H,
      [inkA[0], inkA[1], inkA[2]],
      [inkB[0], inkB[1], inkB[2]],
      [paperColor[0], paperColor[1], paperColor[2]],
      mixCurve,);
  if (!rendered) return input;
  logFilterBackend("Duplex Print", "WebGL2", `curve=${mixCurve}`);
  return rendered;
};

export default defineFilter({
  name: "Duplex Print",
  func: duplexPrint,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true });
