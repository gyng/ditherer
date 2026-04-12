import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { computeLuminance, sobelEdges } from "utils/edges";
import { defineFilter } from "filters/types";

export const optionTypes = {
  threshold: { type: RANGE, range: [5, 100], step: 1, default: 30, desc: "Edge detection sensitivity" },
  lineWidth: { type: RANGE, range: [0.1, 5], step: 0.1, default: 1, desc: "Drawn line thickness" },
  cleanupRadius: { type: RANGE, range: [0, 3], step: 1, default: 1, desc: "Remove isolated noise pixels" },
  lineColor: { type: COLOR, default: [0, 0, 0], desc: "Ink/line color" },
  bgColor: { type: COLOR, default: [255, 255, 255], desc: "Background paper color" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  lineWidth: optionTypes.lineWidth.default,
  cleanupRadius: optionTypes.cleanupRadius.default,
  lineColor: optionTypes.lineColor.default,
  bgColor: optionTypes.bgColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 2 } }
};

const lineArt = (input: any, options = defaults) => {
  const { threshold, lineWidth, cleanupRadius, lineColor, bgColor, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;

  // Luminance
  const lum = computeLuminance(buf, W, H);

  // Sobel edge detection
  const { magnitude } = sobelEdges(lum, W, H);
  const edges = new Uint8Array(W * H);
  const effectiveThreshold = lineWidth < 1 ? threshold / Math.max(0.1, lineWidth) : threshold;
  for (let i = 0; i < magnitude.length; i++) {
    edges[i] = magnitude[i] > effectiveThreshold ? 1 : 0;
  }

  // Dilate edges for line width
  let finalEdges = edges;
  if (lineWidth > 1) {
    finalEdges = new Uint8Array(W * H);
    const r = lineWidth - 1;
    const ceilR = Math.ceil(r);
    const reach = r + 0.35;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let found = false;
        for (let ky = -ceilR; ky <= ceilR && !found; ky++)
          for (let kx = -ceilR; kx <= ceilR && !found; kx++) {
            if (Math.hypot(kx, ky) > reach) continue;
            const ny = Math.max(0, Math.min(H - 1, y + ky));
            const nx = Math.max(0, Math.min(W - 1, x + kx));
            if (edges[ny * W + nx]) found = true;
          }
        finalEdges[y * W + x] = found ? 1 : 0;
      }
  }

  // Cleanup: remove isolated pixels
  if (cleanupRadius > 0) {
    const cleaned = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!finalEdges[y * W + x]) continue;
        let neighbors = 0;
        for (let ky = -cleanupRadius; ky <= cleanupRadius; ky++)
          for (let kx = -cleanupRadius; kx <= cleanupRadius; kx++) {
            if (kx === 0 && ky === 0) continue;
            const ny = Math.max(0, Math.min(H - 1, y + ky));
            const nx = Math.max(0, Math.min(W - 1, x + kx));
            neighbors += finalEdges[ny * W + nx];
          }
        cleaned[y * W + x] = neighbors >= 2 ? 1 : 0;
      }
    finalEdges = cleaned;
  }

  // Render
  const outBuf = new Uint8ClampedArray(buf.length);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const isEdge = finalEdges[y * W + x] === 1;
      const c = isEdge ? lineColor : bgColor;
      const color = paletteGetColor(palette, rgba(c[0], c[1], c[2], 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Line Art", func: lineArt, optionTypes, options: defaults, defaults });
