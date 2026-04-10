import { ACTION, RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

// Classic DMG Gameboy green palette (darkest to lightest)
const GB_PALETTE: [number, number, number][] = [
  [15, 56, 15],
  [48, 98, 48],
  [139, 172, 15],
  [155, 188, 15]
];

// 2x2 Bayer ordered dither matrix, normalized to 0-1
const BAYER_2X2 = [
  [0 / 4, 2 / 4],
  [3 / 4, 1 / 4]
];

export const optionTypes = {
  resolution: { type: RANGE, range: [64, 256], step: 1, default: 128, desc: "Output resolution (square)" },
  contrast: { type: RANGE, range: [0.5, 3], step: 0.05, default: 1.8, desc: "Contrast boost before quantization" },
  edgeEnhance: { type: RANGE, range: [0, 2], step: 0.05, default: 0.8, desc: "Edge sharpening strength" },
  ditherStrength: { type: RANGE, range: [0, 1], step: 0.01, default: 0.7, desc: "Bayer dither intensity" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 10 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions, inputCanvas, _filterFunc, options) => {
      if (actions.isAnimating()) { actions.stopAnimLoop(); }
      else { actions.startAnimLoop(inputCanvas, options.animSpeed || 10); }
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  resolution: optionTypes.resolution.default,
  contrast: optionTypes.contrast.default,
  edgeEnhance: optionTypes.edgeEnhance.default,
  ditherStrength: optionTypes.ditherStrength.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 4 } }
};

const clamp = (v: number): number => Math.max(0, Math.min(255, v));

const gameboyCamera = (
  input,
  options = defaults
) => {
  const {
    resolution,
    contrast,
    edgeEnhance,
    ditherStrength,
    palette
  } = options;

  const inputCtx = input.getContext("2d");
  if (!inputCtx) return input;

  const origW = input.width;
  const origH = input.height;

  // Calculate downscaled dimensions maintaining aspect ratio
  const aspect = origW / origH;
  // Gameboy Camera native is 128x112 (aspect ~1.14), but we scale based on
  // the user-chosen resolution as the width, deriving height from aspect
  const downW = resolution;
  const downH = Math.round(resolution / aspect);

  // Step 1 — Downscale by sampling from input buffer (nearest neighbor)
  const srcBuf = inputCtx.getImageData(0, 0, origW, origH).data;
  const buf = new Uint8ClampedArray(downW * downH * 4);
  for (let dy = 0; dy < downH; dy++) {
    for (let dx = 0; dx < downW; dx++) {
      const sx = Math.min(origW - 1, Math.round(dx * origW / downW));
      const sy = Math.min(origH - 1, Math.round(dy * origH / downH));
      const si = getBufferIndex(sx, sy, origW);
      const di = getBufferIndex(dx, dy, downW);
      buf[di] = srcBuf[si]; buf[di+1] = srcBuf[si+1]; buf[di+2] = srcBuf[si+2]; buf[di+3] = srcBuf[si+3];
    }
  }

  // Working buffer for grayscale values
  const gray = new Float32Array(downW * downH);

  // Step 2 — Convert to grayscale
  for (let y = 0; y < downH; y++) {
    for (let x = 0; x < downW; x++) {
      const i = getBufferIndex(x, y, downW);
      // Perceptual luminance
      gray[y * downW + x] = buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722;
    }
  }

  // Step 3 — Edge enhancement (unsharp mask: pixel + edgeEnhance * (pixel - avg_neighbors))
  if (edgeEnhance > 0) {
    const enhanced = new Float32Array(gray);
    for (let y = 1; y < downH - 1; y++) {
      for (let x = 1; x < downW - 1; x++) {
        const idx = y * downW + x;
        // 3x3 average of neighbors (excluding center)
        const neighbors =
          gray[(y - 1) * downW + (x - 1)] +
          gray[(y - 1) * downW + x] +
          gray[(y - 1) * downW + (x + 1)] +
          gray[y * downW + (x - 1)] +
          gray[y * downW + (x + 1)] +
          gray[(y + 1) * downW + (x - 1)] +
          gray[(y + 1) * downW + x] +
          gray[(y + 1) * downW + (x + 1)];
        const blurred = neighbors / 8;
        enhanced[idx] = gray[idx] + edgeEnhance * (gray[idx] - blurred);
      }
    }
    for (let j = 0; j < gray.length; j++) {
      gray[j] = enhanced[j];
    }
  }

  // Step 4 — Apply contrast
  for (let j = 0; j < gray.length; j++) {
    gray[j] = clamp(128 + (gray[j] - 128) * contrast);
  }

  // Step 5 — Apply 2x2 Bayer ordered dither and map to 4 levels
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < downH; y++) {
    for (let x = 0; x < downW; x++) {
      const idx = y * downW + x;
      const i = getBufferIndex(x, y, downW);

      const threshold = (BAYER_2X2[y % 2][x % 2] - 0.5) * ditherStrength * 255;
      const dithered = gray[idx] + threshold;

      // Quantize to 4 levels (0-3)
      let level: number;
      if (dithered < 64) {
        level = 0;
      } else if (dithered < 128) {
        level = 1;
      } else if (dithered < 192) {
        level = 2;
      } else {
        level = 3;
      }

      // Map to Gameboy green palette
      const [gr, gg, gb] = GB_PALETTE[level];

      // Apply palette mapping if a custom palette is set
      const color = paletteGetColor(palette, rgba(gr, gg, gb, 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  // Step 6 — Upscale back to original size (nearest neighbor for chunky pixels)
  const output = cloneCanvas(input, false);
  const outputCtx = output.getContext("2d");
  if (!outputCtx) return input;

  const finalBuf = new Uint8ClampedArray(origW * origH * 4);
  for (let y = 0; y < origH; y++) {
    for (let x = 0; x < origW; x++) {
      const sx = Math.min(downW - 1, Math.floor(x * downW / origW));
      const sy = Math.min(downH - 1, Math.floor(y * downH / origH));
      const si = getBufferIndex(sx, sy, downW);
      const di = getBufferIndex(x, y, origW);
      finalBuf[di] = outBuf[si]; finalBuf[di+1] = outBuf[si+1]; finalBuf[di+2] = outBuf[si+2]; finalBuf[di+3] = outBuf[si+3];
    }
  }
  outputCtx.putImageData(new ImageData(finalBuf, origW, origH), 0, 0);

  return output;
};

export default {
  name: "Gameboy Camera",
  func: gameboyCamera,
  options: defaults,
  optionTypes,
  defaults
};
