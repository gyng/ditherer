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

/**
 * Wake Turbulence must warp ONLY where there is motion. With no inter-frame
 * motion (previous frame equal to the current) the output matches the source;
 * with strong motion (a very different previous frame) the curl-turbulence warp
 * visibly displaces the image. Uses _frameIndex 0 so no accumulated energy from
 * a prior call leaks in.
 */
export const runWakeMotionGated = (): Result => {
  const filter = filterIndex["Wake Turbulence"] as FilterLike | undefined;
  if (!filter) return { ok: false, reason: "Wake Turbulence missing from registry" };
  const w = 64, h = 64;
  const src = document.createElement("canvas");
  src.width = w; src.height = h;
  const ctx = src.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { ok: false, reason: "wake fixture has no 2d context" };
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const o = (y * w + x) * 4;
    const v = ((x >> 2) + (y >> 2)) % 2 === 0 ? 220 : 40; // checker for visible warp
    image.data[o] = v; image.data[o + 1] = v; image.data[o + 2] = v; image.data[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const srcPixels = ctx.getImageData(0, 0, w, h).data;

  const still = new Uint8ClampedArray(srcPixels);                 // prev == current -> no motion
  const moved = new Uint8ClampedArray(srcPixels.length);          // prev inverted -> strong motion
  for (let i = 0; i < moved.length; i += 4) {
    moved[i] = 255 - srcPixels[i]; moved[i + 1] = 255 - srcPixels[i + 1];
    moved[i + 2] = 255 - srcPixels[i + 2]; moved[i + 3] = 255;
  }

  const runWake = (ema: Uint8ClampedArray): Uint8ClampedArray | null => {
    const fresh = document.createElement("canvas");
    fresh.width = w; fresh.height = h;
    fresh.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(srcPixels), w, h), 0, 0);
    return canvasPixels(filter.func(fresh, {
      ...(filter.defaults ?? {}), intensity: 16, turbulence: 3,
      _webglAcceleration: true, _frameIndex: 0, _isAnimating: true, _ema: ema,
    }) as HTMLCanvasElement);
  };

  const noMotion = runWake(still);
  const motion = runWake(moved);
  if (!noMotion || !motion) return { ok: false, reason: "Wake Turbulence readback failed" };

  const meanDiff = (a: Uint8ClampedArray): number => {
    let s = 0;
    for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - srcPixels[i]);
    return s / (a.length / 4);
  };
  const stillDiff = meanDiff(noMotion), motionDiff = meanDiff(motion);
  if (stillDiff > 4) {
    return { ok: false, reason: `warped without motion (mean diff ${stillDiff.toFixed(1)})` };
  }
  if (motionDiff < 12) {
    return { ok: false, reason: `no wake warp under motion (mean diff ${motionDiff.toFixed(1)})` };
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
