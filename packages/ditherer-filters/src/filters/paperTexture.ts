import { RANGE, ENUM, PALETTE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { logFilterBackend } from "../utils/index";
import { defineFilter } from "./types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "../palettes/backend";
import { renderPaperTextureGL, PAPER_TEXTURE, PAPER_BLEND } from "./paperTextureGL";
import { substratePatternFrequency } from "./substrateCopyQualityContracts";

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
    desc: "Texture style — paper fibres, woven canvas or linen, kraft cardboard liner, or aged parchment" },
  blendMode: {
    type: ENUM,
    options: BLEND_KEYS.map(k => ({ name: BLEND_NAMES[k], value: k })),
    default: "OVERLAY" as typeof BLEND_KEYS[number],
    desc: "How the texture composites over the image" },
  scale: { type: RANGE, range: [1, 40], step: 0.5, default: 12, desc: "Texture density — higher is finer, capped per resolution to prevent moiré" },
  strength: { type: RANGE, range: [0, 1], step: 0.05, default: 0.6, desc: "Texture opacity — 0 = invisible, 1 = fully applied" },
  contrast: { type: RANGE, range: [0.5, 3], step: 0.1, default: 1.2, desc: "Amplify texture variance — makes fibres/grain more pronounced" },
  palette: { type: PALETTE, default: nearest, desc: "Optional palette applied after the material texture" } };

export const defaults = {
  type: optionTypes.type.default,
  blendMode: optionTypes.blendMode.default,
  scale: optionTypes.scale.default,
  strength: optionTypes.strength.default,
  contrast: optionTypes.contrast.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } } };


const paperTexture = (input: any, options: Partial<typeof defaults> = defaults) => {
  const { type, blendMode, scale, strength, contrast, palette } = { ...defaults, ...options };
  const W = input.width, H = input.height;
  const typeId = PAPER_TEXTURE[type as keyof typeof PAPER_TEXTURE] ?? 0;
  const blendId = PAPER_BLEND[blendMode as keyof typeof PAPER_BLEND] ?? 1;
  const repeatDensity = [12, 4, 3.5, 10, 12][typeId] ?? 12;
  const effectiveScale = substratePatternFrequency(scale, Math.min(W, H), repeatDensity) / repeatDensity;

  const rendered = renderPaperTextureGL(input, W, H, typeId, blendId, effectiveScale, strength, contrast);
  if (!rendered) return input;
  const identity = paletteIsIdentity(palette);
  const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
  logFilterBackend("Paper Texture", "WebGL2", `${type}/${blendMode} scale=${effectiveScale.toFixed(2)}${identity ? "" : "+palettePass"}`);
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
