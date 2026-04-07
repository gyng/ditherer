import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, linearizeBuffer, delinearizeBuffer, paletteGetColor } from "utils";

export const optionTypes = {
  scale: { type: RANGE, range: [0.01, 1], step: 0.01, default: 0.25 },
  scaleXOverride: { type: RANGE, range: [0, 1], step: 0.01, default: 0 },
  scaleYOverride: { type: RANGE, range: [0, 1], step: 0.01, default: 0 },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  scale: optionTypes.scale.default,
  scaleXOverride: optionTypes.scaleXOverride.default,
  scaleYOverride: optionTypes.scaleYOverride.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const pixelate = (
  input,
  options
) => {
  const { scale, scaleXOverride, scaleYOverride, palette } = options;

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) return input;

  const temp = document.createElement("canvas");
  temp.width = input.width * (scaleXOverride || scale);
  temp.height = input.height * (scaleYOverride || scale);
  const tempCtx = temp.getContext("2d");
  tempCtx.imageSmoothingEnabled = false;
  tempCtx.drawImage(
    input,
    0,
    0,
    input.width * (scaleXOverride || scale),
    input.height * (scaleYOverride || scale)
  );

  const buf = tempCtx.getImageData(0, 0, temp.width, temp.height).data;
  if (options._linearize) linearizeBuffer(buf);
  for (let x = 0; x < temp.width; x += 1) {
    for (let y = 0; y < temp.height; y += 1) {
      const i = getBufferIndex(x, y, temp.width);
      const pixel = rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
      const color = paletteGetColor(palette, pixel, palette.options, options._linearize);
      fillBufferPixel(buf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  if (options._linearize) delinearizeBuffer(buf);
  tempCtx.putImageData(new ImageData(buf, temp.width, temp.height), 0, 0);

  outputCtx.imageSmoothingEnabled = false;
  outputCtx.drawImage(temp, 0, 0, input.width, input.height);

  return output;
};

export default {
  name: "Pixelate",
  func: pixelate,
  options: defaults,
  optionTypes,
  defaults
};
