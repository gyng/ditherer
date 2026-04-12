import { RANGE, COLOR, PALETTE, ENUM } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  clamp,
} from "utils";
import { computeLuminance, sobelEdges } from "utils/edges";
import { defineFilter } from "filters/types";

const RENDER_MODE = {
  SOLID: "SOLID",
  OVERLAY: "OVERLAY",
};

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
    desc: "Draw traced edges on a flat background or overlay them on the source image",
  },
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
  options = defaults
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

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const edgeAlpha = Math.min(1, Math.max(0.1, lineWidth));

  // Compute luminance and Sobel edges
  const lum = computeLuminance(buf, W, H);
  const { magnitude, direction } = sobelEdges(lum, W, H);

  // Non-maximum suppression
  const edgeMap = new Uint8Array(W * H);

  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const idx = y * W + x;
      const mag = magnitude[idx];

      if (mag < threshold) continue;

      // Quantize direction to 4 orientations (0, 45, 90, 135 degrees)
      let angle = direction[idx];
      if (angle < 0) angle += Math.PI;
      const deg = (angle * 180) / Math.PI;

      let n1Idx: number, n2Idx: number;
      if (deg < 22.5 || deg >= 157.5) {
        // Horizontal edge — check vertical neighbors
        n1Idx = (y - 1) * W + x;
        n2Idx = (y + 1) * W + x;
      } else if (deg < 67.5) {
        // 45-degree edge
        n1Idx = (y - 1) * W + (x + 1);
        n2Idx = (y + 1) * W + (x - 1);
      } else if (deg < 112.5) {
        // Vertical edge — check horizontal neighbors
        n1Idx = y * W + (x - 1);
        n2Idx = y * W + (x + 1);
      } else {
        // 135-degree edge
        n1Idx = (y - 1) * W + (x - 1);
        n2Idx = (y + 1) * W + (x + 1);
      }

      // Keep only local maxima along gradient direction
      if (mag >= magnitude[n1Idx] && mag >= magnitude[n2Idx]) {
        edgeMap[idx] = 1;
      }
    }
  }

  // Dilate edge map by lineWidth
  const dilated = new Uint8Array(W * H);
  const radius = lineWidth > 1 ? (lineWidth - 1) / 2 : 0;
  const ceilRadius = Math.ceil(radius);
  const reach = radius + 0.35;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (edgeMap[y * W + x] === 0) continue;
      for (let dy = -ceilRadius; dy <= ceilRadius; dy++) {
        for (let dx = -ceilRadius; dx <= ceilRadius; dx++) {
          if (Math.hypot(dx, dy) > reach) continue;
          const ny = y + dy;
          const nx = x + dx;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
            dilated[ny * W + nx] = 1;
          }
        }
      }
    }
  }

  // Render: lineColor on bgColor or as an overlay on the source image
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const isEdge = dilated[y * W + x] === 1;
      const useOverlay = renderMode === RENDER_MODE.OVERLAY;
      const baseR = useOverlay ? buf[i] : bgColor[0];
      const baseG = useOverlay ? buf[i + 1] : bgColor[1];
      const baseB = useOverlay ? buf[i + 2] : bgColor[2];

      let r = isEdge ? lineColor[0] : baseR;
      let g = isEdge ? lineColor[1] : baseG;
      let b = isEdge ? lineColor[2] : baseB;

      if (isEdge && useOverlay) {
        const mix = clamp(0, 1, overlayMix * edgeAlpha);
        r = Math.round(baseR + (lineColor[0] - baseR) * mix);
        g = Math.round(baseG + (lineColor[1] - baseG) * mix);
        b = Math.round(baseB + (lineColor[2] - baseB) * mix);
      }

      const color = paletteGetColor(
        palette,
        rgba(
          isEdge && lineWidth < 1 && !useOverlay ? Math.round(baseR + (r - baseR) * edgeAlpha) : r,
          isEdge && lineWidth < 1 && !useOverlay ? Math.round(baseG + (g - baseG) * edgeAlpha) : g,
          isEdge && lineWidth < 1 && !useOverlay ? Math.round(baseB + (b - baseB) * edgeAlpha) : b,
          255
        ),
        palette.options,
        false
      );
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);

  return output;
};

export default defineFilter({
  name: "Edge Trace",
  func: edgeTrace,
  options: defaults,
  optionTypes,
  defaults
});
