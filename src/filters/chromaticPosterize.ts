import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import { defineFilter } from "filters/types";
import {
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  paletteGetColor,
  logFilterBackend,
} from "utils";
import { applyPalettePassToCanvas, paletteIsIdentity } from "palettes/backend";
import { chromaticPosterizeGLAvailable, renderChromaticPosterizeGL } from "./chromaticPosterizeGL";

export const optionTypes = {
  levelsR: { type: RANGE, range: [2, 32], step: 1, default: 4, desc: "Quantization levels for red channel" },
  levelsG: { type: RANGE, range: [2, 32], step: 1, default: 8, desc: "Quantization levels for green channel" },
  levelsB: { type: RANGE, range: [2, 32], step: 1, default: 3, desc: "Quantization levels for blue channel" },
  palette: { type: PALETTE, default: nearest }
};

export const defaults = {
  levelsR: optionTypes.levelsR.default,
  levelsG: optionTypes.levelsG.default,
  levelsB: optionTypes.levelsB.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } }
};

type ChromaticPosterizeOptions = typeof defaults & { _webglAcceleration?: boolean };

const chromaticPosterize = (input: any, options: ChromaticPosterizeOptions = defaults) => {
  const { levelsR, levelsG, levelsB, palette } = options;
  const W = input.width, H = input.height;

  if (options._webglAcceleration !== false && chromaticPosterizeGLAvailable()) {
    const rendered = renderChromaticPosterizeGL(input, W, H, levelsR, levelsG, levelsB);
    if (rendered) {
      const identity = paletteIsIdentity(palette);
      const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
      if (out) {
        logFilterBackend("Chromatic Posterize", "WebGL2", `R=${levelsR} G=${levelsG} B=${levelsB}${identity ? "" : "+palettePass"}`);
        return out;
      }
    }
  }

  const output = cloneCanvas(input, false);
  const inputCtx = input.getContext("2d");
  const outputCtx = output.getContext("2d");
  if (!inputCtx || !outputCtx) return input;

  const buf = inputCtx.getImageData(0, 0, W, H).data;
  const outBuf = new Uint8ClampedArray(buf.length);

  // Build LUTs for each channel
  const lutR = new Uint8Array(256);
  const lutG = new Uint8Array(256);
  const lutB = new Uint8Array(256);

  const buildLut = (lut: Uint8Array, levels: number) => {
    const step = 255 / (levels - 1);
    for (let i = 0; i < 256; i++) {
      lut[i] = Math.round(Math.round(i / step) * step);
    }
  };

  buildLut(lutR, levelsR);
  buildLut(lutG, levelsG);
  buildLut(lutB, levelsB);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = getBufferIndex(x, y, W);
      const r = lutR[buf[i]];
      const g = lutG[buf[i + 1]];
      const b = lutB[buf[i + 2]];

      const color = paletteGetColor(palette, rgba(r, g, b, buf[i + 3]), palette.options, false);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], buf[i + 3]);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Chromatic Posterize",
  func: chromaticPosterize,
  optionTypes,
  options: defaults,
  defaults
});
