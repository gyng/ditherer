import { BOOL, PALETTE, RANGE } from "../constants/controlTypes";
import { nearest } from "../palettes/index";
import { logFilterBackend } from "../utils/index";
import { defineFilter } from "./types";
import { applyPalettePassToCanvas } from "../palettes/backend";
import { renderTriangleDitherGL } from "./triangleDitherGL";

export const optionTypes = {
  seed: {
    type: RANGE,
    range: [0, 999],
    step: 1,
    default: 42,
    desc: "Noise pattern. The same seed always produces the same grain.",
  },
  animateNoise: {
    type: BOOL,
    default: true,
    desc: "Re-roll the grain each frame so video shimmers. Off holds one static pattern.",
  },
  palette: {
    type: PALETTE,
    default: nearest,
    desc: "Palette and quantization applied to the triangular noise threshold",
  },
};

export const defaults = {
  seed: optionTypes.seed.default,
  animateNoise: optionTypes.animateNoise.default,
  palette: optionTypes.palette.default,
};

const hash32 = (value: number) => {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
};

// Shader adds TPDF noise, then quantises to LEVELS when the palette is
// LEVELS-only. Custom-colour palettes skip shader quantise (pass
// levels=256) and run the standard post-readout palette pass to do the
// colour-distance snap on CPU.
const triangleDither = (input: any, options: typeof defaults = defaults) => {
  const { palette } = options;
  const W = input.width,
    H = input.height;
  const paletteOpts = palette?.options as { levels?: number; colors?: number[][] } | undefined;
  // Was Math.random() per render, which meant the same still image came out
  // different every time it was drawn — not reproducible from a saved chain, and
  // impossible to test. Derive the seed instead: still shimmers frame to frame
  // when animating, but the same (seed, frame) always gives the same grain.
  const opts = options as typeof defaults & { _frameIndex?: number };
  const frame =
    opts.animateNoise !== false && typeof opts._frameIndex === "number" ? opts._frameIndex : 0;
  const seed = hash32((opts.seed ?? defaults.seed) + frame * 0x9e3779b1) || 1;
  const hasCustomColors =
    Array.isArray(paletteOpts?.colors) && (paletteOpts!.colors as unknown[]).length > 0;
  const levelsForShader = hasCustomColors ? 256 : (paletteOpts?.levels ?? 256);
  const rendered = renderTriangleDitherGL(input, W, H, seed, levelsForShader);
  if (!rendered) return input;
  const out = hasCustomColors ? applyPalettePassToCanvas(rendered, W, H, palette) : rendered;
  logFilterBackend(
    "Triangle dither",
    "WebGL2",
    hasCustomColors ? "noise+palettePass" : `levels=${levelsForShader}`,
  );
  return out ?? input;
};

export default defineFilter({
  name: "Triangle dither",
  func: triangleDither,
  options: defaults,
  optionTypes,
  defaults,
  temporal: true,
  requiresGL: true,
});
