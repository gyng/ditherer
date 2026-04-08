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
  columns: { type: RANGE, range: [42, 168], step: 1, default: 84 },
  rows: { type: RANGE, range: [24, 96], step: 1, default: 48 },
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 128 },
  contrast: { type: RANGE, range: [0.5, 3], step: 0.05, default: 1.5 },
  pixelGrid: { type: BOOL, default: true },
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

  // Step 1 — Downscale to Nokia LCD resolution (bilinear via browser)
  const downCanvas = document.createElement("canvas");
  downCanvas.width = columns;
  downCanvas.height = rows;
  const downCtx = downCanvas.getContext("2d");
  if (!downCtx) return input;

  downCtx.imageSmoothingEnabled = true;
  downCtx.drawImage(input, 0, 0, columns, rows);

  const imgData = downCtx.getImageData(0, 0, columns, rows);
  const buf = imgData.data;

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

  downCtx.putImageData(new ImageData(outBuf, columns, rows), 0, 0);

  // Step 3 — Upscale back to original size with nearest-neighbor for chunky pixels
  const output = cloneCanvas(input, false);
  const outputCtx = output.getContext("2d");
  if (!outputCtx) return input;

  outputCtx.imageSmoothingEnabled = false;
  outputCtx.drawImage(downCanvas, 0, 0, origW, origH);

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
