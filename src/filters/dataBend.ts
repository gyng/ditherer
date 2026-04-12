import { ACTION, RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

const EFFECT = { ECHO: "ECHO", REVERB: "REVERB", BITCRUSH: "BITCRUSH", REVERSE: "REVERSE" };

export const optionTypes = {
  effect: { type: ENUM, options: [
    { name: "Echo", value: EFFECT.ECHO },
    { name: "Reverb", value: EFFECT.REVERB },
    { name: "Bitcrush", value: EFFECT.BITCRUSH },
    { name: "Reverse", value: EFFECT.REVERSE }
  ], default: EFFECT.ECHO, desc: "Audio-style corruption applied to pixel data" },
  intensity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5, desc: "Effect strength" },
  offset: { type: RANGE, range: [1, 500], step: 1, default: 100, desc: "Byte offset for echo/reverb displacement" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 10 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions: any, inputCanvas: any, _filterFunc: any, options: any) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 10); }
  }},
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  effect: optionTypes.effect.default,
  intensity: optionTypes.intensity.default,
  offset: optionTypes.offset.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const dataBend = (input: any, options = defaults) => {
  const { effect, intensity, offset, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // Treat pixel data as a 1D signal and apply audio-like effects
  outBuf.set(buf);

  switch (effect) {
    case EFFECT.ECHO: {
      const delay = offset * 4; // byte offset
      const decay = intensity;
      for (let i = delay; i < outBuf.length; i += 4) {
        outBuf[i] = Math.min(255, Math.round(outBuf[i] + buf[i - delay] * decay));
        outBuf[i + 1] = Math.min(255, Math.round(outBuf[i + 1] + buf[i - delay + 1] * decay));
        outBuf[i + 2] = Math.min(255, Math.round(outBuf[i + 2] + buf[i - delay + 2] * decay));
      }
      break;
    }
    case EFFECT.REVERB: {
      // Multiple echoes with decay
      for (let echo = 1; echo <= 5; echo++) {
        const delay = offset * 4 * echo;
        const decay = intensity * Math.pow(0.6, echo);
        for (let i = delay; i < outBuf.length; i += 4) {
          outBuf[i] = Math.min(255, Math.round(outBuf[i] + buf[i - delay] * decay));
          outBuf[i + 1] = Math.min(255, Math.round(outBuf[i + 1] + buf[i - delay + 1] * decay));
          outBuf[i + 2] = Math.min(255, Math.round(outBuf[i + 2] + buf[i - delay + 2] * decay));
        }
      }
      break;
    }
    case EFFECT.BITCRUSH: {
      const bits = Math.max(1, Math.round(8 - intensity * 6));
      const step = Math.pow(2, 8 - bits);
      for (let i = 0; i < outBuf.length; i += 4) {
        outBuf[i] = Math.round(outBuf[i] / step) * step;
        outBuf[i + 1] = Math.round(outBuf[i + 1] / step) * step;
        outBuf[i + 2] = Math.round(outBuf[i + 2] / step) * step;
      }
      // Sample rate reduction: repeat pixels
      const sampleRate = Math.max(1, Math.round(offset / 10));
      for (let i = 0; i < outBuf.length; i += 4) {
        const aligned = Math.floor(i / (sampleRate * 4)) * sampleRate * 4;
        if (aligned !== i && aligned >= 0 && aligned < outBuf.length) {
          outBuf[i] = outBuf[aligned]; outBuf[i + 1] = outBuf[aligned + 1]; outBuf[i + 2] = outBuf[aligned + 2];
        }
      }
      break;
    }
    case EFFECT.REVERSE: {
      // Reverse chunks of pixel data
      const chunkSize = offset * 4;
      for (let start = 0; start < outBuf.length; start += chunkSize * 2) {
        const end = Math.min(start + chunkSize, outBuf.length);
        for (let i = start, j = end - 4; i < j; i += 4, j -= 4) {
          for (let c = 0; c < 3; c++) {
            const tmp = outBuf[i + c]; outBuf[i + c] = outBuf[j + c]; outBuf[j + c] = tmp;
          }
        }
      }
      break;
    }
  }

  // Ensure alpha is preserved
  for (let i = 3; i < outBuf.length; i += 4) outBuf[i] = buf[i];

  // Apply palette
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const color = paletteGetColor(palette, rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], outBuf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], outBuf[i + 3]);
    }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({ name: "Data Bend", func: dataBend, optionTypes, options: defaults, defaults });
