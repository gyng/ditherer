import { RANGE, COLOR, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderLightLeakGL } from "./lightLeakGL";

const POS = { TL: "TL", TR: "TR", BL: "BL", BR: "BR" };

export const optionTypes = {
  intensity: { type: RANGE, range: [0, 1], step: 0.05, default: 0.5, desc: "Light leak brightness" },
  position: { type: ENUM, options: [
    { name: "Top-Left", value: POS.TL }, { name: "Top-Right", value: POS.TR },
    { name: "Bottom-Left", value: POS.BL }, { name: "Bottom-Right", value: POS.BR }
  ], default: POS.TR, desc: "Corner where the light leak originates" },
  color: { type: COLOR, default: [255, 120, 50], desc: "Leak color tint" },
  spread: { type: RANGE, range: [0.1, 1], step: 0.05, default: 0.4, desc: "How far the leak extends into the image" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  intensity: optionTypes.intensity.default,
  position: optionTypes.position.default,
  color: optionTypes.color.default,
  spread: optionTypes.spread.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const lightLeak = (input: any, options: typeof defaults = defaults) => {
  const { intensity, position, color: leakColor, spread, palette } = options;
  const W = input.width, H = input.height;

  const srcX = position === POS.TR || position === POS.BR ? W : 0;
  const srcY = position === POS.BL || position === POS.BR ? H : 0;
  const maxDist = Math.sqrt(W * W + H * H) * spread;

  const rendered = renderLightLeakGL(input, W, H,
      srcX, srcY,
      [leakColor[0], leakColor[1], leakColor[2]],
      intensity, maxDist,);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Light Leak", "WebGL2", identity ? `pos=${position}` : `pos=${position}+palettePass`);
  return out ?? input;
};

export default defineFilter({ name: "Light Leak", func: lightLeak, optionTypes, options: defaults, defaults, requiresGL: true });
