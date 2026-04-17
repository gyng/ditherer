import { RANGE, COLOR, PALETTE, ENUM } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";

import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderEdgeTraceGL } from "./edgeTraceGL";

const RENDER_MODE = {
  SOLID: "SOLID",
  OVERLAY: "OVERLAY" };

export const optionTypes = {
  threshold: { type: RANGE, range: [10, 100], step: 1, default: 30, desc: "Edge detection sensitivity" },
  lineWidth: { type: RANGE, range: [0.1, 3], step: 0.1, default: 1, desc: "Traced line thickness" },
  lineColor: { type: COLOR, default: [0, 0, 0], desc: "Edge line color" },
  renderMode: {
    type: ENUM,
    options: [
      { name: "Solid", value: RENDER_MODE.SOLID },
      { name: "Overlay", value: RENDER_MODE.OVERLAY },
    ],
    default: RENDER_MODE.SOLID,
    desc: "Draw traced edges on a flat background or overlay them on the source image" },
  overlayMix: { type: RANGE, range: [0, 1], step: 0.05, default: 0.7, desc: "How strongly traced lines blend over the source image in Overlay mode" },
  bgColor: { type: COLOR, default: [255, 255, 255], desc: "Background color" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  lineWidth: optionTypes.lineWidth.default,
  lineColor: optionTypes.lineColor.default,
  renderMode: optionTypes.renderMode.default,
  overlayMix: optionTypes.overlayMix.default,
  bgColor: optionTypes.bgColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const edgeTrace = (
  input: any,
  options: typeof defaults = defaults
) => {
  const {
    threshold,
    lineWidth,
    lineColor,
    renderMode,
    overlayMix,
    bgColor,
    palette
  } = options;

  const W = input.width;
  const H = input.height;

  const rendered = renderEdgeTraceGL(input, W, H,
      threshold, lineWidth,
      [lineColor[0], lineColor[1], lineColor[2]],
      [bgColor[0], bgColor[1], bgColor[2]],
      renderMode === RENDER_MODE.OVERLAY, overlayMix,);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Edge Trace", "WebGL2", `threshold=${threshold} mode=${renderMode}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Edge Trace",
  func: edgeTrace,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true });
