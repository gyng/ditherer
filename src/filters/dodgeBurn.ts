import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";

const MODE = { DODGE: "DODGE", BURN: "BURN", BOTH: "BOTH" };

export const optionTypes = {
  mode: { type: ENUM, options: [
    { name: "Dodge (lighten shadows)", value: MODE.DODGE },
    { name: "Burn (darken highlights)", value: MODE.BURN },
    { name: "Both", value: MODE.BOTH }
  ], default: MODE.BOTH },
  strength: { type: RANGE, range: [0, 1], step: 0.05, default: 0.3 },
  range: { type: RANGE, range: [0, 255], step: 1, default: 128 },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  mode: optionTypes.mode.default,
  strength: optionTypes.strength.default,
  range: optionTypes.range.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const dodgeBurn = (input, options: any = defaults) => {
  const { mode, strength, range: lumRange, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width, H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      let r = buf[i], g = buf[i + 1], b = buf[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      // Dodge: lighten pixels below range
      if ((mode === MODE.DODGE || mode === MODE.BOTH) && lum < lumRange && lumRange > 0) {
        const factor = 1 + strength * (1 - lum / lumRange);
        r = Math.min(255, Math.round(r * factor));
        g = Math.min(255, Math.round(g * factor));
        b = Math.min(255, Math.round(b * factor));
      }

      // Burn: darken pixels above range
      if ((mode === MODE.BURN || mode === MODE.BOTH) && lum > lumRange && lumRange < 255) {
        const factor = 1 - strength * ((lum - lumRange) / (255 - lumRange));
        r = Math.max(0, Math.round(r * factor));
        g = Math.max(0, Math.round(g * factor));
        b = Math.max(0, Math.round(b * factor));
      }

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default { name: "Dodge / Burn", func: dodgeBurn, optionTypes, options: defaults, defaults };
