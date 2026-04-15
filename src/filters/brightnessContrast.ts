import { RANGE, PALETTE } from "constants/controlTypes";
import * as palettes from "palettes";
import { defineFilter, type FilterOptionValues } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  contrast as contrastFunc,
  brightness as brightnessFunc,
  gamma as gammaFunc,
  srgbBufToLinearFloat,
  linearFloatToSrgbBuf,
  srgbPaletteGetColor,
  linearPaletteGetColor,
  wasmApplyChannelLut,
  wasmIsLoaded,
  logFilterWasmStatus,
} from "utils";

export const optionTypes = {
  brightness: { type: RANGE, range: [-255, 255], step: 1, default: 0, desc: "Additive brightness offset applied to all channels" },
  contrast: { type: RANGE, range: [-40, 40], step: 0.1, default: 0, desc: "Contrast adjustment — positive increases, negative decreases" },
  exposure: { type: RANGE, range: [-4, 4], step: 0.1, default: 1, desc: "Exposure multiplier applied before contrast" },
  gamma: { type: RANGE, range: [-1.5, 7.5], step: 0.1, default: 1, desc: "Gamma correction curve (>1 darkens midtones, <1 brightens)" },
  palette: { type: PALETTE, default: palettes.nearest }
};

export const defaults = {
  brightness: optionTypes.brightness.default,
  contrast: optionTypes.contrast.default,
  exposure: optionTypes.exposure.default,
  gamma: optionTypes.gamma.default,
  palette: optionTypes.palette.default
};

type BrightnessContrastOptions = FilterOptionValues & typeof defaults & {
  _linearize?: boolean;
  _wasmAcceleration?: boolean;
};

const brightnessContrast = (
  input: any,
  options: BrightnessContrastOptions = defaults
) => {
  const { brightness, contrast, exposure, gamma, palette } = options;
  const output = cloneCanvas(input, false);

  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");

  if (!inputCtx || !outputCtx) {
    return input;
  }

  const buf = inputCtx.getImageData(0, 0, input.width, input.height).data;

  if (options._linearize) {
    const floatBuf = srgbBufToLinearFloat(buf);
    const outputBuf = new Uint8ClampedArray(buf.length);
    const outFloat = new Float32Array(floatBuf.length);

    for (let x = 0; x < input.width; x += 1) {
      for (let y = 0; y < input.height; y += 1) {
        const i = getBufferIndex(x, y, input.width);
        // brightness/contrast/gamma operate in 0-255 space, so scale up then back
        const pixel255 = rgba(
          floatBuf[i] * 255,
          floatBuf[i + 1] * 255,
          floatBuf[i + 2] * 255,
          floatBuf[i + 3] * 255
        );
        const newColor = gammaFunc(
          contrastFunc(
            brightnessFunc(pixel255, brightness, exposure),
            contrast
          ),
          gamma
        );
        // Convert result back to 0-1 for paletteGetColor
        const pixel01 = [
          newColor[0] / 255,
          newColor[1] / 255,
          newColor[2] / 255,
          newColor[3] / 255
        ];
        const col = linearPaletteGetColor(palette, pixel01, palette.options);
        fillBufferPixel(outFloat, i, col[0], col[1], col[2], col[3]);
      }
    }

    linearFloatToSrgbBuf(outFloat, outputBuf);
    outputCtx.putImageData(
      new ImageData(outputBuf, output.width, output.height),
      0,
      0
    );
  } else {
    const outputBuf = new Uint8ClampedArray(buf);
    const paletteOpts = palette?.options as { levels?: number; colors?: number[][] } | undefined;
    const paletteIsIdentity = (paletteOpts?.levels ?? 256) >= 256 && !paletteOpts?.colors;

    if (wasmIsLoaded() && options._wasmAcceleration !== false) {
      // The brightness → contrast → gamma pipeline depends only on the
      // per-channel u8 value + the four option scalars, so we precompute its
      // 256-entry LUT once and apply via the shared WASM primitive. Using a
      // Uint8ClampedArray as the scratch makes JS's bankers-round semantics
      // for u8 writes match the runtime loop exactly — bit-parity holds.
      const scratch = new Uint8ClampedArray(256);
      for (let i = 0; i < 256; i += 1) {
        const arr = gammaFunc(
          contrastFunc(
            brightnessFunc([i, i, i, 255], brightness, exposure),
            contrast,
          ),
          gamma,
        );
        scratch[i] = arr[0];
      }
      const lut = new Uint8Array(scratch);
      wasmApplyChannelLut(buf, outputBuf, lut, lut, lut);
      if (!paletteIsIdentity) {
        for (let i = 0; i < outputBuf.length; i += 4) {
          const col = srgbPaletteGetColor(palette, rgba(outputBuf[i], outputBuf[i + 1], outputBuf[i + 2], outputBuf[i + 3]), palette.options);
          fillBufferPixel(outputBuf, i, col[0], col[1], col[2], col[3]);
        }
      }
      logFilterWasmStatus("Brightness/Contrast", true, paletteIsIdentity ? "lut" : "lut+palettePass");
      outputCtx.putImageData(new ImageData(outputBuf, output.width, output.height), 0, 0);
      return output;
    }
    logFilterWasmStatus("Brightness/Contrast", false, options._wasmAcceleration === false ? "_wasmAcceleration off" : "wasm not loaded yet");

    for (let x = 0; x < input.width; x += 1) {
      for (let y = 0; y < input.height; y += 1) {
        const i = getBufferIndex(x, y, input.width);
        const newColor = gammaFunc(
          contrastFunc(
            brightnessFunc(
              rgba(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]),
              brightness,
              exposure
            ),
            contrast
          ),
          gamma
        );

        const col = srgbPaletteGetColor(palette, newColor, palette.options);
        fillBufferPixel(outputBuf, i, col[0], col[1], col[2], col[3]);
      }
    }

    outputCtx.putImageData(
      new ImageData(outputBuf, output.width, output.height),
      0,
      0
    );
  }
  return output;
};

export default defineFilter<BrightnessContrastOptions>({
  name: "Brightness/Contrast",
  func: brightnessContrast,
  optionTypes,
  options: defaults,
  defaults
});
