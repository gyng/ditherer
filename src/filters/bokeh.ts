import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderBokehGL } from "./bokehGL";

const SHAPE = { CIRCLE: "CIRCLE", HEXAGON: "HEXAGON", TRIANGLE: "TRIANGLE", PENTAGON: "PENTAGON", OCTAGON: "OCTAGON", STAR: "STAR" };
const SHAPE_TO_ID = { [SHAPE.CIRCLE]: 0, [SHAPE.HEXAGON]: 1, [SHAPE.TRIANGLE]: 2, [SHAPE.PENTAGON]: 3, [SHAPE.OCTAGON]: 4, [SHAPE.STAR]: 5 };

export const optionTypes = {
  radius: { type: RANGE, range: [2, 30], step: 1, default: 10, desc: "Size of blur kernel and bokeh highlight shapes" },
  threshold: { type: RANGE, range: [100, 255], step: 1, default: 185, desc: "Luminance cutoff — brighter pixels become bokeh highlights" },
  intensity: { type: RANGE, range: [0, 2], step: 0.1, default: 1, desc: "Brightness multiplier for the bokeh highlight shapes" },
  shape: { type: ENUM, options: [
    { name: "Circle", value: SHAPE.CIRCLE },
    { name: "Triangle (3-blade)", value: SHAPE.TRIANGLE },
    { name: "Pentagon (5-blade)", value: SHAPE.PENTAGON },
    { name: "Hexagon (6-blade)", value: SHAPE.HEXAGON },
    { name: "Octagon (8-blade)", value: SHAPE.OCTAGON },
    { name: "Star (diffraction)", value: SHAPE.STAR },
  ], default: SHAPE.CIRCLE, desc: "Shape of the bokeh highlight" },
  localDetect: { type: RANGE, range: [0, 1], step: 0.05, default: 0.7, desc: "0 = global threshold; 1 = only pixels brighter than their blurred neighbourhood (real light sources)" },
  softness: { type: RANGE, range: [0, 1], step: 0.05, default: 0.15, desc: "Feathering of the bokeh disc edges (smoothstep falloff)" },
  bubble: { type: RANGE, range: [0, 1], step: 0.05, default: 0.25, desc: "Hollow out the disc interior — 0 = solid, 1 = ring only (soap bubble)" },
  edgeRing: { type: RANGE, range: [0, 2], step: 0.1, default: 0.4, desc: "Boost brightness at the outer rim (combine with Bubble for a soap-bubble look)" },
  edgeFringe: { type: RANGE, range: [0, 1], step: 0.05, default: 0.3, desc: "Chromatic aberration: R/B discs shift in size and source position" },
  rotation: { type: RANGE, range: [0, 180], step: 1, default: 15, desc: "Rotation of the bokeh shape" },
  catsEye: { type: RANGE, range: [0, 1], step: 0.05, default: 0.85, desc: "Mechanical vignetting: shapes near frame edges become crescent-shaped" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  radius: optionTypes.radius.default,
  threshold: optionTypes.threshold.default,
  intensity: optionTypes.intensity.default,
  shape: optionTypes.shape.default as string,
  localDetect: optionTypes.localDetect.default,
  softness: optionTypes.softness.default,
  bubble: optionTypes.bubble.default,
  edgeRing: optionTypes.edgeRing.default,
  edgeFringe: optionTypes.edgeFringe.default,
  rotation: optionTypes.rotation.default,
  catsEye: optionTypes.catsEye.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const bokeh = (input: any, options: typeof defaults = defaults) => {
  const { radius, threshold, intensity, shape, localDetect, softness, bubble, edgeRing, edgeFringe, rotation, catsEye, palette } = options;
  const W = input.width, H = input.height;
  const shapeId = SHAPE_TO_ID[shape] ?? 0;
  const rendered = renderBokehGL(input, W, H, radius, threshold, intensity, shapeId, localDetect, softness, edgeFringe, rotation, catsEye, edgeRing, bubble);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Bokeh", "WebGL2", `radius=${radius} shape=${shape}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Bokeh",
  func: bokeh,
  optionTypes,
  options: defaults,
  defaults,
  requiresGL: true,
});
