import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

const LAYOUT = { STRIPE: "STRIPE", PENTILE: "PENTILE", DIAMOND: "DIAMOND" };

export const optionTypes = {
  pixelSize: { type: RANGE, range: [3, 20], step: 1, default: 6 },
  subpixelLayout: { type: ENUM, options: [
    { name: "RGB Stripe", value: LAYOUT.STRIPE },
    { name: "PenTile", value: LAYOUT.PENTILE },
    { name: "Diamond", value: LAYOUT.DIAMOND }
  ], default: LAYOUT.STRIPE },
  brightness: { type: RANGE, range: [0.5, 2], step: 0.1, default: 1.2 },
  gapDarkness: { type: RANGE, range: [0, 1], step: 0.05, default: 0.3 },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  pixelSize: optionTypes.pixelSize.default,
  subpixelLayout: optionTypes.subpixelLayout.default,
  brightness: optionTypes.brightness.default,
  gapDarkness: optionTypes.gapDarkness.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const lcdDisplay = (input, options: any = defaults) => {
  const { pixelSize, subpixelLayout, brightness, gapDarkness, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const subW = Math.max(1, Math.floor(pixelSize / 3));
  const gapColor = Math.round(10 * (1 - gapDarkness));

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Sample from grid-aligned position
      const gx = Math.floor(x / pixelSize) * pixelSize + Math.floor(pixelSize / 2);
      const gy = Math.floor(y / pixelSize) * pixelSize + Math.floor(pixelSize / 2);
      const si = getBufferIndex(Math.min(W - 1, gx), Math.min(H - 1, gy), W);
      const sr = buf[si], sg = buf[si + 1], sb = buf[si + 2];

      // Position within pixel cell
      const localX = x % pixelSize;
      const localY = y % pixelSize;

      // Gap between pixels
      if (localX >= pixelSize - 1 || localY >= pixelSize - 1) {
        const di = getBufferIndex(x, y, W);
        fillBufferPixel(outBuf, di, gapColor, gapColor, gapColor, 255);
        continue;
      }

      let r = 0, g = 0, b = 0;

      if (subpixelLayout === LAYOUT.STRIPE) {
        // RGB vertical stripes
        const subIdx = Math.floor(localX / subW);
        if (subIdx === 0) r = Math.round(sr * brightness);
        else if (subIdx === 1) g = Math.round(sg * brightness);
        else b = Math.round(sb * brightness);
      } else if (subpixelLayout === LAYOUT.PENTILE) {
        // PenTile: alternating RG and BG rows
        const isEvenRow = (Math.floor(y / pixelSize) % 2) === 0;
        const subIdx = Math.floor(localX / subW);
        if (isEvenRow) {
          if (subIdx === 0) r = Math.round(sr * brightness);
          else g = Math.round(sg * brightness);
        } else {
          if (subIdx === 0) b = Math.round(sb * brightness);
          else g = Math.round(sg * brightness);
        }
      } else {
        // Diamond: rotated subpixel arrangement
        const cx = localX - pixelSize / 2;
        const cy = localY - pixelSize / 2;
        const angle = ((Math.atan2(cy, cx) * 180 / Math.PI) + 360) % 360;
        if (angle < 120) r = Math.round(sr * brightness);
        else if (angle < 240) g = Math.round(sg * brightness);
        else b = Math.round(sb * brightness);
      }

      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));

      const di = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
      fillBufferPixel(outBuf, di, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "LCD Display", func: lcdDisplay, optionTypes, options: defaults, defaults };
