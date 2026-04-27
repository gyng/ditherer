import { PALETTE, RANGE } from "constants/controlTypes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import { nearest } from "palettes";
import {
  cloneCanvas,
  colorAlgorithmToWasmMode,
  logFilterBackend,
  logFilterWasmStatus,
  resolvePaletteColorAlgorithm,
  WASM_PALETTE_MODE,
  wasmIsLoaded,
  wasmRiemersmaDither,
} from "utils";

export const optionTypes = {
  memoryLength: {
    type: RANGE,
    range: [4, 96],
    step: 1,
    default: 32,
    desc: "Number of recent quantization errors carried along the Hilbert curve",
  },
  falloffRatio: {
    type: RANGE,
    range: [0.01, 0.5],
    step: 0.01,
    default: 0.125,
    desc: "Oldest error weight relative to the newest error",
  },
  errorStrength: {
    type: RANGE,
    range: [0, 2],
    step: 0.05,
    default: 1,
    desc: "How strongly recent errors influence the next pixel",
  },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  memoryLength: optionTypes.memoryLength.default,
  falloffRatio: optionTypes.falloffRatio.default,
  errorStrength: optionTypes.errorStrength.default,
  palette: { ...optionTypes.palette.default, options: { levels: 2 } },
};

type RiemersmaOptions = FilterOptionValues & typeof defaults & {
  _linearize?: boolean;
  _wasmAcceleration?: boolean;
};

const riemersma = (
  input: HTMLCanvasElement | OffscreenCanvas,
  options: RiemersmaOptions = defaults,
) => {
  const palette = options.palette ?? defaults.palette;
  const paletteOptions = palette.options as { levels?: number; colors?: number[][]; colorDistanceAlgorithm?: string } | undefined;
  const paletteColors = paletteOptions?.colors;
  const paletteAlgorithm = resolvePaletteColorAlgorithm(palette) ?? undefined;
  const paletteMode = paletteColors
    ? colorAlgorithmToWasmMode(paletteAlgorithm)
    : WASM_PALETTE_MODE.LEVELS;

  if (options._wasmAcceleration !== false && wasmIsLoaded() && paletteMode !== null) {
    const output = cloneCanvas(input, false);
    const inputCtx = input.getContext("2d");
    const outputCtx = output.getContext("2d");
    if (!inputCtx || !outputCtx) return input;

    const width = input.width;
    const height = input.height;
    const image = inputCtx.getImageData(0, 0, width, height);
    const buf = image.data;
    const out = new Uint8ClampedArray(buf.length);
    const memoryLength = Math.max(1, Math.round(options.memoryLength ?? defaults.memoryLength));
    const errorStrength = options.errorStrength ?? defaults.errorStrength;
    const falloffRatio = options.falloffRatio ?? defaults.falloffRatio;
    const linearize = options._linearize === true;
    wasmRiemersmaDither(
      buf,
      out,
      width,
      height,
      memoryLength,
      falloffRatio,
      errorStrength,
      linearize,
      paletteMode,
      paletteOptions?.levels ?? 2,
      paletteColors ?? null,
    );
    outputCtx.putImageData(new ImageData(out, width, height), 0, 0);
    logFilterBackend("Riemersma", "WASM", `hilbert memory=${memoryLength} falloff=${falloffRatio}${linearize ? " linear" : ""}`);
    return output;
  }

  logFilterWasmStatus(
    "Riemersma",
    false,
    options._wasmAcceleration === false
      ? "_wasmAcceleration off"
      : paletteMode === null
        ? "unsupported palette algorithm"
        : "WASM not loaded",
  );
  return input;
};

export default defineFilter<RiemersmaOptions>({
  name: "Riemersma",
  func: riemersma,
  optionTypes,
  options: defaults,
  defaults,
  description: "Hilbert-curve error diffusion with rolling exponential error memory",
  noGL: "Riemersma diffusion depends on prior pixels along a Hilbert traversal; fragment shaders cannot express that serial state.",
});
