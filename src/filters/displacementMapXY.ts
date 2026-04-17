import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderDisplacementMapXYGL } from "./displacementMapXYGL";

const CHANNEL = { R: 0, G: 1, B: 2 };

export const optionTypes = {
  strength: { type: RANGE, range: [0, 200], step: 1, default: 30, desc: "Maximum pixel displacement" },
  blurRadius: { type: RANGE, range: [0, 20], step: 1, default: 5, desc: "Pre-blur the displacement map for smoother warps" },
  channelX: { type: ENUM, options: [
    { name: "Red", value: CHANNEL.R }, { name: "Green", value: CHANNEL.G }, { name: "Blue", value: CHANNEL.B }
  ], default: CHANNEL.R, desc: "Color channel driving horizontal displacement" },
  channelY: { type: ENUM, options: [
    { name: "Red", value: CHANNEL.R }, { name: "Green", value: CHANNEL.G }, { name: "Blue", value: CHANNEL.B }
  ], default: CHANNEL.G, desc: "Color channel driving vertical displacement" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  strength: optionTypes.strength.default,
  blurRadius: optionTypes.blurRadius.default,
  channelX: optionTypes.channelX.default,
  channelY: optionTypes.channelY.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const displacementMapXY = (input: any, options: typeof defaults = defaults) => {
  const { strength, blurRadius, channelX, channelY, palette } = options;
  const W = input.width, H = input.height;

  const rendered = renderDisplacementMapXYGL(input, W, H,
      strength, blurRadius,
      channelX as 0 | 1 | 2, channelY as 0 | 1 | 2,);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Displacement Map XY", "WebGL2", `strength=${strength} blur=${blurRadius}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({ name: "Displacement Map XY", func: displacementMapXY, optionTypes, options: defaults, defaults });
