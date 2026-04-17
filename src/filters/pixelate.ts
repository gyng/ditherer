import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, applyLinearPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderPixelateGL } from "./pixelateGL";

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

type PixelateOptions = typeof defaults & { _linearize?: boolean };

// GL always does the nearest-downsample + nearest-upsample. Palette pass
// lives post-readout: linear-space when `_linearize` is on and palette
// isn't identity, sRGB otherwise.
const pixelate = (input: any, options: PixelateOptions = defaults) => {
  const { scale, scaleXOverride, scaleYOverride, palette } = options;
  const W = input.width, H = input.height;
  const effScaleX = scaleXOverride || scale;
  const effScaleY = scaleYOverride || scale;
  const downW = Math.max(1, Math.floor(W * effScaleX));
  const downH = Math.max(1, Math.floor(H * effScaleY));
  const rendered = renderPixelateGL(input, W, H, downW, downH);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  let out: HTMLCanvasElement | OffscreenCanvas | null = rendered;
  if (!identity) {
    out = options._linearize
      ? applyLinearPalettePassToCanvas(rendered, W, H, palette)
      : applyPalettePassToCanvas(rendered, W, H, palette);
  }
  const suffix = identity ? "" : options._linearize ? "+linearPalette" : "+palette";
  logFilterBackend("Pixelate", "WebGL2", `scale=${effScaleX}x${effScaleY}${suffix}`);
  return out ?? input;
};

export default defineFilter({
  name: "Pixelate",
  func: pixelate,
  options: defaults,
  optionTypes,
  defaults,
  requiresGL: true,
});
