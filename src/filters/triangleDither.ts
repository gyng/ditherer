import { PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  srgbPaletteGetColor,
  wasmTriangleDitherBuffer,
  wasmIsLoaded,
  logFilterWasmStatus,
} from "utils";
import { defineFilter } from "filters/types";

export const optionTypes = {
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  palette: optionTypes.palette.default
};

// Triangular probability density function noise in [-1, 1]
// Better spectral properties than uniform noise: blue-ish noise distribution
const tpdf = () => Math.random() - Math.random();

const triangleDither = (input: any, options: typeof defaults & { _wasmAcceleration?: boolean } = defaults) => {
  const { palette } = options;
  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const W = input.width;
  const H = input.height;
  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const paletteOpts = palette?.options as { levels?: number; colors?: number[][] } | undefined;

  // WASM fast path — only for the nearest/levels palette (default). User
  // palette still falls through to JS since we'd need per-pixel palette
  // match after noise. Seed the Rust PRNG with a fresh u32 each call so
  // run-to-run variation matches the JS Math.random() behaviour.
  if (
    wasmIsLoaded() &&
    options._wasmAcceleration !== false &&
    !paletteOpts?.colors &&
    typeof paletteOpts?.levels === "number"
  ) {
    const seed = (Math.random() * 0xffffffff) >>> 0 || 1;
    wasmTriangleDitherBuffer(buf, buf, paletteOpts.levels, seed);
    logFilterWasmStatus("Triangle dither", true, `levels=${paletteOpts.levels}`);
    outputCtx.putImageData(new ImageData(buf, W, H), 0, 0);
    return output;
  }
  logFilterWasmStatus("Triangle dither", false,
    options._wasmAcceleration === false ? "_wasmAcceleration off"
      : !wasmIsLoaded() ? "wasm not loaded yet"
      : paletteOpts?.colors ? "user palette"
      : "palette unsupported");

  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) {
      const i = getBufferIndex(x, y, W);
      // Add triangular noise before palette quantization
      const noiseScale = 255;
      const r = buf[i]     + tpdf() * noiseScale * 0.5;
      const g = buf[i + 1] + tpdf() * noiseScale * 0.5;
      const b = buf[i + 2] + tpdf() * noiseScale * 0.5;
      const col = srgbPaletteGetColor(
        palette,
        rgba(r, g, b, buf[i + 3]),
        palette.options
      );
      fillBufferPixel(buf, i, col[0], col[1], col[2], col[3]);
    }
  }

  outputCtx.putImageData(new ImageData(buf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Triangle dither",
  func: triangleDither,
  options: defaults,
  optionTypes,
  defaults
});
