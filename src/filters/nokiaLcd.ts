import { RANGE, BOOL, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

// Nokia 3310 LCD colors (classic greenish monochrome)
const PIXEL_ON: [number, number, number] = [67, 82, 61];   // dark (ink)
const PIXEL_OFF: [number, number, number] = [199, 207, 161]; // light (background)

export const optionTypes = {
  columns: { type: RANGE, range: [42, 168], step: 1, default: 84, desc: "LCD horizontal pixel resolution" },
  rows: { type: RANGE, range: [24, 96], step: 1, default: 48, desc: "LCD vertical pixel resolution" },
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 128, desc: "Black/white threshold for 1-bit display" },
  contrast: { type: RANGE, range: [0.5, 3], step: 0.05, default: 1.5, desc: "Contrast boost before thresholding" },
  pixelGrid: { type: BOOL, default: true, desc: "Show visible pixel grid lines" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  columns: optionTypes.columns.default,
  rows: optionTypes.rows.default,
  threshold: optionTypes.threshold.default,
  contrast: optionTypes.contrast.default,
  pixelGrid: optionTypes.pixelGrid.default,
  palette: { ...optionTypes.palette.default, options: { levels: 2 } }
};

const clamp = (v: number): number => Math.max(0, Math.min(255, v));

const nokiaLcd = (
  input,
  options = defaults
) => {
  const {
    columns,
    rows,
    threshold,
    contrast,
    pixelGrid,
    palette
  } = options;

  const inputCtx = input.getContext("2d");
  if (!inputCtx) return input;

  const origW = input.width;
  const origH = input.height;

  // Step 1 — Downscale by sampling from input buffer (nearest neighbor)
  const srcBuf = inputCtx.getImageData(0, 0, origW, origH).data;
  const buf = new Uint8ClampedArray(columns * rows * 4);
  for (let dy = 0; dy < rows; dy++) {
    for (let dx = 0; dx < columns; dx++) {
      const sx = Math.min(origW - 1, Math.round(dx * origW / columns));
      const sy = Math.min(origH - 1, Math.round(dy * origH / rows));
      const si = getBufferIndex(sx, sy, origW);
      const di = getBufferIndex(dx, dy, columns);
      buf[di] = srcBuf[si]; buf[di+1] = srcBuf[si+1]; buf[di+2] = srcBuf[si+2]; buf[di+3] = srcBuf[si+3];
    }
  }

  // Step 2 — Convert to 1-bit monochrome with contrast and threshold
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const i = getBufferIndex(x, y, columns);

      // Perceptual luminance
      const luma = buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722;

      // Apply contrast around midpoint
      const adjusted = clamp(128 + (luma - 128) * contrast);

      // Threshold to 1-bit: below threshold = pixel on (dark), above = pixel off (light)
      const isOn = adjusted < threshold;
      const [r, g, b] = isOn ? PIXEL_ON : PIXEL_OFF;

      // Apply palette mapping
      const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  // Step 3 — Upscale back to original size (nearest neighbor for chunky pixels)
  const output = cloneCanvas(input, false);
  const outputCtx = output.getContext("2d");
  if (!outputCtx) return input;

  const finalBuf = new Uint8ClampedArray(origW * origH * 4);
  for (let y = 0; y < origH; y++) {
    for (let x = 0; x < origW; x++) {
      const sx = Math.min(columns - 1, Math.floor(x * columns / origW));
      const sy = Math.min(rows - 1, Math.floor(y * rows / origH));
      const si = getBufferIndex(sx, sy, columns);
      const di = getBufferIndex(x, y, origW);
      finalBuf[di] = outBuf[si]; finalBuf[di+1] = outBuf[si+1]; finalBuf[di+2] = outBuf[si+2]; finalBuf[di+3] = outBuf[si+3];
    }
  }
  outputCtx.putImageData(new ImageData(finalBuf, origW, origH), 0, 0);

  // Step 4 — Pixel grid: darken every Nth pixel to simulate LCD grid lines
  if (pixelGrid) {
    const outImgData = outputCtx.getImageData(0, 0, origW, origH);
    const gridBuf = outImgData.data;

    // Calculate pixel cell size in output coordinates
    const cellW = origW / columns;
    const cellH = origH / rows;

    for (let x = 0; x < origW; x++) {
      for (let y = 0; y < origH; y++) {
        // Darken pixels at cell boundaries
        const atVerticalEdge = (x % cellW) < 1;
        const atHorizontalEdge = (y % cellH) < 1;

        if (atVerticalEdge || atHorizontalEdge) {
          const i = getBufferIndex(x, y, origW);
          gridBuf[i]     = Math.round(gridBuf[i] * 0.75);
          gridBuf[i + 1] = Math.round(gridBuf[i + 1] * 0.75);
          gridBuf[i + 2] = Math.round(gridBuf[i + 2] * 0.75);
        }
      }
    }

    outputCtx.putImageData(outImgData, 0, 0);
  }

  return output;
};

export default {
  name: "Nokia LCD",
  func: nokiaLcd,
  options: defaults,
  optionTypes,
  defaults
};
