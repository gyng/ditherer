import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, fillBufferPixel, getBufferIndex, rgba, srgbPaletteGetColor, logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { solarizeGLAvailable, renderSolarizeGL } from "./solarizeGL";

export const optionTypes = {
  threshold: { type: RANGE, range: [0, 255], step: 1, default: 96, desc: "Brightness level above which pixels invert" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  threshold: optionTypes.threshold.default,
  palette: optionTypes.palette.default
};

type SolarizeOptions = typeof defaults & { _webglAcceleration?: boolean };

const solarize = (input: any, options: SolarizeOptions = defaults) => {
  const { threshold, palette } = options;
  const W = input.width, H = input.height;

  if (options._webglAcceleration !== false && solarizeGLAvailable()) {
    const rendered = renderSolarizeGL(input, W, H, threshold);
    if (rendered) {
      const identity = paletteIsIdentity(palette);
      const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
      if (out) {
        logFilterBackend("Solarize", "WebGL2", `threshold=${threshold}${identity ? "" : "+palettePass"}`);
        return out;
      }
    }
  }

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;

  for (let x = 0; x < input.width; x += 1) {
    for (let y = 0; y < input.height; y += 1) {
      const i = getBufferIndex(x, y, input.width);
      const r = buf[i] > threshold ? 255 - buf[i] : buf[i];
      const g = buf[i + 1] > threshold ? 255 - buf[i + 1] : buf[i + 1];
      const b = buf[i + 2] > threshold ? 255 - buf[i + 2] : buf[i + 2];
      const col = srgbPaletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options);
      fillBufferPixel(buf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default defineFilter({
  name: "Solarize",
  func: solarize,
  options: defaults,
  optionTypes,
  defaults
});
