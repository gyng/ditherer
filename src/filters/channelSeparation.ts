import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, paletteGetColor } from "utils";
import { defineFilter } from "filters/types";

export const optionTypes = {
  rOffsetX: { type: RANGE, range: [0, 100], default: 10, desc: "Red channel horizontal offset" },
  rOffsetY: { type: RANGE, range: [0, 100], default: 0, desc: "Red channel vertical offset" },
  rOpacity: { type: RANGE, range: [0, 1], step: 0.05, default: 1, desc: "Red channel opacity" },
  gOffsetX: { type: RANGE, range: [0, 100], default: 0, desc: "Green channel horizontal offset" },
  gOffsetY: { type: RANGE, range: [0, 100], default: 5, desc: "Green channel vertical offset" },
  gOpacity: { type: RANGE, range: [0, 1], step: 0.05, default: 1, desc: "Green channel opacity" },
  bOffsetX: { type: RANGE, range: [0, 100], default: 8, desc: "Blue channel horizontal offset" },
  bOffsetY: { type: RANGE, range: [0, 100], default: 4, desc: "Blue channel vertical offset" },
  bOpacity: { type: RANGE, range: [0, 1], step: 0.05, default: 1, desc: "Blue channel opacity" },
  aOffsetX: { type: RANGE, range: [0, 100], default: 0, desc: "Alpha channel horizontal offset" },
  aOffsetY: { type: RANGE, range: [0, 100], default: 0, desc: "Alpha channel vertical offset" },
  aOpacity: { type: RANGE, range: [0, 1], step: 0.05, default: 1, desc: "Alpha channel opacity" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  rOffsetX: optionTypes.rOffsetX.default,
  rOffsetY: optionTypes.rOffsetY.default,
  rOpacity: optionTypes.rOpacity.default,
  gOffsetX: optionTypes.gOffsetX.default,
  gOffsetY: optionTypes.gOffsetY.default,
  gOpacity: optionTypes.gOpacity.default,
  bOffsetX: optionTypes.bOffsetX.default,
  bOffsetY: optionTypes.bOffsetY.default,
  bOpacity: optionTypes.bOpacity.default,
  aOffsetX: optionTypes.aOffsetX.default,
  aOffsetY: optionTypes.aOffsetY.default,
  aOpacity: optionTypes.aOpacity.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const channelSeparation = (
  input,
  options = defaults
) => {
  const {
    rOffsetX,
    rOffsetY,
    rOpacity,
    gOffsetX,
    gOffsetY,
    gOpacity,
    bOffsetX,
    bOffsetY,
    bOpacity,
    aOffsetX,
    aOffsetY,
    aOpacity,
    palette
  } = options;

  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  for (let x = 0; x < input.width; x += 1) {
    for (let y = 0; y < input.height; y += 1) {
      const i = getBufferIndex(x, y, input.width);

      const rX = rOffsetX + x;
      const rY = rOffsetY + y;
      const rI = getBufferIndex(rX, rY, input.width);

      const gX = gOffsetX + x;
      const gY = gOffsetY + y;
      const gI = getBufferIndex(gX, gY, input.width);

      const bX = bOffsetX + x;
      const bY = bOffsetY + y;
      const bI = getBufferIndex(bX, bY, input.width);

      const aX = aOffsetX + x;
      const aY = aOffsetY + y;
      const aI = getBufferIndex(aX, aY, input.width);

      const pixel = rgba(buf[rI], buf[gI + 1], buf[bI + 2], buf[aI + 3]);
      const color = paletteGetColor(palette, pixel, palette.options, false);
      fillBufferPixel(
        buf,
        i,
        color[0] * rOpacity,
        color[1] * gOpacity,
        color[2] * bOpacity,
        color[3] * aOpacity
      );
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default defineFilter({
  name: "Channel separation",
  func: channelSeparation,
  options: defaults,
  optionTypes,
  defaults
});
