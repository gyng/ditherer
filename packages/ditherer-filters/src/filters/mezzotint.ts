import { COLOR, RANGE, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { logFilterBackend } from "../utils/index";
import { defineFilter } from "./types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { renderMezzotintGL } from "./mezzotintGL";

export const optionTypes = {
  density: { type: RANGE, range: [0.2, 1], step: 0.01, default: 0.98, desc: "Ink-holding density of the fully rocked plate ground" },
  dotSize: { type: RANGE, range: [1, 8], step: 1, default: 2, desc: "Scale of the rocker-tooth grain in output pixels" },
  burnish: { type: RANGE, range: [0.4, 2], step: 0.05, default: 1.35, desc: "Tonal curve created by scraping and burnishing the dark ground toward paper" },
  burrStrength: { type: RANGE, range: [0, 0.5], step: 0.01, default: 0.13, desc: "Visibility of the crossed ink-holding rocker burr" },
  plateWear: { type: RANGE, range: [0, 1], step: 0.05, default: 0.03, desc: "Flatten the fragile burr as though later impressions were pulled from a worn plate" },
  inkColor: { type: COLOR, default: [18, 16, 20], desc: "Intaglio ink color" },
  paperColor: { type: COLOR, default: [239, 232, 216], desc: "Damp printmaking paper color" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette quantization" }
};

export const defaults = {
  density: optionTypes.density.default,
  dotSize: optionTypes.dotSize.default,
  burnish: optionTypes.burnish.default,
  burrStrength: optionTypes.burrStrength.default,
  plateWear: optionTypes.plateWear.default,
  inkColor: optionTypes.inkColor.default,
  paperColor: optionTypes.paperColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

const mezzotint = (input: any, options: Partial<typeof defaults> = defaults) => {
  const resolved = { ...defaults, ...options };
  const { density, dotSize, burnish, burrStrength, plateWear, inkColor, paperColor, palette } = resolved;
  const W = input.width, H = input.height;

  const rendered = renderMezzotintGL(
    input, W, H, density, dotSize, burnish, burrStrength, plateWear,
    inkColor as [number, number, number], paperColor as [number, number, number],
  );
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Mezzotint", "WebGL2", `density=${density} dotSize=${dotSize}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Mezzotint",
  func: mezzotint,
  optionTypes,
  options: defaults,
  defaults,
  description: "Dark-ground tonal mezzotint with crossed rocker burr, scraped and burnished light, plate wear, ink, and paper",
  requiresGL: true,
});
