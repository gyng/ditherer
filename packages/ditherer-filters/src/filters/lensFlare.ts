import { RANGE, COLOR, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { logFilterBackend } from "../utils/index";
import { defineFilter } from "./types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { renderLensFlareGL } from "./lensFlareGL";

export const optionTypes = {
  positionX: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.3,
    desc: "Horizontal light source position",
  },
  positionY: {
    type: RANGE,
    range: [0, 1],
    step: 0.01,
    default: 0.3,
    desc: "Vertical light source position",
  },
  intensity: {
    type: RANGE,
    range: [0, 2],
    step: 0.1,
    default: 1,
    desc: "Overall flare brightness",
  },
  bloomRadius: {
    type: RANGE,
    range: [0.03, 0.35],
    step: 0.01,
    default: 0.14,
    desc: "Bloom radius as a fraction of the image's short side",
  },
  flareColor: { type: COLOR, default: [255, 200, 100], desc: "Tint color of the flare" },
  ghosts: {
    type: RANGE,
    range: [0, 6],
    step: 1,
    default: 3,
    desc: "Number of lens ghost reflections",
  },
  ghostSpread: {
    type: RANGE,
    range: [0, 1.5],
    step: 0.05,
    default: 1,
    desc: "How far ghost reflections span along the optical axis",
  },
  streakStrength: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.35,
    desc: "Brightness of the horizontal anamorphic streak",
  },
  chromaticSpread: {
    type: RANGE,
    range: [0, 1],
    step: 0.05,
    default: 0.25,
    desc: "Color separation around ghost reflection edges",
  },
  palette: { type: PALETTE, default: nearest, desc: "Optional output palette and quantization" },
};

export const defaults = {
  positionX: optionTypes.positionX.default,
  positionY: optionTypes.positionY.default,
  intensity: optionTypes.intensity.default,
  bloomRadius: optionTypes.bloomRadius.default,
  flareColor: optionTypes.flareColor.default,
  ghosts: optionTypes.ghosts.default,
  ghostSpread: optionTypes.ghostSpread.default,
  streakStrength: optionTypes.streakStrength.default,
  chromaticSpread: optionTypes.chromaticSpread.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

type Point = readonly [number, number];

const finiteOr = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? value : fallback;

export const lensFlareGhostPosition = (
  source: Point,
  imageCenter: Point,
  index: number,
  count: number,
  spread: number,
): [number, number] => {
  const sx = finiteOr(source[0]);
  const sy = finiteOr(source[1]);
  const cx = finiteOr(imageCenter[0]);
  const cy = finiteOr(imageCenter[1]);
  const safeCount = Math.max(1, Math.round(finiteOr(count, 1)));
  const safeIndex = Math.min(safeCount - 1, Math.max(0, Math.round(finiteOr(index))));
  const axisPosition = safeCount === 1 ? 0 : ((safeIndex + 1) / (safeCount + 1)) * 2 - 1;
  const safeSpread = Math.max(0, finiteOr(spread));
  return [cx + (cx - sx) * axisPosition * safeSpread, cy + (cy - sy) * axisPosition * safeSpread];
};

const lensFlare = (input: any, options: Partial<typeof defaults> = defaults) => {
  const positionX = options.positionX ?? defaults.positionX;
  const positionY = options.positionY ?? defaults.positionY;
  const intensity = options.intensity ?? defaults.intensity;
  const bloomRadius = options.bloomRadius ?? defaults.bloomRadius;
  const flareColor = options.flareColor ?? defaults.flareColor;
  const ghosts = options.ghosts ?? defaults.ghosts;
  const ghostSpread = options.ghostSpread ?? defaults.ghostSpread;
  const streakStrength = options.streakStrength ?? defaults.streakStrength;
  const chromaticSpread = options.chromaticSpread ?? defaults.chromaticSpread;
  const palette = options.palette ?? defaults.palette;
  const W = input.width,
    H = input.height;
  const cx = W * positionX,
    cy = H * positionY;
  const rendered = renderLensFlareGL(
    input,
    W,
    H,
    cx,
    cy,
    intensity,
    [flareColor[0], flareColor[1], flareColor[2]],
    ghosts,
    bloomRadius,
    ghostSpread,
    streakStrength,
    chromaticSpread,
  );
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend(
    "Lens Flare",
    "WebGL2",
    `intensity=${intensity} ghosts=${ghosts}${identity ? "" : "+palettePass"}`,
  );
  return out ?? input;
};

export default defineFilter({
  name: "Lens Flare",
  func: lensFlare,
  optionTypes,
  options: defaults,
  defaults,
  description: "Add linear-light bloom, anamorphic streaking, and chromatic optical-axis ghosts",
  requiresGL: true,
});
