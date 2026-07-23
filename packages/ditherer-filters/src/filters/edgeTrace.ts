import { RANGE, COLOR, PALETTE, ENUM } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { logFilterBackend } from "../utils/index";

import { defineFilter } from "./types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { renderEdgeTraceGL } from "./edgeTraceGL";

const RENDER_MODE = {
  SOLID: "SOLID",
  OVERLAY: "OVERLAY" };

export const optionTypes = {
  threshold: { type: RANGE, range: [10, 100], step: 1, default: 30, desc: "Minimum gradient strength — higher values trace fewer, stronger edges" },
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
  overlayMix: { type: RANGE, range: [0, 1], step: 0.05, default: 0.7, desc: "How strongly traced lines blend over the source image", visibleWhen: (options: any) => options.renderMode === RENDER_MODE.OVERLAY },
  bgColor: { type: COLOR, default: [255, 255, 255], desc: "Solid-mode background color", visibleWhen: (options: any) => options.renderMode !== RENDER_MODE.OVERLAY },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette and quantization" }
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
  options: Partial<typeof defaults> = defaults
) => {
  const finite = (value: unknown, fallback: number, min: number, max: number) => {
    const parsed = typeof value === "number" ? value : Number.NaN;
    return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
  };
  const color = (value: unknown, fallback: number[]) => (
    Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(channel => typeof channel === "number" && Number.isFinite(channel))
      ? value.slice(0, 3).map(channel => Math.max(0, Math.min(255, channel)))
      : fallback
  );
  const threshold = finite(options.threshold, defaults.threshold, 10, 100);
  const lineWidth = finite(options.lineWidth, defaults.lineWidth, 0.1, 3);
  const lineColor = color(options.lineColor, defaults.lineColor);
  const renderMode = options.renderMode === RENDER_MODE.OVERLAY ? RENDER_MODE.OVERLAY : RENDER_MODE.SOLID;
  const overlayMix = finite(options.overlayMix, defaults.overlayMix, 0, 1);
  const bgColor = color(options.bgColor, defaults.bgColor);
  const palette = options.palette ?? defaults.palette;

  if (renderMode === RENDER_MODE.OVERLAY && overlayMix === 0) return input;

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
