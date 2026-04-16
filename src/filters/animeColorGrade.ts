import { RANGE, PALETTE } from "constants/controlTypes";
import { nearest } from "palettes";
import {
  clamp,
  cloneCanvas,
  fillBufferPixel,
  getBufferIndex,
  rgba,
  srgbPaletteGetColor,
  wasmAnimeColorGradeBuffer,
  wasmIsLoaded,
  logFilterWasmStatus,
  logFilterBackend,
} from "utils";
import { defineFilter } from "filters/types";
import { applyPalettePassToCanvas, paletteIsIdentity as paletteIsIdentityFn } from "palettes/backend";
import { animeColorGradeGLAvailable, renderAnimeColorGradeGL } from "./animeColorGradeGL";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp(0, 1, (value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const luminance01 = (r: number, g: number, b: number) =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

const applyTone = (
  value: number,
  blackPoint: number,
  whitePoint: number,
  contrast: number,
  midtoneLift: number,
) => {
  let normalized = clamp(0, 1, (value - blackPoint) / Math.max(1, whitePoint - blackPoint));
  if (contrast !== 0) {
    normalized = clamp(0, 1, 0.5 + (normalized - 0.5) * (1 + contrast));
  }
  const gamma = clamp(0.25, 3, 1 - midtoneLift);
  normalized = Math.pow(normalized, gamma);
  return clamp(0, 255, Math.round(normalized * 255));
};

const applyVibrance = (r: number, g: number, b: number, vibrance: number) => {
  if (vibrance <= 0) return [r, g, b] as const;

  const average = (r + g + b) / 3;
  const maxChannel = Math.max(r, g, b);
  const minChannel = Math.min(r, g, b);
  const saturation = (maxChannel - minChannel) / 255;
  const boost = 1 + vibrance * (1 - saturation);

  return [
    clamp(0, 255, Math.round(average + (r - average) * boost)),
    clamp(0, 255, Math.round(average + (g - average) * boost)),
    clamp(0, 255, Math.round(average + (b - average) * boost)),
  ] as const;
};

export const optionTypes = {
  shadowCool: { type: RANGE, range: [0, 1], step: 0.05, default: 0.55, desc: "Push shadows toward blue/cyan, like anime background grading" },
  highlightWarm: { type: RANGE, range: [0, 1], step: 0.05, default: 0.4, desc: "Warm bright areas toward yellow/red highlights" },
  blackPoint: { type: RANGE, range: [0, 128], step: 1, default: 0, desc: "Optional shadow input clip, like Levels black point" },
  whitePoint: { type: RANGE, range: [128, 255], step: 1, default: 255, desc: "Optional highlight input clip, like Levels white point" },
  contrast: { type: RANGE, range: [-0.5, 0.5], step: 0.05, default: 0.1, desc: "Global contrast shaping before the anime grade" },
  midtoneLift: { type: RANGE, range: [-0.5, 0.5], step: 0.05, default: 0.05, desc: "Lift or darken midtones before color grading" },
  vibrance: { type: RANGE, range: [0, 1.5], step: 0.05, default: 0.55, desc: "Boost muted colors more than already-saturated ones" },
  mix: { type: RANGE, range: [0, 1], step: 0.05, default: 1, desc: "Opacity of the anime-style color grade over the base image" },
  palette: { type: PALETTE, default: nearest },
};

export const defaults = {
  shadowCool: optionTypes.shadowCool.default,
  highlightWarm: optionTypes.highlightWarm.default,
  blackPoint: optionTypes.blackPoint.default,
  whitePoint: optionTypes.whitePoint.default,
  contrast: optionTypes.contrast.default,
  midtoneLift: optionTypes.midtoneLift.default,
  vibrance: optionTypes.vibrance.default,
  mix: optionTypes.mix.default,
  palette: { ...optionTypes.palette.default, options: { levels: 256 } },
};

const animeColorGrade = (input: any, options: typeof defaults & { _wasmAcceleration?: boolean; _webglAcceleration?: boolean } = defaults) => {
  const {
    shadowCool,
    highlightWarm,
    blackPoint,
    whitePoint,
    contrast,
    midtoneLift,
    vibrance,
    mix,
    palette,
  } = options;

  const W = input.width;
  const H = input.height;

  if (options._webglAcceleration !== false && animeColorGradeGLAvailable()) {
    const rendered = renderAnimeColorGradeGL(
      input, W, H,
      shadowCool, highlightWarm, blackPoint, whitePoint,
      contrast, midtoneLift, vibrance, mix,
    );
    if (rendered) {
      const identity = paletteIsIdentityFn(palette);
      const out = identity ? rendered : applyPalettePassToCanvas(rendered, W, H, palette);
      if (out) {
        logFilterBackend("Anime Color Grade", "WebGL2", identity ? "grade" : "grade+palettePass");
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
  const paletteOpts = palette?.options as { levels?: number; colors?: number[][] } | undefined;
  const paletteIsIdentity = (paletteOpts?.levels ?? 256) >= 256 && !paletteOpts?.colors;

  if (wasmIsLoaded() && options._wasmAcceleration !== false) {
    wasmAnimeColorGradeBuffer(
      buf, outBuf,
      shadowCool, highlightWarm, blackPoint, whitePoint,
      contrast, midtoneLift, vibrance, mix,
    );
    if (!paletteIsIdentity) {
      for (let i = 0; i < outBuf.length; i += 4) {
        const color = srgbPaletteGetColor(palette, rgba(outBuf[i], outBuf[i + 1], outBuf[i + 2], outBuf[i + 3]), palette.options);
        fillBufferPixel(outBuf, i, color[0], color[1], color[2], outBuf[i + 3]);
      }
    }
    logFilterWasmStatus("Anime Color Grade", true, paletteIsIdentity ? "grade" : "grade+palettePass");
    outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
    return output;
  }

  logFilterWasmStatus("Anime Color Grade", false, options._wasmAcceleration === false ? "_wasmAcceleration off" : "wasm not loaded yet");
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = getBufferIndex(x, y, W);
      const sourceR = buf[i];
      const sourceG = buf[i + 1];
      const sourceB = buf[i + 2];
      const alpha = buf[i + 3];

      const baseR = applyTone(sourceR, blackPoint, whitePoint, contrast, midtoneLift);
      const baseG = applyTone(sourceG, blackPoint, whitePoint, contrast, midtoneLift);
      const baseB = applyTone(sourceB, blackPoint, whitePoint, contrast, midtoneLift);

      const toneLuma = luminance01(baseR, baseG, baseB);
      const shadowWeight = 1 - smoothstep(0.24, 0.72, toneLuma);
      const highlightWeight = smoothstep(0.34, 0.84, toneLuma);

      let gradedR = baseR - shadowWeight * shadowCool * 28 + highlightWeight * highlightWarm * 36;
      let gradedG = baseG + shadowWeight * shadowCool * 16 + highlightWeight * highlightWarm * 12;
      let gradedB = baseB + shadowWeight * shadowCool * 44 - highlightWeight * highlightWarm * 16;

      const coolStrength = shadowWeight * shadowCool;
      const warmStrength = highlightWeight * highlightWarm;

      const coolTintR = baseR * (1 - 0.22 * coolStrength);
      const coolTintG = baseG * (1 + 0.05 * coolStrength);
      const coolTintB = baseB * (1 + 0.22 * coolStrength);

      const warmTintR = baseR * (1 + 0.18 * warmStrength);
      const warmTintG = baseG * (1 + 0.07 * warmStrength);
      const warmTintB = baseB * (1 - 0.16 * warmStrength);

      gradedR = lerp(gradedR, coolTintR, 0.65 * coolStrength);
      gradedG = lerp(gradedG, coolTintG, 0.65 * coolStrength);
      gradedB = lerp(gradedB, coolTintB, 0.65 * coolStrength);

      gradedR = lerp(gradedR, warmTintR, 0.75 * warmStrength);
      gradedG = lerp(gradedG, warmTintG, 0.75 * warmStrength);
      gradedB = lerp(gradedB, warmTintB, 0.75 * warmStrength);

      // Approximate Photoshop "Color" blend behavior by steering the tint pass
      // back toward the base luminance so the grade reads as color-first.
      // Use a partial correction so the default pass is still clearly visible.
      const baseLum = 0.2126 * baseR + 0.7152 * baseG + 0.0722 * baseB;
      const gradedLum = 0.2126 * gradedR + 0.7152 * gradedG + 0.0722 * gradedB;
      const lumDelta = baseLum - gradedLum;
      const lumRestore = 0.45;
      gradedR = clamp(0, 255, Math.round(lerp(gradedR, gradedR + lumDelta, lumRestore)));
      gradedG = clamp(0, 255, Math.round(lerp(gradedG, gradedG + lumDelta, lumRestore)));
      gradedB = clamp(0, 255, Math.round(lerp(gradedB, gradedB + lumDelta, lumRestore)));

      [gradedR, gradedG, gradedB] = applyVibrance(gradedR, gradedG, gradedB, vibrance);

      const finalR = clamp(0, 255, Math.round(baseR + (gradedR - baseR) * mix));
      const finalG = clamp(0, 255, Math.round(baseG + (gradedG - baseG) * mix));
      const finalB = clamp(0, 255, Math.round(baseB + (gradedB - baseB) * mix));

      const color = srgbPaletteGetColor(palette, rgba(finalR, finalG, finalB, alpha), palette.options);
      fillBufferPixel(outBuf, i, color[0], color[1], color[2], alpha);
    }
  }

  outputCtx.putImageData(new ImageData(outBuf, W, H), 0, 0);
  return output;
};

export default defineFilter({
  name: "Anime Color Grade",
  func: animeColorGrade,
  optionTypes,
  options: defaults,
  defaults,
});
