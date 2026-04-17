import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { logFilterBackend } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { renderPaperTextureGL, PAPER_TEXTURE, PAPER_BLEND } from "./paperTextureGL";

const TYPE_KEYS = ["PAPER", "CANVAS", "LINEN", "CARDBOARD", "PARCHMENT"] as const;
const TYPE_NAMES = {
  PAPER: "Paper",
  CANVAS: "Canvas",
  LINEN: "Linen",
  CARDBOARD: "Cardboard",
  PARCHMENT: "Parchment" } as const;

const BLEND_KEYS = ["MULTIPLY", "OVERLAY", "SOFT_LIGHT"] as const;
const BLEND_NAMES = {
  MULTIPLY: "Multiply",
  OVERLAY: "Overlay",
  SOFT_LIGHT: "Soft Light" } as const;

export const optionTypes = {
  type: {
    type: ENUM,
    options: TYPE_KEYS.map(k => ({ name: TYPE_NAMES[k], value: k })),
    default: "PAPER" as typeof TYPE_KEYS[number],
    desc: "Texture style — paper fibres, woven canvas/linen, corrugated cardboard, aged parchment" },
  blendMode: {
    type: ENUM,
    options: BLEND_KEYS.map(k => ({ name: BLEND_NAMES[k], value: k })),
    default: "OVERLAY" as typeof BLEND_KEYS[number],
    desc: "How the texture composites over the image" },
  scale: { type: RANGE, range: [1, 40], step: 0.5, default: 12, desc: "Texture tile size — higher = finer weave/fibre detail" },
  strength: { type: RANGE, range: [0, 1], step: 0.05, default: 0.6, desc: "Texture opacity — 0 = invisible, 1 = fully applied" },
  contrast: { type: RANGE, range: [0.5, 3], step: 0.1, default: 1.2, desc: "Amplify texture variance — makes fibres/grain more pronounced" },
  palette: { type: PALETTE, default: nearest } };

export const defaults = {
  type: optionTypes.type.default,
  blendMode: optionTypes.blendMode.default,
  scale: optionTypes.scale.default,
  strength: optionTypes.strength.default,
  contrast: optionTypes.contrast.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } } };


const paperTexture = (input: any, options: typeof defaults = defaults) => {
  const { type, blendMode, scale, strength, contrast, palette } = options;
  const W = input.width, H = input.height;
  const typeId = PAPER_TEXTURE[type as keyof typeof PAPER_TEXTURE] ?? 0;
  const blendId = PAPER_BLEND[blendMode as keyof typeof PAPER_BLEND] ?? 1;

  const rendered = renderPaperTextureGL(input, W, H, typeId, blendId, scale, strength, contrast);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Paper Texture", "WebGL2", `${type}/${blendMode} scale=${scale}${identity ? "" : "+palettePass"}`);
  return out ?? input;
};

export default defineFilter({
  name: "Paper Texture",
  func: paperTexture,
  optionTypes,
  options: defaults,
  defaults,
  description: "Procedural paper, canvas, linen, cardboard, or parchment texture overlay — gives digital images material substrate",
  requiresGL: true });
