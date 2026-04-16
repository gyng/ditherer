import { RANGE, ENUM, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { cloneCanvas, getBufferIndex, logFilterBackend, logFilterWasmStatus } from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { paperTextureGLAvailable, renderPaperTextureGL, PAPER_TEXTURE, PAPER_BLEND } from "./paperTextureGL";

const TYPE_KEYS = ["PAPER", "CANVAS", "LINEN", "CARDBOARD", "PARCHMENT"] as const;
const TYPE_NAMES = {
  PAPER: "Paper",
  CANVAS: "Canvas",
  LINEN: "Linen",
  CARDBOARD: "Cardboard",
  PARCHMENT: "Parchment",
} as const;

const BLEND_KEYS = ["MULTIPLY", "OVERLAY", "SOFT_LIGHT"] as const;
const BLEND_NAMES = {
  MULTIPLY: "Multiply",
  OVERLAY: "Overlay",
  SOFT_LIGHT: "Soft Light",
} as const;

export const optionTypes = {
  type: {
    type: ENUM,
    options: TYPE_KEYS.map(k => ({ name: TYPE_NAMES[k], value: k })),
    default: "PAPER" as typeof TYPE_KEYS[number],
    desc: "Texture style — paper fibres, woven canvas/linen, corrugated cardboard, aged parchment",
  },
  blendMode: {
    type: ENUM,
    options: BLEND_KEYS.map(k => ({ name: BLEND_NAMES[k], value: k })),
    default: "OVERLAY" as typeof BLEND_KEYS[number],
    desc: "How the texture composites over the image",
  },
  scale: { type: RANGE, range: [1, 40], step: 0.5, default: 12, desc: "Texture tile size — higher = finer weave/fibre detail" },
  strength: { type: RANGE, range: [0, 1], step: 0.05, default: 0.6, desc: "Texture opacity — 0 = invisible, 1 = fully applied" },
  contrast: { type: RANGE, range: [0.5, 3], step: 0.1, default: 1.2, desc: "Amplify texture variance — makes fibres/grain more pronounced" },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  type: optionTypes.type.default,
  blendMode: optionTypes.blendMode.default,
  scale: optionTypes.scale.default,
  strength: optionTypes.strength.default,
  contrast: optionTypes.contrast.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

type PaperTextureOptions = typeof defaults & { _webglAcceleration?: boolean };

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

const paperTexture = (input: any, options: PaperTextureOptions = defaults) => {
  const { type, blendMode, scale, strength, contrast, palette } = options;
  const W = input.width, H = input.height;
  const typeId = PAPER_TEXTURE[type as keyof typeof PAPER_TEXTURE] ?? 0;
  const blendId = PAPER_BLEND[blendMode as keyof typeof PAPER_BLEND] ?? 1;

  if (options._webglAcceleration !== false && paperTextureGLAvailable()) {
    const rendered = renderPaperTextureGL(input, W, H, typeId, blendId, scale, strength, contrast);
    if (rendered) {
      const identity = paletteIsIdentity(palette);
      const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
      if (out) {
        logFilterBackend("Paper Texture", "WebGL2", `${type}/${blendMode} scale=${scale}${identity ? "" : "+palettePass"}`);
        return out;
      }
    }
  }

  logFilterWasmStatus("Paper Texture", false, "fallback JS");
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);
  const aspect = W / H;

  for (let y = 0; y < H; y++) {
    const vy = (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const vx = (x + 0.5) / W;
      const px = vx * scale * aspect;
      const py = vy * scale;
      let t = texValue(type, px, py);
      t = (t - 0.5) * contrast + 0.5;
      t = 0.5 + (t - 0.5) * strength;
      t = sat01(t);

      const i = getBufferIndex(x, y, W);
      const sr = buf[i] / 255, sg = buf[i + 1] / 255, sb = buf[i + 2] / 255;
      let or: number, og: number, ob: number;
      if (blendId === 0) {
        or = sr * 2 * t; og = sg * 2 * t; ob = sb * 2 * t;
      } else if (blendId === 1) {
        or = t < 0.5 ? 2 * sr * t : 1 - 2 * (1 - sr) * (1 - t);
        og = t < 0.5 ? 2 * sg * t : 1 - 2 * (1 - sg) * (1 - t);
        ob = t < 0.5 ? 2 * sb * t : 1 - 2 * (1 - sb) * (1 - t);
      } else {
        or = softLight(sr, t); og = softLight(sg, t); ob = softLight(sb, t);
      }
      outBuf[i] = Math.round(sat01(or) * 255);
      outBuf[i + 1] = Math.round(sat01(og) * 255);
      outBuf[i + 2] = Math.round(sat01(ob) * 255);
      outBuf[i + 3] = buf[i + 3];
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  const identity = paletteIsIdentity(palette);
  return identity ? output : (applyPalettePassToCanvas(output, W, H, palette) ?? output);
};

export default defineFilter({
  name: "Paper Texture",
  func: paperTexture,
  optionTypes,
  options: defaults,
  defaults,
  description: "Procedural paper, canvas, linen, cardboard, or parchment texture overlay — gives digital images material substrate",
});
