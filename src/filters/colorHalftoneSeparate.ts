import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

export const optionTypes = {
  dotSize: { type: RANGE, range: [3, 16], step: 1, default: 6, desc: "Halftone dot diameter" },
  offsetR: { type: RANGE, range: [0, 10], step: 1, default: 2, desc: "Red screen registration offset" },
  offsetG: { type: RANGE, range: [0, 10], step: 1, default: 0, desc: "Green screen registration offset" },
  offsetB: { type: RANGE, range: [0, 10], step: 1, default: 3, desc: "Blue screen registration offset" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  dotSize: optionTypes.dotSize.default,
  offsetR: optionTypes.offsetR.default,
  offsetG: optionTypes.offsetG.default,
  offsetB: optionTypes.offsetB.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const colorHalftoneSeparate = (input: any, options = defaults) => {
  const { dotSize, offsetR, offsetG, offsetB, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // White background
  for (let i = 0; i < outBuf.length; i += 4) { outBuf[i] = 255; outBuf[i + 1] = 255; outBuf[i + 2] = 255; outBuf[i + 3] = 255; }

  // Render each channel as separate halftone dots with offset
  const renderChannel = (channel: number, offX: number, offY: number) => {
    for (let cy = 0; cy < H; cy += dotSize) {
      for (let cx = 0; cx < W; cx += dotSize) {
        // Sample from offset position
        const sx = Math.max(0, Math.min(W - 1, cx + Math.floor(dotSize / 2) + offX));
        const sy = Math.max(0, Math.min(H - 1, cy + Math.floor(dotSize / 2) + offY));
        const si = getBufferIndex(sx, sy, W);
        const value = buf[si + channel] / 255;
        const dotR = (dotSize / 2) * value;

        if (dotR < 0.3) continue;

        const centerX = cx + dotSize / 2;
        const centerY = cy + dotSize / 2;

        for (let dy = -dotSize; dy <= dotSize; dy++)
          for (let dx = -dotSize; dx <= dotSize; dx++) {
            const px = Math.round(centerX + dx), py = Math.round(centerY + dy);
            if (px < 0 || px >= W || py < 0 || py >= H) continue;
            if (dx * dx + dy * dy > dotR * dotR) continue;

            const di = getBufferIndex(px, py, W);
            // Additive per-channel
            const intensity = Math.min(1, (dotR - Math.sqrt(dx * dx + dy * dy)) / 1.5 + 0.5);
            const add = Math.round(intensity * value * 200);
            if (channel === 0) outBuf[di] = Math.min(255, outBuf[di]); // R keeps white minus others
            // Actually: subtract from white per channel complement
            // For additive RGB: add channel color
            outBuf[di + channel] = Math.min(255, Math.round(outBuf[di + channel] * 0.8 + add * 0.2));
          }
      }
    }
  };

  // Clear to black for additive
  for (let i = 0; i < outBuf.length; i += 4) { outBuf[i] = 0; outBuf[i + 1] = 0; outBuf[i + 2] = 0; outBuf[i + 3] = 255; }

  renderChannel(0, offsetR, 0);
  renderChannel(1, offsetG, 0);
  renderChannel(2, 0, offsetB);

  // Apply palette
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Color Halftone Separate", func: colorHalftoneSeparate, optionTypes, options: defaults, defaults });
