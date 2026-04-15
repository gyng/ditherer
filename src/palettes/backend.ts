// Palette as a backend primitive.
//
// Historically each filter called `paletteGetColor(...)` inside its per-pixel
// inner loop — a JS function callback that blocked every ported filter from
// going full-WASM (or full-GL) because the shader/WASM kernel couldn't call
// back into JS per pixel. See the reverted rgbStripe WASM port for the
// concrete cost: ~0.8–0.95x at 1280×720 vs the JS baseline because the
// split/rejoin around the palette pass ate the gains.
//
// This module exposes palette quantization as batch primitives:
//
//   - `paletteIsIdentity(palette)` — shared helper, replaces the ad-hoc
//     `(opts?.levels ?? 256) >= 256 && !opts?.colors` sprinkled across filters.
//   - `buildNearestLUT(levels)` — 256-entry per-channel LUT for `nearest`.
//   - `applyPaletteToBuffer(input, output, w, h, palette, wasmAcceleration)`
//     — one tight pass over the buffer. Uses WASM `apply_channel_lut` when
//     the palette reduces to a per-channel LUT; falls back to a JS loop
//     over `palette.getColor` for color-distance palettes (User/Adaptive).
//   - `PALETTE_NEAREST_GLSL` — a GLSL snippet GL filters inline when they
//     want to quantize in the shader instead of post-pass.
//
// The intended usage pattern: filters stop calling `paletteGetColor` in
// their per-pixel loop and instead apply the palette ONCE at the right
// point in the pipeline (usually the end, sometimes between main and
// post-passes as in rgbStripe). That keeps the hot loop shader-/WASM-pure.

import {
  fillBufferPixel,
  paletteGetColor,
  rgba,
  wasmApplyChannelLut,
  wasmIsLoaded,
} from "utils";

// Bivariant hack on getColor so we accept specialized palette definitions
// (e.g., `nearest` with `{ levels: number }`) without callers needing to
// cast. Palettes in this codebase set various narrower options shapes.
type PaletteLike = {
  name?: string;
  options?: Record<string, unknown> & { levels?: number; colors?: unknown };
  getColor?: {
    bivarianceHack(color: number[], options?: unknown): number[];
  }["bivarianceHack"];
};

// Shared identity check — a palette with levels ≥ 256 and no custom color
// table is a no-op, so callers should skip the pass entirely.
export const paletteIsIdentity = (palette: PaletteLike | undefined): boolean => {
  if (!palette) return true;
  const opts = palette.options;
  if (!opts) return true;
  const hasColors = Array.isArray(opts.colors) && (opts.colors as unknown[]).length > 0;
  const levels = typeof opts.levels === "number" ? opts.levels : 256;
  return levels >= 256 && !hasColors;
};

// Per-channel quantization LUT for the `nearest` palette — levels ∈ [1, 256].
// Matches `palettes/nearest.ts` bit-exactly: round(round(c/step)*step).
export const buildNearestLUT = (levels: number): Uint8Array => {
  const lut = new Uint8Array(256);
  if (levels >= 256) {
    for (let i = 0; i < 256; i += 1) lut[i] = i;
    return lut;
  }
  const lv = Math.max(1, Math.min(256, Math.round(levels)));
  if (lv === 1) {
    // step=Infinity in JS; Math.round(0) * Infinity = NaN → 0. Match.
    for (let i = 0; i < 256; i += 1) lut[i] = 0;
    return lut;
  }
  const step = 255 / (lv - 1);
  for (let i = 0; i < 256; i += 1) {
    lut[i] = Math.round(Math.round(i / step) * step);
  }
  return lut;
};

// Apply a palette to an RGBA u8 buffer. `input` and `output` may be the
// same buffer — each output pixel depends only on the corresponding input
// pixel, so in-place is safe. When the palette is LUT-able and WASM is
// loaded, this goes through `apply_channel_lut` (single SIMD pass over
// the buffer). Otherwise we loop in JS — same cost as the old per-filter
// callback, just no longer nested inside each filter's hot path.
export const applyPaletteToBuffer = (
  input: Uint8ClampedArray | Uint8Array,
  output: Uint8ClampedArray | Uint8Array,
  _width: number,
  _height: number,
  palette: PaletteLike | undefined,
  wasmAcceleration = true,
): void => {
  if (!palette || paletteIsIdentity(palette)) {
    if (input !== output) (output as Uint8ClampedArray).set(input);
    return;
  }

  const opts = palette.options ?? {};
  const hasColors = Array.isArray(opts.colors) && (opts.colors as unknown[]).length > 0;
  const isNearest = palette.name === "nearest" && !hasColors;

  if (isNearest && wasmAcceleration && wasmIsLoaded()) {
    const levels = typeof opts.levels === "number" ? opts.levels : 256;
    const lut = buildNearestLUT(levels);
    wasmApplyChannelLut(input, output, lut, lut, lut);
    return;
  }

  // JS fallback: color-distance palettes (User/Adaptive) and anything else.
  // Callers that hit this path don't pay *more* than they did with the old
  // per-pixel callback, they just pay it once outside their main loop.
  if (!palette.getColor) {
    if (input !== output) (output as Uint8ClampedArray).set(input);
    return;
  }
  const pOpts = palette.options as Record<string, unknown>;
  for (let i = 0; i < input.length; i += 4) {
    const col = paletteGetColor(
      palette as Parameters<typeof paletteGetColor>[0],
      rgba(input[i], input[i + 1], input[i + 2], input[i + 3]),
      pOpts,
      false,
    );
    fillBufferPixel(output, i, col[0], col[1], col[2], input[i + 3]);
  }
};

// GLSL snippet: call `applyNearestLevels(v, levels)` per channel in a
// fragment shader to apply the `nearest` palette quantization. Matches JS
// semantics for levels ∈ [1, 255]; 256 is the identity and callers should
// skip the call entirely when `u_paletteLevels >= 256`.
export const PALETTE_NEAREST_GLSL = `
float applyNearestLevels(float v, int levels) {
  if (levels >= 2 && levels < 256) {
    float step_v = 255.0 / float(levels - 1);
    return floor(floor(v / step_v + 0.5) * step_v + 0.5);
  }
  return v;
}
vec3 applyNearestLevelsRGB(vec3 c, int levels) {
  return vec3(
    applyNearestLevels(c.r, levels),
    applyNearestLevels(c.g, levels),
    applyNearestLevels(c.b, levels)
  );
}
`;
