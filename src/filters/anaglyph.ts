import { RANGE, ENUM } from "constants/controlTypes";
import { cloneCanvas, clamp, getBufferIndex } from "utils";
import { computeLuminance, sobelEdges } from "utils/edges";

const MODE = {
  RED_CYAN: "RED_CYAN",
  RED_GREEN: "RED_GREEN",
  MAGENTA_GREEN: "MAGENTA_GREEN",
  YELLOW_BLUE: "YELLOW_BLUE"
};

const DEPTH = {
  LUMINANCE: "LUMINANCE",
  EDGE: "EDGE",
  CONSTANT: "CONSTANT"
};

export const optionTypes = {
  strength: { type: RANGE, range: [1, 20], step: 1, default: 5, desc: "Horizontal channel offset in pixels" },
  mode: {
    type: ENUM,
    options: [
      { name: "Red / Cyan", value: MODE.RED_CYAN },
      { name: "Red / Green", value: MODE.RED_GREEN },
      { name: "Magenta / Green", value: MODE.MAGENTA_GREEN },
      { name: "Yellow / Blue", value: MODE.YELLOW_BLUE }
    ],
    default: MODE.RED_CYAN,
    desc: "Color pair used for the stereoscopic split"
  },
  depthSource: {
    type: ENUM,
    options: [
      { name: "Luminance", value: DEPTH.LUMINANCE },
      { name: "Edge density", value: DEPTH.EDGE },
      { name: "Constant", value: DEPTH.CONSTANT }
    ],
    default: DEPTH.LUMINANCE,
    desc: "How the offset strength is modulated across the image"
  }
};

export const defaults = {
  strength: optionTypes.strength.default,
  mode: optionTypes.mode.default,
  depthSource: optionTypes.depthSource.default
};

const anaglyph = (input, options: any = defaults) => {
  const { strength, mode, depthSource } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const lum = depthSource === DEPTH.LUMINANCE || depthSource === DEPTH.EDGE ? computeLuminance(buf, W, H) : null;
  const edge = depthSource === DEPTH.EDGE && lum ? sobelEdges(lum, W, H).magnitude : null;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const depth = depthSource === DEPTH.CONSTANT
        ? 1
        : depthSource === DEPTH.EDGE
          ? Math.min(1, (edge![y * W + x] || 0) / 255)
          : (lum![y * W + x] || 0);

      const offset = Math.max(1, Math.round(strength * depth));
      const lx = clamp(0, W - 1, x - offset);
      const rx = clamp(0, W - 1, x + offset);
      const li = getBufferIndex(lx, y, W);
      const ri = getBufferIndex(rx, y, W);

      let r: number;
      let g: number;
      let b: number;

      if (mode === MODE.RED_CYAN) {
        r = buf[li];
        g = buf[ri + 1];
        b = buf[ri + 2];
      } else if (mode === MODE.RED_GREEN) {
        r = buf[li];
        g = buf[ri + 1];
        b = 0;
      } else if (mode === MODE.MAGENTA_GREEN) {
        r = buf[li];
        g = buf[ri + 1];
        b = buf[li + 2];
      } else {
        r = buf[li];
        g = buf[li + 1];
        b = buf[ri + 2];
      }

      outBuf[i] = r;
      outBuf[i + 1] = g;
      outBuf[i + 2] = b;
      outBuf[i + 3] = buf[i + 3];
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default {
  name: "Anaglyph",
  func: anaglyph,
  optionTypes,
  options: defaults,
  defaults
};
