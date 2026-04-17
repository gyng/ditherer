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

const sat01 = (v: number) => Math.max(0, Math.min(1, v));
const hash = (x: number, y: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};
const vnoise = (x: number, y: number) => {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
};
const fbm = (x: number, y: number) => {
  let v = 0, a = 0.5;
  for (let i = 0; i < 5; i++) { v += a * vnoise(x, y); x *= 2; y *= 2; a *= 0.5; }
  return v;
};

const texValue = (type: string, px: number, py: number) => {
  switch (type) {
    case "PAPER":
      return 0.5 + (vnoise(px * 12, py * 12) - 0.5) * 0.15 + (fbm(px * 2, py * 2) - 0.5) * 0.12;
    case "CANVAS": {
      const weave = (Math.abs(Math.sin(px * 6.28318 * 16)) - 0.5 + Math.abs(Math.sin(py * 6.28318 * 16)) - 0.5) * 0.08;
      return 0.5 + weave + (fbm(px * 8, py * 8) - 0.5) * 0.12;
    }
    case "LINEN": {
      const weave = Math.sin(px * 6.28318 * 8) * Math.sin(py * 6.28318 * 10) * 0.1;
      return 0.5 + weave + (fbm(px * 6, py * 6) - 0.5) * 0.18;
    }
    case "CARDBOARD": {
      const corrug = Math.sin(py * 6.28318 * 24) * 0.08;
      const big = (fbm(px * 0.5, py * 3) - 0.5) * 0.25;
      return 0.5 + corrug + big;
    }
    case "PARCHMENT": {
      const clouds = (fbm(px * 1.5, py * 1.5) - 0.5) * 0.35;
      const blotchRaw = fbm(px * 0.8, py * 0.8);
      const blotchT = Math.max(0, Math.min(1, (blotchRaw - 0.65) / (0.9 - 0.65)));
      const blotch = blotchT * blotchT * (3 - 2 * blotchT) * -0.2;
      return 0.5 + clouds + blotch + (vnoise(px * 20, py * 20) - 0.5) * 0.05;
    }
    default:
      return 0.5;
  }
};

const softLight = (base: number, blend: number) =>
  (1 - 2 * blend) * base * base + 2 * blend * base;

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
