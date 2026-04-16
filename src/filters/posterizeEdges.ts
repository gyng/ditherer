import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  logFilterBackend,
} from "utils";
import { computeLuminance, sobelEdges } from "utils/edges";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { posterizeEdgesGLAvailable, renderPosterizeEdgesGL } from "./posterizeEdgesGL";

export const optionTypes = {
  levels: { type: RANGE, range: [2, 16], step: 1, default: 5, desc: "Color posterization levels" },
  edgeThreshold: { type: RANGE, range: [0, 100], step: 1, default: 25, desc: "Edge detection sensitivity" },
  edgeWidth: { type: RANGE, range: [1, 4], step: 1, default: 1, desc: "Edge outline thickness" },
  edgeColor: { type: COLOR, default: [0, 0, 0], desc: "Edge outline color" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  levels: optionTypes.levels.default,
  edgeThreshold: optionTypes.edgeThreshold.default,
  edgeWidth: optionTypes.edgeWidth.default,
  edgeColor: optionTypes.edgeColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type PosterizeEdgesOptions = typeof defaults & { _webglAcceleration?: boolean };

const posterizeEdges = (input: any, options: PosterizeEdgesOptions = defaults) => {
  const { levels, edgeThreshold, edgeWidth, edgeColor, palette } = options;
  const W = input.width;
  const H = input.height;

  if (options._webglAcceleration !== false && posterizeEdgesGLAvailable()) {
    const rendered = renderPosterizeEdgesGL(
      input, W, H,
      levels, edgeThreshold, edgeWidth,
      [edgeColor[0], edgeColor[1], edgeColor[2]],
    );
    if (rendered) {
      const identity = paletteIsIdentity(palette);
      const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
      if (out) {
        logFilterBackend("Posterize Edges", "WebGL2", `levels=${levels} edge>${edgeThreshold}${identity ? "" : "+palettePass"}`);
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

  // Compute luminance for edge detection
  const lum = computeLuminance(buf, W, H);

  // Sobel edge detection
  const { magnitude: edgeMap } = sobelEdges(lum, W, H);

  // Dilate edges if edgeWidth > 1
  let finalEdge = edgeMap;
  if (edgeWidth > 1) {
    finalEdge = new Float32Array(W * H);
    const r = edgeWidth - 1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let maxVal = 0;
        for (let ky = -r; ky <= r; ky++) {
          for (let kx = -r; kx <= r; kx++) {
            const ny = Math.max(0, Math.min(H - 1, y + ky));
            const nx = Math.max(0, Math.min(W - 1, x + kx));
            maxVal = Math.max(maxVal, edgeMap[ny * W + nx]);
          }
        }
        finalEdge[y * W + x] = maxVal;
      }
    }
  }

  // Render
  const step = 255 / (levels - 1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      if (finalEdge[y * W + x] > edgeThreshold) {
        const color = paletteGetColor(palette, rgba(edgeColor[0], edgeColor[1], edgeColor[2], 255), palette.options, false);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
      } else {
        // Posterize
        const r = Math.round(Math.round(buf[i] / step) * step);
        const g = Math.round(Math.round(buf[i + 1] / step) * step);
        const b = Math.round(Math.round(buf[i + 2] / step) * step);

        const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Posterize Edges",
  func: posterizeEdges,
  optionTypes,
  options: defaults,
  defaults
});
