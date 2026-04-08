import { ACTION, RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

export const optionTypes = {
  blockSize: { type: RANGE, range: [4, 32], step: 1, default: 16 },
  motionThreshold: { type: RANGE, range: [0, 100], step: 1, default: 20 },
  displacement: { type: RANGE, range: [0, 30], step: 1, default: 8 },
  corruptChance: { type: RANGE, range: [0, 1], step: 0.01, default: 0.15 },
  channelShift: { type: RANGE, range: [0, 10], step: 1, default: 2 },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions, inputCanvas, filterFunc, options) => {
      if (actions.isAnimating()) {
        actions.stopAnimLoop();
      } else {
        actions.startAnimLoop(inputCanvas, filterFunc, options, options.animSpeed || 12);
      }
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  blockSize: optionTypes.blockSize.default,
  motionThreshold: optionTypes.motionThreshold.default,
  displacement: optionTypes.displacement.default,
  corruptChance: optionTypes.corruptChance.default,
  channelShift: optionTypes.channelShift.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

// Simple seeded pseudo-random for deterministic per-frame noise
const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const datamosh = (
  input,
  options = defaults
) => {
  const {
    blockSize,
    motionThreshold,
    displacement,
    corruptChance,
    channelShift,
    palette
  } = options;

  const prevOutput = (options as any)._prevOutput || null;
  const frameIndex = (options as any)._frameIndex || 0;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const rng = mulberry32(frameIndex * 7919 + 31337);

  // Threshold scaled to 0-255 range
  const threshold = (motionThreshold / 100) * 255;

  const blocksX = Math.ceil(W / blockSize);
  const blocksY = Math.ceil(H / blockSize);

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const startX = bx * blockSize;
      const startY = by * blockSize;
      const endX = Math.min(startX + blockSize, W);
      const endY = Math.min(startY + blockSize, H);

      // Compute average luminance difference between current and previous frame
      let lumaDiff = 0;
      let pixelCount = 0;

      if (prevOutput && prevOutput.length === buf.length) {
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const i = getBufferIndex(x, y, W);
            const curLuma = buf[i] * 0.2126 + buf[i + 1] * 0.7152 + buf[i + 2] * 0.0722;
            const prevLuma = prevOutput[i] * 0.2126 + prevOutput[i + 1] * 0.7152 + prevOutput[i + 2] * 0.0722;
            lumaDiff += Math.abs(curLuma - prevLuma);
            pixelCount++;
          }
        }
        lumaDiff = pixelCount > 0 ? lumaDiff / pixelCount : 0;
      } else {
        // No previous frame — treat as full motion (use current frame)
        lumaDiff = threshold + 1;
      }

      const isCorrupt = rng() < corruptChance;

      if (lumaDiff < threshold && prevOutput) {
        // No significant motion — keep previous frame's block
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const i = getBufferIndex(x, y, W);
            fillBufferPixel(outBuf, i, prevOutput[i], prevOutput[i + 1], prevOutput[i + 2], prevOutput[i + 3]);
          }
        }
      } else if (isCorrupt) {
        // Corrupt block — duplicate from a nearby block with offset
        const offsetBx = bx + Math.floor((rng() - 0.5) * 6);
        const offsetBy = by + Math.floor((rng() - 0.5) * 6);
        const srcStartX = Math.max(0, Math.min(W - blockSize, offsetBx * blockSize));
        const srcStartY = Math.max(0, Math.min(H - blockSize, offsetBy * blockSize));

        const chShiftX = Math.round((rng() - 0.5) * channelShift * 2);
        const chShiftY = Math.round((rng() - 0.5) * channelShift * 2);

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const srcX = Math.max(0, Math.min(W - 1, srcStartX + (x - startX)));
            const srcY = Math.max(0, Math.min(H - 1, srcStartY + (y - startY)));
            const srcI = getBufferIndex(srcX, srcY, W);

            // Channel shift: read R from an offset position
            const shiftedX = Math.max(0, Math.min(W - 1, srcX + chShiftX));
            const shiftedY = Math.max(0, Math.min(H - 1, srcY + chShiftY));
            const shiftedI = getBufferIndex(shiftedX, shiftedY, W);

            const r = buf[shiftedI];     // R from shifted position
            const g = buf[srcI + 1];     // G from source
            const b = buf[srcI + 2];     // B from source

            const i = getBufferIndex(x, y, W);
            const color = paletteGetColor(palette, rgba(r, g, b, buf[srcI + 3]), palette.options, false);
            fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[srcI + 3]);
          }
        }
      } else {
        // Motion detected — use current frame's block but with displacement
        const dispX = Math.round((rng() - 0.5) * displacement * 2);
        const dispY = Math.round((rng() - 0.5) * displacement * 2);

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const srcX = Math.max(0, Math.min(W - 1, x + dispX));
            const srcY = Math.max(0, Math.min(H - 1, y + dispY));
            const srcI = getBufferIndex(srcX, srcY, W);

            const i = getBufferIndex(x, y, W);
            const color = paletteGetColor(palette, rgba(buf[srcI], buf[srcI + 1], buf[srcI + 2], buf[srcI + 3]), palette.options, false);
            fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[srcI + 3]);
          }
        }
      }
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);

  return output;
};

export default {
  name: "Datamosh",
  func: datamosh,
  options: defaults,
  optionTypes,
  defaults
};
