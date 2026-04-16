import { RANGE, COLOR, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor, logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { contourLinesGLAvailable, renderContourLinesGL, type ContourFillMode } from "./contourLinesGL";

const FILL_MODE = { LINES: "LINES", FILLED: "FILLED", BOTH: "BOTH" };

export const optionTypes = {
  levels: { type: RANGE, range: [3, 30], step: 1, default: 10, desc: "Number of contour levels" },
  lineWidth: { type: RANGE, range: [0.1, 4], step: 0.1, default: 1, desc: "Contour line thickness in pixels" },
  lineColor: { type: COLOR, default: [0, 0, 0], desc: "Contour line color" },
  fillMode: { type: ENUM, options: [
    { name: "Lines only", value: FILL_MODE.LINES },
    { name: "Filled bands", value: FILL_MODE.FILLED },
    { name: "Lines + Fill", value: FILL_MODE.BOTH }
  ], default: FILL_MODE.BOTH, desc: "Show contour lines, filled bands, or both" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  levels: optionTypes.levels.default,
  lineWidth: optionTypes.lineWidth.default,
  lineColor: optionTypes.lineColor.default,
  fillMode: optionTypes.fillMode.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type ContourLinesOptions = typeof defaults & { _webglAcceleration?: boolean };

const contourLines = (input: any, options: ContourLinesOptions = defaults) => {
  const { levels, lineWidth, lineColor, fillMode, palette } = options;
  const W = input.width, H = input.height;

  if (options._webglAcceleration !== false && contourLinesGLAvailable()) {
    const fillInt = fillMode === FILL_MODE.LINES ? 0 : fillMode === FILL_MODE.FILLED ? 1 : 2;
    const rendered = renderContourLinesGL(
      input, W, H,
      levels, lineWidth,
      [lineColor[0], lineColor[1], lineColor[2]],
      fillInt as ContourFillMode,
    );
    if (rendered) {
      const identity = paletteIsIdentity(palette);
      const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
      if (out) {
        logFilterBackend("Contour Lines", "WebGL2", `levels=${levels} lw=${lineWidth}${identity ? "" : "+palettePass"}`);
        return out;
      }
    }
  }

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const edgeAlpha = Math.min(1, Math.max(0.1, lineWidth));
  const radius = Math.max(1, lineWidth);
  const ceilRadius = Math.ceil(radius);
  const reach = radius + 0.35;

  // Compute luminance and band assignment
  const bands = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const lum = (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255;
      bands[y * W + x] = Math.min(levels - 1, Math.floor(lum * levels));
    }

  // Detect contour edges (dilated by lineWidth)
  const isEdge = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const b = bands[y * W + x];
      let edge = false;
      for (let ky = -ceilRadius; ky <= ceilRadius && !edge; ky++)
        for (let kx = -ceilRadius; kx <= ceilRadius && !edge; kx++) {
          if (kx === 0 && ky === 0) continue;
          if (Math.hypot(kx, ky) > reach) continue;
          const ny = Math.max(0, Math.min(H - 1, y + ky));
          const nx = Math.max(0, Math.min(W - 1, x + kx));
          if (bands[ny * W + nx] !== b) edge = true;
        }
      isEdge[y * W + x] = edge ? 1 : 0;
    }

  // Render
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const edge = isEdge[y * W + x];

      if (edge && fillMode !== FILL_MODE.FILLED) {
        const baseR = fillMode === FILL_MODE.LINES ? 255 : Math.round(buf[i] * ((bands[y * W + x] + 0.5) / levels) + buf[i] * (1 - ((bands[y * W + x] + 0.5) / levels)) * 0.3);
        const baseG = fillMode === FILL_MODE.LINES ? 255 : Math.round(buf[i + 1] * ((bands[y * W + x] + 0.5) / levels) + buf[i + 1] * (1 - ((bands[y * W + x] + 0.5) / levels)) * 0.3);
        const baseB = fillMode === FILL_MODE.LINES ? 255 : Math.round(buf[i + 2] * ((bands[y * W + x] + 0.5) / levels) + buf[i + 2] * (1 - ((bands[y * W + x] + 0.5) / levels)) * 0.3);
        const color = paletteGetColor(
          palette,
          rgba(
            Math.round(baseR + (lineColor[0] - baseR) * edgeAlpha),
            Math.round(baseG + (lineColor[1] - baseG) * edgeAlpha),
            Math.round(baseB + (lineColor[2] - baseB) * edgeAlpha),
            255
          ),
          palette.options,
          false
        );
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
      } else if (fillMode !== FILL_MODE.LINES) {
        // Fill with quantized band color
        const band = bands[y * W + x];
        const t = (band + 0.5) / levels;
        const r = Math.round(buf[i] * t + buf[i] * (1 - t) * 0.3);
        const g = Math.round(buf[i + 1] * t + buf[i + 1] * (1 - t) * 0.3);
        const b = Math.round(buf[i + 2] * t + buf[i + 2] * (1 - t) * 0.3);
        const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
      } else {
        fillBufferPixel(outBuf, i, 255, 255, 255, 255);
      }
    }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Contour Lines", func: contourLines, optionTypes, options: defaults, defaults });
