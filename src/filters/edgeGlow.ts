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
  threshold: { type: RANGE, range: [0, 100], step: 1, default: 30 },
  glowRadius: { type: RANGE, range: [0, 8], step: 1, default: 3 },
  edgeColor: { type: COLOR, default: [0, 255, 200] },
  backgroundColor: { type: COLOR, default: [0, 0, 10] },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  glowRadius: optionTypes.glowRadius.default,
  edgeColor: optionTypes.edgeColor.default,
  backgroundColor: optionTypes.backgroundColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const edgeGlow = (input, options: any = defaults) => {
  const { threshold, glowRadius, edgeColor, backgroundColor, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // Compute luminance
  const lum = computeLuminance(buf, W, H);

  // Sobel edge detection
  const { magnitude } = sobelEdges(lum, W, H);
  const edgeMap = new Float32Array(W * H);
  for (let i = 0; i < magnitude.length; i++) {
    edgeMap[i] = magnitude[i] > threshold ? Math.min(1, magnitude[i] / 255) : 0;
  }

  // Glow: separable blur of edge map
  if (glowRadius > 0) {
    const sigma = glowRadius;
    const r = Math.ceil(sigma * 2);
    const kernel = new Float32Array(r * 2 + 1);
    let sum = 0;
    for (let i = -r; i <= r; i++) {
      kernel[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
      sum += kernel[i + r];
    }
    for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

    // Horizontal blur
    const tempEdge = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let v = 0;
        for (let k = -r; k <= r; k++) {
          const nx = Math.max(0, Math.min(W - 1, x + k));
          v += edgeMap[y * W + nx] * kernel[k + r];
        }
        tempEdge[y * W + x] = v;
      }
    }

    // Vertical blur, merge with original edge map (max)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let v = 0;
        for (let k = -r; k <= r; k++) {
          const ny = Math.max(0, Math.min(H - 1, y + k));
          v += tempEdge[ny * W + x] * kernel[k + r];
        }
        edgeMap[y * W + x] = Math.max(edgeMap[y * W + x], v);
      }
    }
  }

  // Render: lerp between background and edge color
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const t = Math.min(1, edgeMap[y * W + x]);

      const r = Math.round(backgroundColor[0] + (edgeColor[0] - backgroundColor[0]) * t);
      const g = Math.round(backgroundColor[1] + (edgeColor[1] - backgroundColor[1]) * t);
      const b = Math.round(backgroundColor[2] + (edgeColor[2] - backgroundColor[2]) * t);

      const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Edge Glow",
  func: edgeGlow,
  optionTypes,
  options: defaults,
  defaults
};
