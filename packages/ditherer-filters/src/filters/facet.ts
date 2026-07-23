import { RANGE, COLOR, ENUM, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { logFilterBackend } from "../utils/index";
import { paletteIsIdentity, applyPalettePassToCanvas } from "../palettes/backend";
import { defineFilter } from "./types";
import { renderFacetGL } from "./facetGL";

const FILL_MODE = {
  AVERAGE: "AVERAGE",
  CENTER: "CENTER"
};

export const optionTypes = {
  facetSize: { type: RANGE, range: [6, 64], step: 1, default: 18, desc: "Average width of each faceted cell" },
  jitter: { type: RANGE, range: [0, 1], step: 0.05, default: 0.35, desc: "Randomize each cell center for a less rigid grid" },
  seed: { type: RANGE, range: [0, 9999], step: 1, default: 1618, desc: "Deterministic layout variation independent of size and jitter" },
  seamWidth: { type: RANGE, range: [0, 6], step: 1, default: 1, desc: "Dark seam width between facets" },
  lineColor: { type: COLOR, default: [28, 26, 24], desc: "Color of the facet seams" },
  fillMode: {
    type: ENUM,
    options: [
      { name: "Local mean", value: FILL_MODE.AVERAGE },
      { name: "Center sample", value: FILL_MODE.CENTER }
    ],
    default: FILL_MODE.AVERAGE,
    desc: "Use a nearby square-window mean or sample the exact cell center"
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette and quantization" }
};

export const defaults = {
  facetSize: optionTypes.facetSize.default,
  jitter: optionTypes.jitter.default,
  seed: optionTypes.seed.default,
  seamWidth: optionTypes.seamWidth.default,
  lineColor: optionTypes.lineColor.default,
  fillMode: optionTypes.fillMode.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// GL path: CENTER samples source at seed position directly; AVERAGE
// approximates per-cell averaging via a separable box-blur pre-pass
// with radius facetSize/2.
const facet = (input: any, options: Partial<typeof defaults> = defaults) => {
  const facetSize = options.facetSize ?? defaults.facetSize;
  const jitter = options.jitter ?? defaults.jitter;
  const seed = options.seed ?? defaults.seed;
  const seamWidth = options.seamWidth ?? defaults.seamWidth;
  const lineColor = options.lineColor ?? defaults.lineColor;
  const fillMode = options.fillMode ?? defaults.fillMode;
  const palette = options.palette ?? defaults.palette;
  const W = input.width, H = input.height;
  const rendered = renderFacetGL(
    input, W, H,
    Math.max(1, Math.round(facetSize)), jitter, Math.max(0, Math.round(seamWidth)),
    [lineColor[0], lineColor[1], lineColor[2]],
    fillMode === FILL_MODE.AVERAGE,
    Math.max(0, Math.round(seed)),
  );
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Facet", "WebGL2", `size=${facetSize} fill=${fillMode}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Facet",
  func: facet,
  options: defaults,
  optionTypes,
  defaults,
  description: "Break the image into seeded faceted planes with antialiased seams and center or local-mean color",
  requiresGL: true,
});
