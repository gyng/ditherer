import { filterIndex } from "@gyng/ditherer-filters";
import { canvasPixels, makeGradientCanvas, runtimeOptions } from "../fixtures";
import type { FilterLike } from "../types";

type Result = { ok: true } | { ok: false; reason: string };

const stats = (px: Uint8ClampedArray): { mean: number; range: number } => {
  let sum = 0, lo = 255, hi = 0;
  for (let i = 0; i < px.length; i += 4) {
    const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    sum += l; lo = Math.min(lo, l); hi = Math.max(hi, l);
  }
  return { mean: sum / (px.length / 4), range: hi - lo };
};

/**
 * Stable Fluids with the divergence projection must remain finite and live over
 * many frames: the pressure solve could destabilise the velocity field, so a
 * NaN/Inf blow-up would surface as an all-black (NaN→0) or all-white output.
 * Runs the simulation for several frames and checks the field neither collapses
 * to a flat frame nor saturates.
 */
export const runStableFluidsProjectionStable = (): Result => {
  const filter = filterIndex["Stable Fluids"] as FilterLike | undefined;
  if (!filter) return { ok: false, reason: "Stable Fluids missing from registry" };
  const width = 96, height = 64;

  let last: Uint8ClampedArray | null = null;
  try {
    for (let frame = 0; frame < 8; frame += 1) {
      last = canvasPixels(filter.func(makeGradientCanvas(width, height), {
        ...(filter.defaults ?? {}),
        ...runtimeOptions(),
        mode: "SMOKE",
        steps: 4,
        pressureIterations: 24,
        _frameIndex: frame,
        _isAnimating: true,
      }) as HTMLCanvasElement);
    }
  } catch (error) {
    return { ok: false, reason: `Stable Fluids threw: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!last) return { ok: false, reason: "Stable Fluids readback failed" };

  const { mean, range } = stats(last);
  if (range < 2) {
    return { ok: false, reason: `field collapsed to a flat frame (range ${range.toFixed(2)})` };
  }
  if (mean > 250 || mean < 1) {
    return { ok: false, reason: `field saturated / blew up (mean luma ${mean.toFixed(1)})` };
  }
  return { ok: true };
};

/** With projection disabled (0 iterations) the filter still renders cleanly. */
export const runStableFluidsNoProjectionRenders = (): Result => {
  const filter = filterIndex["Stable Fluids"] as FilterLike | undefined;
  if (!filter) return { ok: false, reason: "Stable Fluids missing from registry" };
  let pixels: Uint8ClampedArray | null;
  try {
    pixels = canvasPixels(filter.func(makeGradientCanvas(64, 48), {
      ...(filter.defaults ?? {}),
      ...runtimeOptions(),
      pressureIterations: 0,
      _frameIndex: 0,
      _isAnimating: true,
    }) as HTMLCanvasElement);
  } catch (error) {
    return { ok: false, reason: `Stable Fluids (no projection) threw: ${error instanceof Error ? error.message : String(error)}` };
  }
  return pixels ? { ok: true } : { ok: false, reason: "Stable Fluids (no projection) readback failed" };
};
