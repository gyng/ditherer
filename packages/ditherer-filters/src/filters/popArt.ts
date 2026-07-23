import { COLOR, RANGE, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { logFilterBackend } from "../utils/index";
import { defineFilter } from "./types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { renderPopArtGL } from "./popArtGL";

export const optionTypes = {
  dotSize: { type: RANGE, range: [3, 16], step: 1, default: 6, label: "Screen pitch", desc: "Spacing of the Ben-Day dot screen in pixels" },
  levels: { type: RANGE, range: [2, 8], step: 1, default: 4, desc: "Color posterization levels" },
  saturationBoost: { type: RANGE, range: [1, 3], step: 0.1, default: 2, desc: "Vivid color saturation multiplier" },
  screenAngle: { type: RANGE, range: [0, 90], step: 1, default: 15, desc: "Rotation angle of the Ben-Day dot screen" },
  paperColor: { type: COLOR, default: [255, 248, 235], desc: "Paper color visible between printed dots" },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette and quantization" }
};

export const defaults = {
  dotSize: optionTypes.dotSize.default,
  levels: optionTypes.levels.default,
  saturationBoost: optionTypes.saturationBoost.default,
  screenAngle: optionTypes.screenAngle.default,
  paperColor: optionTypes.paperColor.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

export type PopArtSpotGeometry = { mode: "DOT" | "HOLE"; radius: number };

export const popArtSpotGeometry = (darkness: number, pitch: number): PopArtSpotGeometry => {
  const safeDarkness = Number.isFinite(darkness) ? Math.min(1, Math.max(0, darkness)) : 0;
  const safePitch = Number.isFinite(pitch) ? Math.max(1, pitch) : 1;
  if (safeDarkness <= Math.PI / 4) {
    return { mode: "DOT", radius: safePitch * Math.sqrt(safeDarkness / Math.PI) };
  }
  return { mode: "HOLE", radius: safePitch * Math.sqrt((1 - safeDarkness) / Math.PI) };
};

const popArt = (input: any, options: Partial<typeof defaults> = defaults) => {
  const dotSize = options.dotSize ?? defaults.dotSize;
  const levels = options.levels ?? defaults.levels;
  const saturationBoost = options.saturationBoost ?? defaults.saturationBoost;
  const screenAngle = options.screenAngle ?? defaults.screenAngle;
  const paperColor = options.paperColor ?? defaults.paperColor;
  const palette = options.palette ?? defaults.palette;
  const W = input.width, H = input.height;

  const rendered = renderPopArtGL(
    input, W, H, dotSize, levels, saturationBoost, screenAngle,
    [paperColor[0], paperColor[1], paperColor[2]],
  );
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Pop Art", "WebGL2", `dotSize=${dotSize} levels=${levels}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Pop Art",
  func: popArt,
  optionTypes,
  options: defaults,
  defaults,
  description: "Posterize color into an area-correct, rotatable Ben-Day screen on configurable paper",
  requiresGL: true,
});
