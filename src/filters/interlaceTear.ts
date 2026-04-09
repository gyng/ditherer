import { ACTION, RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

export const optionTypes = {
  tearOffset: { type: RANGE, range: [0, 100], step: 1, default: 20 },
  tearPosition: { type: RANGE, range: [0, 1], step: 0.01, default: 0.5 },
  fieldShift: { type: RANGE, range: [0, 20], step: 1, default: 3 },
  animSpeed: { type: RANGE, range: [1, 30], step: 1, default: 12 },
  animate: { type: ACTION, label: "Play / Stop", action: (actions, inputCanvas, _filterFunc, options) => {
    if (actions.isAnimating()) { actions.stopAnimLoop(); } else { actions.startAnimLoop(inputCanvas, options.animSpeed || 12); }
  }},
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  tearOffset: optionTypes.tearOffset.default,
  tearPosition: optionTypes.tearPosition.default,
  fieldShift: optionTypes.fieldShift.default,
  animSpeed: optionTypes.animSpeed.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const mulberry32 = (seed: number) => {
  let s = seed | 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

const interlaceTear = (input, options: any = defaults) => {
  const { tearOffset, tearPosition, fieldShift, palette } = options;
  const frameIndex = (options as any)._frameIndex || 0;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const rng = mulberry32(frameIndex * 7919 + 31337);

  const tearY = Math.round(H * tearPosition);

  for (let y = 0; y < H; y++) {
    // Interlace: even/odd field offset
    const isOddField = y % 2 === 1;
    const baseShift = isOddField ? fieldShift : 0;

    // Tear: below tear position, shift entire field
    let tearShift = 0;
    if (y > tearY) {
      tearShift = tearOffset + Math.round(rng() * tearOffset * 0.3);
    } else if (Math.abs(y - tearY) < 5) {
      // Transition zone: partial shift with noise
      tearShift = Math.round(tearOffset * (1 - Math.abs(y - tearY) / 5) + rng() * 10);
    }

    const totalShift = baseShift + tearShift;

    for (let x = 0; x < W; x++) {
      const srcX = ((x - totalShift) % W + W) % W;
      const si = getBufferIndex(srcX, y, W);
      const di = getBufferIndex(x, y, W);

      const color = paletteGetColor(palette, rgba(buf[si], buf[si + 1], buf[si + 2], buf[si + 3]), palette.options, false);
      fillBufferPixel(outBuf, di, color[0], color[1], color[2], buf[si + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Interlace Tear", func: interlaceTear, optionTypes, options: defaults, defaults };
