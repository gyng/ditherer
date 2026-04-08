import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, rgba2hsva, srgbPaletteGetColor } from "utils";

// h: 0-360, s/v/a: 0-1 → r/g/b/a: 0-255
const hsva2rgba = ([h, s, v, a]) => {
  if (s === 0) {
    const c = Math.round(v * 255);
    return [c, c, c, Math.round(a * 255)];
  }
  const hh = (((h % 360) + 360) % 360) / 60;
  const sector = Math.floor(hh);
  const f = hh - sector;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  let r, g, b;
  switch (sector) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), Math.round(a * 255)];
};

export const optionTypes = {
  hue: { type: RANGE, range: [-180, 180], step: 1, default: 0 },
  saturation: { type: RANGE, range: [-1, 1], step: 0.01, default: 0 },
  value: { type: RANGE, range: [-1, 1], step: 0.01, default: 0 },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  hue: optionTypes.hue.default,
  saturation: optionTypes.saturation.default,
  value: optionTypes.value.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const colorShift = (input, options = defaults) => {
  const { hue, saturation, value, palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  for (let x = 0; x < input.width; x += 1) {
    for (let y = 0; y < input.height; y += 1) {
      const i = getBufferIndex(x, y, input.width);
      const [h, s, v, a] = rgba2hsva(rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]));
      const shifted = hsva2rgba([
        h + hue,
        Math.max(0, Math.min(1, s + saturation)),
        Math.max(0, Math.min(1, v + value)),
        a
      ]);
      const col = srgbPaletteGetColor(palette, shifted, palette.options);
      fillBufferPixel(buf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default {
  name: "Color shift",
  func: colorShift,
  options: defaults,
  optionTypes,
  defaults
};
