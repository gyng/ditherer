import { PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  srgbBufToLinearFloat,
  linearFloatToSrgbBuf,
  srgbPaletteGetColor,
  linearPaletteGetColor,
  wasmQuantizeBuffer,
  wasmApplyChannelLut,
  wasmIsLoaded,
  resolvePaletteColorAlgorithm,
  logFilterWasmStatus,
} from "utils";
import { defineFilter, type FilterOptionValues } from "filters/types";

// For the nearest-levels palette, each output channel is `round(round(x/step)*step)`
// — depends only on the input byte, so we can collapse it into a 256-entry LUT
// and apply with the generic WASM LUT primitive.
const buildLevelsLut = (levels: number): Uint8Array => {
  const lut = new Uint8Array(256);
  if (levels >= 256) {
    for (let i = 0; i < 256; i += 1) lut[i] = i;
    return lut;
  }
  const step = 255 / (levels - 1);
  for (let i = 0; i < 256; i += 1) {
    const v = Math.round(Math.round(i / step) * step);
    lut[i] = Math.max(0, Math.min(255, v));
  }
  return lut;
};

export const optionTypes = {
  palette: { type: PALETTE, default: nearest }
};

const defaults = {
  palette: { ...optionTypes.palette.default, options: { levels: 7 } }
};

type QuantizePaletteOptions = {
  levels?: number;
  colorDistanceAlgorithm?: string;
  colors?: number[][];
};

type QuantizeOptions = FilterOptionValues & typeof defaults & {
  _wasmAcceleration?: boolean;
  _linearize?: boolean;
  palette?: typeof defaults.palette & {
    options?: QuantizePaletteOptions;
  };
};

const quantize = (
  input: any,
  options: QuantizeOptions = defaults
) => {
  const { palette } = options;
  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;
  const algo = resolvePaletteColorAlgorithm(palette);
  const paletteOpts = palette.options as { colors?: number[][]; levels?: number } | undefined;
  const colors = paletteOpts?.colors;

  // WASM buffer quantize — single call replaces entire pixel loop.
  let wasmReason = "";
  if (!options._wasmAcceleration) wasmReason = "_wasmAcceleration off";
  else if (!wasmIsLoaded()) wasmReason = "wasm not loaded yet";
  // Linearize is fine for levels — the linear→sRGB→snap→linear→sRGB
  // pipeline reduces to a pure u8-domain levels snap (input and output are
  // both sRGB u8; our LUT-based roundtrips are identity at u8 precision). For
  // user palette + linearize, the linear-space distance still matters, so
  // fall through to the JS loop there.
  else if (options._linearize && colors) wasmReason = "linearize on (user palette)";

  if (!wasmReason) {
    // User palette (has colors + algorithm) → full quantize dispatcher.
    if (colors && algo) {
      const result = wasmQuantizeBuffer(buf, colors, algo);
      if (result && result.length === buf.length) {
        buf.set(result);
        logFilterWasmStatus("Quantize", true, `algo=${algo}`);
        outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
        return output;
      }
      wasmReason = "wasm returned null";
    } else if (typeof paletteOpts?.levels === "number") {
      // Nearest / levels palette: round-round-snap per channel fits a 256 LUT.
      const lut = buildLevelsLut(paletteOpts.levels);
      wasmApplyChannelLut(buf, buf, lut, lut, lut);
      logFilterWasmStatus("Quantize", true, `levels=${paletteOpts.levels}${options._linearize ? " (linear)" : ""}`);
      outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
      return output;
    } else {
      wasmReason = "palette unsupported";
    }
  }
  logFilterWasmStatus("Quantize", false, wasmReason);

  if (options._linearize) {
    const floatBuf = srgbBufToLinearFloat(buf);
    for (let x = 0; x < input.width; x += 1) {
      for (let y = 0; y < input.height; y += 1) {
        const i = getBufferIndex(x, y, input.width);
        const pixel = [floatBuf[i], floatBuf[i + 1], floatBuf[i + 2], floatBuf[i + 3]];
        const color = linearPaletteGetColor(palette, pixel, palette.options);
        fillBufferPixel(floatBuf, i, color[0], color[1], color[2], floatBuf[i + 3]);
      }
    }
    linearFloatToSrgbBuf(floatBuf, buf);
  } else {
    for (let x = 0; x < input.width; x += 1) {
      for (let y = 0; y < input.height; y += 1) {
        const i = getBufferIndex(x, y, input.width);
        const pixel = rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
        const color = srgbPaletteGetColor(palette, pixel, palette.options);
        fillBufferPixel(buf, i, color[0], color[1], color[2], buf[i + 3]);
      }
    }
  }

  outputCtx.putImageData(new ImageData(buf, output.width, output.height), 0, 0);
  return output;
};

export default defineFilter<QuantizeOptions>({
  name: "Quantize",
  func: quantize,
  options: defaults,
  optionTypes,
  defaults
});
