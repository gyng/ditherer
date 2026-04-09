import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";
import { computeLuminance, sobelEdges } from "utils/edges";

export const optionTypes = {
  threshold: { type: RANGE, range: [10, 100], step: 1, default: 30 },
  lineWidth: { type: RANGE, range: [1, 3], step: 1, default: 1 },
  lineColor: { type: COLOR, default: [0, 0, 0] },
  bgColor: { type: COLOR, default: [255, 255, 255] },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  lineWidth: optionTypes.lineWidth.default,
  lineColor: optionTypes.lineColor.default,
  bgColor: optionTypes.bgColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 2 } }
};

const edgeTrace = (
  input,
  options = defaults
) => {
  const {
    threshold,
    lineWidth,
    lineColor,
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
  const radius = Math.floor(lineWidth / 2);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (edgeMap[y * W + x] === 0) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
            dilated[ny * W + nx] = 1;
          }
        }
      }
    }
  }

  // Render: lineColor on bgColor
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const isEdge = dilated[y * W + x] === 1;

      const r = isEdge ? lineColor[0] : bgColor[0];
      const g = isEdge ? lineColor[1] : bgColor[1];
      const b = isEdge ? lineColor[2] : bgColor[2];

      const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);

  return output;
};

export default {
  name: "Edge Trace",
  func: edgeTrace,
  options: defaults,
  optionTypes,
  defaults
};
