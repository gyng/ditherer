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
  resolvePaletteColorAlgorithm,
  colorAlgorithmToWasmMode,
  WASM_PALETTE_MODE,
  logFilterBackend,
} from "utils";
import { defineFilter } from "filters/types";
import { triangleDitherGLAvailable, renderTriangleDitherGL } from "./triangleDitherGL";

export const optionTypes = {
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  palette: optionTypes.palette.default
};

// Triangular probability density function noise in [-1, 1]
// Better spectral properties than uniform noise: blue-ish noise distribution
const tpdf = () => Math.random() - Math.random();

const triangleDither = (input: any, options: typeof defaults & { _wasmAcceleration?: boolean; _webglAcceleration?: boolean } = defaults) => {
  const { palette } = options;
  const W = input.width;
  const H = input.height;
  const paletteOpts = palette?.options as { levels?: number; colors?: number[][] } | undefined;

  // GL path only supports LEVELS palette (including identity levels=256).
  // Custom-colour palettes require WASM/JS colour-distance quantisation.
  const canGL = !paletteOpts?.colors;
  if (options._webglAcceleration !== false && canGL && triangleDitherGLAvailable()) {
    const seed = (Math.random() * 0xffffffff) >>> 0 || 1;
    const levels = paletteOpts?.levels ?? 256;
    const rendered = renderTriangleDitherGL(input, W, H, seed, levels);
    if (rendered) {
      logFilterBackend("Triangle dither", "WebGL2", `levels=${levels}`);
      return rendered;
    }
  }

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;

  // WASM fast path: LEVELS (default nearest palette) or a user palette with a
  // supported colour-distance algorithm. Seed the Rust PRNG with a fresh u32
  // each call so run-to-run variation matches the JS Math.random() behaviour.
  if (wasmIsLoaded() && options._wasmAcceleration !== false) {
    let mode: number | null = null;
    let palColors: number[][] | null = null;
    let levelsArg = 0;
    let reason = "palette unsupported";
    if (paletteOpts?.colors) {
      const algo = resolvePaletteColorAlgorithm(palette);
      const m = algo ? colorAlgorithmToWasmMode(algo) : null;
      if (m !== null) {
        mode = m;
        palColors = paletteOpts.colors;
      } else {
        reason = `palette algo=${algo ?? "none"}`;
      }
    } else if (typeof paletteOpts?.levels === "number") {
      mode = WASM_PALETTE_MODE.LEVELS;
      levelsArg = paletteOpts.levels;
    }

    if (mode !== null) {
      const seed = (Math.random() * 0xffffffff) >>> 0 || 1;
      wasmTriangleDitherBuffer(buf, buf, levelsArg, seed, mode, palColors);
      logFilterWasmStatus(
        "Triangle dither",
        true,
        mode === WASM_PALETTE_MODE.LEVELS ? `levels=${levelsArg}` : `mode=${mode}`,
      );
      outputCtx.putImageData(new ImageData(buf, W, H), 0, 0);
      return output;
    }
    logFilterWasmStatus("Triangle dither", false, reason);
  } else {
    logFilterWasmStatus(
      "Triangle dither",
      false,
      options._wasmAcceleration === false ? "_wasmAcceleration off" : "wasm not loaded yet",
    );
  }

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
