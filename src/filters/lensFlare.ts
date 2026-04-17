import { RANGE, COLOR, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderLensFlareGL } from "./lensFlareGL";

export const optionTypes = {
  positionX: { type: RANGE, range: [0, 1], step: 0.01, default: 0.3, desc: "Horizontal light source position" },
  positionY: { type: RANGE, range: [0, 1], step: 0.01, default: 0.3, desc: "Vertical light source position" },
  intensity: { type: RANGE, range: [0, 2], step: 0.1, default: 1, desc: "Overall flare brightness" },
  flareColor: { type: COLOR, default: [255, 200, 100], desc: "Tint color of the flare" },
  ghosts: { type: RANGE, range: [0, 6], step: 1, default: 3, desc: "Number of lens ghost reflections" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  positionX: optionTypes.positionX.default,
  positionY: optionTypes.positionY.default,
  intensity: optionTypes.intensity.default,
  flareColor: optionTypes.flareColor.default,
  ghosts: optionTypes.ghosts.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const lensFlare = (input: any, options: typeof defaults = defaults) => {
  const { positionX, positionY, intensity, flareColor, ghosts, palette } = options;
  const W = input.width, H = input.height;
  const cx = W * positionX, cy = H * positionY;
  const imgCx = W / 2, imgCy = H / 2;

  const rendered = renderLensFlareGL(input, W, H,
      cx, cy,
      intensity,
      [flareColor[0], flareColor[1], flareColor[2]],
      ghosts,);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Lens Flare", "WebGL2", `intensity=${intensity} ghosts=${ghosts}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({ name: "Lens Flare", func: lensFlare, optionTypes, options: defaults, defaults });
