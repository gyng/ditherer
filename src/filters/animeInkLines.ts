import { COLOR, ENUM, PALETTE, RANGE } from "constants/controlTypes";
import { nearest } from "palettes";
import { clamp, cloneCanvas, fillBufferPixel, getBufferIndex, rgba, srgbPaletteGetColor } from "utils";
import { computeLuminance, sobelEdges } from "utils/edges";

const EDGE_SOURCE = {
  SOBEL: "SOBEL",
  LAPLACIAN: "LAPLACIAN",
};

const RENDER_MODE = {
  SOLID: "SOLID",
  OVERLAY: "OVERLAY",
};

const laplacianEdges = (lum: Float32Array, W: number, H: number) => {
  const out = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y += 1) {
    for (let x = 1; x < W - 1; x += 1) {
      const idx = y * W + x;
      const c = lum[idx];
      const left = lum[idx - 1];
      const right = lum[idx + 1];
      const top = lum[idx - W];
      const bottom = lum[idx + W];
      out[idx] = Math.abs(left + right + top + bottom - c * 4);
    }
  }
  return out;
};

const thresholdMap = (magnitude: Float32Array, threshold: number, W: number, H: number) => {
  const out = new Uint8Array(W * H);
  for (let i = 0; i < magnitude.length; i += 1) {
    out[i] = magnitude[i] >= threshold ? 1 : 0;
  }
  return out;
};

const dilate = (edgeMap: Uint8Array, W: number, H: number, lineWidth: number) => {
  const out = new Uint8Array(W * H);
  const radius = lineWidth > 1 ? (lineWidth - 1) / 2 : 0;
  const ceilRadius = Math.ceil(radius);
  const reach = radius + 0.35;

  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (edgeMap[y * W + x] === 0) continue;
      for (let dy = -ceilRadius; dy <= ceilRadius; dy += 1) {
        for (let dx = -ceilRadius; dx <= ceilRadius; dx += 1) {
          if (Math.hypot(dx, dy) > reach) continue;
          const ny = y + dy;
          const nx = x + dx;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
            out[ny * W + nx] = 1;
          }
        }
      }
    }
  }

  return out;
};

export const optionTypes = {
  source: {
    type: ENUM,
    options: [
      { name: "Sobel", value: EDGE_SOURCE.SOBEL },
      { name: "Laplacian", value: EDGE_SOURCE.LAPLACIAN },
    ],
    default: EDGE_SOURCE.SOBEL,
    desc: "Which edge detector to use for the line pass",
  },
  threshold: { type: RANGE, range: [5, 180], step: 1, default: 34, desc: "Minimum edge strength that becomes an ink line" },
  lineWidth: { type: RANGE, range: [0.1, 4], step: 0.1, default: 1.1, desc: "Thickness of the anime line art" },
  lineColor: { type: COLOR, default: [32, 24, 24], desc: "Ink line color" },
  renderMode: {
    type: ENUM,
    options: [
      { name: "Overlay", value: RENDER_MODE.OVERLAY },
      { name: "Solid", value: RENDER_MODE.SOLID },
    ],
    default: RENDER_MODE.OVERLAY,
    desc: "Overlay lines on the source image or output only the line drawing",
  },
  overlayMix: { type: RANGE, range: [0, 1], step: 0.05, default: 0.8, desc: "How strongly ink lines darken or recolor the source image in Overlay mode" },
  bgColor: { type: COLOR, default: [255, 255, 255], desc: "Background color for Solid mode" },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  source: optionTypes.source.default,
  threshold: optionTypes.threshold.default,
  lineWidth: optionTypes.lineWidth.default,
  lineColor: optionTypes.lineColor.default,
  renderMode: optionTypes.renderMode.default,
  overlayMix: optionTypes.overlayMix.default,
  bgColor: optionTypes.bgColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const animeInkLines = (input, options: any = defaults) => {
  const { source, threshold, lineWidth, lineColor, renderMode, overlayMix, bgColor, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const lum = computeLuminance(buf, W, H);
  const magnitude = source === EDGE_SOURCE.LAPLACIAN
    ? laplacianEdges(lum, W, H)
    : sobelEdges(lum, W, H).magnitude;
  const edgeMap = thresholdMap(magnitude, threshold, W, H);
  const dilated = dilate(edgeMap, W, H, lineWidth);
  const edgeAlpha = Math.min(1, Math.max(0.1, lineWidth));
  const overlay = renderMode === RENDER_MODE.OVERLAY;

  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = getBufferIndex(x, y, W);
      const isEdge = dilated[y * W + x] === 1;
      const baseR = overlay ? buf[i] : bgColor[0];
      const baseG = overlay ? buf[i + 1] : bgColor[1];
      const baseB = overlay ? buf[i + 2] : bgColor[2];

      let r = isEdge ? lineColor[0] : baseR;
      let g = isEdge ? lineColor[1] : baseG;
      let b = isEdge ? lineColor[2] : baseB;

      if (isEdge && overlay) {
        const mix = clamp(0, 1, overlayMix * edgeAlpha);
        r = Math.round(baseR + (lineColor[0] - baseR) * mix);
        g = Math.round(baseG + (lineColor[1] - baseG) * mix);
        b = Math.round(baseB + (lineColor[2] - baseB) * mix);
      }

      const color = srgbPaletteGetColor(
        palette,
        rgba(
          isEdge && !overlay && lineWidth < 1 ? Math.round(baseR + (r - baseR) * edgeAlpha) : r,
          isEdge && !overlay && lineWidth < 1 ? Math.round(baseG + (g - baseG) * edgeAlpha) : g,
          isEdge && !overlay && lineWidth < 1 ? Math.round(baseB + (b - baseB) * edgeAlpha) : b,
          255,
        ),
        palette.options,
      );
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Anime Ink Lines",
  func: animeInkLines,
  optionTypes,
  options: defaults,
  defaults,
};
