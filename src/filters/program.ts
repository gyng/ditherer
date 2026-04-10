import { ENUM, TEXT, PALETTE } from "constants/controlTypes";
import * as palettes from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, srgbPaletteGetColor } from "utils";

export const ALL = "ALL";
export const PIXEL = "PIXEL";

export const optionTypes = {
  mode: {
    type: ENUM,
    options: [{ name: "Pixel", value: PIXEL }],
    default: PIXEL,
    desc: "Execution scope for the custom program"
  },
  program: {
    type: TEXT,
    desc: "Custom JavaScript code run per pixel",
    default: `// Eval'd JS
// Errors in console
// Variables:
// r, g, b, a
// w, h, x, y
// const p ([r, g, b, a]),
// const i (index),
// buf (pixel array)
// palette

r = buf[i + 17];
g = b;
b = i % 255;
a = 255;`
  },
  palette: { type: PALETTE, default: palettes.nearest }
};

export const defaults = {
  mode: optionTypes.mode.default,
  program: optionTypes.program.default,
  palette: optionTypes.palette.default
};

const programFilter = (
  input,
  options = defaults
) => {
  const { program, palette } = options;
  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  const w = input.width;
  const h = input.height;

  let pixelFn: (...args: any[]) => [number, number, number, number];
  try {
    // Compile the user program once. It reads/writes r,g,b,a and reads
    // i,p,w,h,x,y,buf,palette; we return the (possibly mutated) channels.
    pixelFn = new Function(
      "r", "g", "b", "a", "i", "p", "w", "h", "x", "y", "buf", "palette",
      `${program}\nreturn [r, g, b, a];`
    ) as (...args: any[]) => [number, number, number, number];
  } catch (e) {
    console.error(e);
    return input;
  }

  outside: for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) {
      const i = getBufferIndex(x, y, w);
      const p = rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);

      let r = p[0];
      let g = p[1];
      let b = p[2];
      let a = p[3];

      try {
        [r, g, b, a] = pixelFn(r, g, b, a, i, p, w, h, x, y, buf, palette);
      } catch (e) {
        console.error(e);
        break outside;
      }

      const col = srgbPaletteGetColor(palette, [r, g, b, a], palette.options);
      fillBufferPixel(buf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default {
  name: "Program",
  func: programFilter,
  optionTypes,
  options: defaults,
  defaults
};
