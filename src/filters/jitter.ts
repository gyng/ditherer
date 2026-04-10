import { ACTION, RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  jitterX: { type: RANGE, range: [0, 100], default: 4, desc: "Maximum horizontal pixel displacement per row" },
  jitterXSpread: { type: RANGE, range: [0, 5], default: 0.5, step: 0.1, desc: "How much horizontal jitter carries over to the next row" },
  jitterY: { type: RANGE, range: [0, 100], default: 0, desc: "Maximum vertical pixel displacement per column" },
  jitterYSpread: { type: RANGE, range: [0, 5], default: 0.5, step: 0.1, desc: "How much vertical jitter carries over to the next column" },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12 },
  animate: {
    type: ACTION,
    label: "Play / Stop",
    action: (actions, inputCanvas, _filterFunc, options) => {
      if (actions.isAnimating()) { actions.stopAnimLoop(); }
      else { actions.startAnimLoop(inputCanvas, options.animSpeed || 12); }
    }
  },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  jitterX: optionTypes.jitterX.default,
  jitterXSpread: optionTypes.jitterXSpread.default,
  jitterY: optionTypes.jitterY.default,
  jitterYSpread: optionTypes.jitterYSpread.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const jitterFilter = (
  input,
  options = defaults
) => {
  const { jitterX, jitterXSpread, jitterY, jitterYSpread, palette } = options;
  const frameIndex = (options as any)._frameIndex || 0;
  const rng = mulberry32(frameIndex * 7919 + 31337);

  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  const jitterYMap = [];
  const jitterXMap = [];

  let jitterFactor = 0;
  for (let i = 0; i < input.width; i += 1) {
    const jitter = rng() * jitterY;
    jitterFactor += jitter;
    jitterYMap.push(Math.round(jitterFactor));
    jitterFactor *= jitterYSpread;
  }

  jitterFactor = 0;
  for (let i = 0; i < input.width; i += 1) {
    const jitter = rng() * jitterX;
    jitterFactor += jitter;
    jitterXMap.push(Math.round(jitterFactor));
    jitterFactor *= jitterXSpread;
  }

  for (let x = 0; x < input.width; x += 1) {
    for (let y = 0; y < input.height; y += 1) {
      const i = getBufferIndex(x, y, input.width);
      const jI = getBufferIndex(
        (x + jitterYMap[x]) % input.width,
        (y + jitterXMap[y]) % input.height,
        input.width
      );

      const pixel = rgba(buf[jI], buf[jI + 1], buf[jI + 2], buf[jI + 3]);
      const color = paletteGetColor(palette, pixel, palette.options, false);
      fillBufferPixel(buf, i, color[0], color[1], color[2], color[3]);
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default {
  name: "Jitter",
  func: jitterFilter,
  options: defaults,
  optionTypes,
  defaults
};
