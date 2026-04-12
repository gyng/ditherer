import { ACTION, RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor
} from "utils";

export const optionTypes = {
  amplitude: { type: RANGE, range: [0, 50], step: 1, default: 10, desc: "Horizontal wave displacement" },
  frequency: { type: RANGE, range: [0.1, 10], step: 0.1, default: 2, desc: "Wave oscillation frequency" },
  phase: { type: RANGE, range: [0, 360], step: 1, default: 0, desc: "Wave phase offset in degrees" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions, inputCanvas, _filterFunc, options) => {
      if (actions.isAnimating()) {
        actions.stopAnimLoop();
      } else {
        actions.startAnimLoop(inputCanvas, options.animSpeed || 12);
      }
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  amplitude: optionTypes.amplitude.default,
  frequency: optionTypes.frequency.default,
  phase: optionTypes.phase.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const clamp = (v: number): number => Math.max(0, Math.min(255, v));

const scanlineWarp = (
  input,
  options = defaults
) => {
  const {
    amplitude,
    frequency,
    phase,
    palette
  } = options;

  const frameIndex = (options as any)._frameIndex || 0;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  const phaseRad = (phase * Math.PI) / 180;

  for (let y = 0; y < H; y++) {
    const shift = amplitude * Math.sin(
      y * frequency * 2 * Math.PI / H + phaseRad + frameIndex * 0.2
    );

    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);

      // Bilinear sample from shifted x position
      const srcX = x + shift;
      const x0 = Math.floor(srcX);
      const x1 = x0 + 1;
      const fx = srcX - x0;

      const sx0 = Math.max(0, Math.min(W - 1, x0));
      const sx1 = Math.max(0, Math.min(W - 1, x1));

      const i0 = getBufferIndex(sx0, y, W);
      const i1 = getBufferIndex(sx1, y, W);

      const r = clamp(buf[i0] * (1 - fx) + buf[i1] * fx);
      const g = clamp(buf[i0 + 1] * (1 - fx) + buf[i1 + 1] * fx);
      const b = clamp(buf[i0 + 2] * (1 - fx) + buf[i1 + 2] * fx);

      const color = paletteGetColor(palette, rgba(r, g, b, 255), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], 255);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);

  return output;
};

export default defineFilter({
  name: "Scanline Warp",
  func: scanlineWarp,
  options: defaults,
  optionTypes,
  defaults
});
