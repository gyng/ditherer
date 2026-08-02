import { filterIndex } from "@gyng/ditherer-filters";
import { canvasPixels, makeSolidCanvas, runtimeOptions } from "../fixtures";
import type { FilterLike } from "../types";

type Result = { ok: true } | { ok: false; reason: string };

const PRINTMAKING_FILTERS = ["Crosshatch", "Engraving", "Woodcut", "Stipple"] as const;

const meanLuma = (pixels: Uint8ClampedArray): number => {
  let sum = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    sum += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
  }
  return sum / (pixels.length / 4);
};

const renderSolid = (filter: FilterLike, value: number): Uint8ClampedArray | null => {
  const out = filter.func(makeSolidCanvas(96, 96, value), {
    ...(filter.defaults ?? {}),
    ...runtimeOptions(),
  }) as HTMLCanvasElement;
  return canvasPixels(out);
};

/**
 * Every printmaking stylizer must reproduce tone by mark density: a darker
 * flat patch must ink more than a lighter one. This is the contract the old
 * hard-threshold / constant-density implementations violated (a mid-grey and
 * a near-black produced identical marks).
 */
export const runPrintmakingToneMonotonic = (): Result => {
  for (const name of PRINTMAKING_FILTERS) {
    const filter = filterIndex[name] as FilterLike | undefined;
    if (!filter) return { ok: false, reason: `${name} missing from registry` };
    const light = renderSolid(filter, 210);
    const mid = renderSolid(filter, 120);
    const dark = renderSolid(filter, 40);
    if (!light || !mid || !dark) return { ok: false, reason: `${name} readback failed` };
    const lLight = meanLuma(light),
      lMid = meanLuma(mid),
      lDark = meanLuma(dark);
    if (!(lLight > lMid + 2)) {
      return {
        ok: false,
        reason: `${name} light(${lLight.toFixed(1)}) not brighter than mid(${lMid.toFixed(1)})`,
      };
    }
    if (!(lMid > lDark + 2)) {
      return {
        ok: false,
        reason: `${name} mid(${lMid.toFixed(1)}) not brighter than dark(${lDark.toFixed(1)})`,
      };
    }
  }
  return { ok: true };
};

/**
 * Stippling varies dot *density*, not size: the inked-pixel fraction must rise
 * with darkness. (The previous filter grew the dot radius on a fixed lattice,
 * which is amplitude-modulated halftone.)
 */
export const runStippleDensityModulation = (): Result => {
  const filter = filterIndex.Stipple as FilterLike | undefined;
  if (!filter) return { ok: false, reason: "Stipple missing from registry" };
  const inkedFraction = (value: number): number => {
    const pixels = renderSolid(filter, value);
    if (!pixels) return -1;
    let inked = 0,
      total = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      total += 1;
      const luma = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
      if (luma < 128) inked += 1;
    }
    return inked / total;
  };
  const light = inkedFraction(220);
  const dark = inkedFraction(40);
  if (light < 0 || dark < 0) return { ok: false, reason: "Stipple readback failed" };
  return dark > light + 0.05
    ? { ok: true }
    : {
        ok: false,
        reason: `Stipple density did not rise with darkness (light ${light.toFixed(3)} -> dark ${dark.toFixed(3)})`,
      };
};

/** The GL printmaking shaders must pass source alpha straight through. */
export const runPrintmakingAlphaPreservation = (): Result => {
  const width = 64,
    height = 16;
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) return { ok: false, reason: "alpha fixture has no 2d context" };
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      image.data[offset] = (x * 4) % 256;
      image.data[offset + 1] = (x * 7) % 256;
      image.data[offset + 2] = (x * 3) % 256;
      image.data[offset + 3] = x < width / 2 ? 255 : 96;
    }
  }
  context.putImageData(image, 0, 0);
  const expected = context.getImageData(0, 0, width, height).data;

  for (const name of PRINTMAKING_FILTERS) {
    const filter = filterIndex[name] as FilterLike | undefined;
    if (!filter) return { ok: false, reason: `${name} missing from registry` };
    const fresh = document.createElement("canvas");
    fresh.width = width;
    fresh.height = height;
    fresh.getContext("2d")!.putImageData(new ImageData(expected.slice(), width, height), 0, 0);
    let pixels: Uint8ClampedArray | null;
    try {
      pixels = canvasPixels(
        filter.func(fresh, {
          ...(filter.defaults ?? {}),
          ...runtimeOptions(),
        }) as HTMLCanvasElement,
      );
    } catch (error) {
      return {
        ok: false,
        reason: `${name} threw: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (!pixels) return { ok: false, reason: `${name} readback failed` };
    for (let i = 3; i < pixels.length; i += 4) {
      if (Math.abs(pixels[i] - expected[i]) > 2) {
        return {
          ok: false,
          reason: `${name} altered alpha at ${i}: ${expected[i]} -> ${pixels[i]}`,
        };
      }
    }
  }
  return { ok: true };
};
