import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, srgbBufToLinearFloat, linearFloatToSrgbBuf, srgbPaletteGetColor, linearPaletteGetColor, logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { pixelateGLAvailable, renderPixelateGL } from "./pixelateGL";

export const optionTypes = {
  scale: { type: RANGE, range: [0.01, 1], step: 0.01, default: 0.25, desc: "Downscale factor for both axes (smaller = bigger pixels)" },
  scaleXOverride: { type: RANGE, range: [0, 1], step: 0.01, default: 0, desc: "Override horizontal scale (0 = use main scale)" },
  scaleYOverride: { type: RANGE, range: [0, 1], step: 0.01, default: 0, desc: "Override vertical scale (0 = use main scale)" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  scale: optionTypes.scale.default,
  scaleXOverride: optionTypes.scaleXOverride.default,
  scaleYOverride: optionTypes.scaleYOverride.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const pixelate = (
  input: any,
  options: any
) => {
  const { scale, scaleXOverride, scaleYOverride, palette } = options;
  const W = input.width;
  const H = input.height;

  const effScaleX = scaleXOverride || scale;
  const effScaleY = scaleYOverride || scale;
  const downW = Math.max(1, Math.floor(W * effScaleX));
  const downH = Math.max(1, Math.floor(H * effScaleY));

  // GL path valid when palette is identity (no palette pass) and linearize
  // is off (palette-linear-sRGB round-trip has no effect without a palette).
  const identity = paletteIsIdentity(palette);
  if (options._webglAcceleration !== false && identity && !options._linearize && pixelateGLAvailable()) {
    const rendered = renderPixelateGL(input, W, H, downW, downH);
    if (rendered) {
      const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
      if (out) {
        logFilterBackend("Pixelate", "WebGL2", `scale=${effScaleX}x${effScaleY}`);
        return out;
      }
    }
  }

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) return input;

  const temp = cloneCanvas(input, false);
  temp.width = input.width * (scaleXOverride || scale);
  temp.height = input.height * (scaleYOverride || scale);
  const tempCtx = temp.getContext("2d");
  if (!tempCtx) {
    return input;
  }
  tempCtx.imageSmoothingEnabled = false;
  tempCtx.drawImage(
    input,
    0,
    0,
    input.width * (scaleXOverride || scale),
    input.height * (scaleYOverride || scale)
  );

  const buf = tempCtx.getImageData(0, 0, temp.width, temp.height).data;

  if (options._linearize) {
    const floatBuf = srgbBufToLinearFloat(buf);
    for (let x = 0; x < temp.width; x += 1) {
      for (let y = 0; y < temp.height; y += 1) {
        const i = getBufferIndex(x, y, temp.width);
        const pixel = [floatBuf[i], floatBuf[i + 1], floatBuf[i + 2], floatBuf[i + 3]];
        const color = linearPaletteGetColor(palette, pixel, palette.options);
        fillBufferPixel(floatBuf, i, color[0], color[1], color[2], floatBuf[i + 3]);
      }
    }
    linearFloatToSrgbBuf(floatBuf, buf);
  } else {
    for (let x = 0; x < temp.width; x += 1) {
      for (let y = 0; y < temp.height; y += 1) {
        const i = getBufferIndex(x, y, temp.width);
        const pixel = rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
        const color = srgbPaletteGetColor(palette, pixel, palette.options);
        fillBufferPixel(buf, i, color[0], color[1], color[2], buf[i + 3]);
      }
    }
  }

  tempCtx.putImageData(new ImageData(buf, temp.width, temp.height), 0, 0);

  outputCtx.imageSmoothingEnabled = false;
  outputCtx.drawImage(temp, 0, 0, input.width, input.height);

  return output;
};

export default defineFilter({
  name: "Pixelate",
  func: pixelate,
  options: defaults,
  optionTypes,
  defaults
});
