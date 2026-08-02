import { filterIndex } from "@gyng/ditherer-filters";
import { canvasPixels, runtimeOptions } from "../fixtures";
import type { FilterLike } from "../types";

type Result = { ok: true } | { ok: false; reason: string };

const luma = (px: Uint8ClampedArray, i: number): number =>
  0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];

/**
 * Analog Static must (a) ghost via a delayed multipath echo — a bright feature
 * reappears a controllable delay to its right — and (b) preserve source alpha
 * (both paths previously forced opaque output).
 */
export const runAnalogStaticGhostAndAlpha = (): Result => {
  const filter = filterIndex["Analog Static"] as FilterLike | undefined;
  if (!filter) return { ok: false, reason: "Analog Static missing from registry" };
  const w = 80,
    h = 24,
    barX = 12,
    delay = 12;

  const source = document.createElement("canvas");
  source.width = w;
  source.height = h;
  const ctx = source.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { ok: false, reason: "fixture has no 2d context" };
  const image = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      const bright = x >= barX && x < barX + 3; // a bright vertical bar
      const v = bright ? 255 : 0;
      image.data[o] = v;
      image.data[o + 1] = v;
      image.data[o + 2] = v;
      image.data[o + 3] = x < w / 2 ? 255 : 90; // varying alpha
    }
  }
  ctx.putImageData(image, 0, 0);
  const expectedAlpha = ctx.getImageData(0, 0, w, h).data;

  // Isolate the ghost: no snow, no bands, no roll, no persistence.
  const opts = {
    ...(filter.defaults ?? {}),
    ...runtimeOptions(),
    noiseAmount: 0,
    barIntensity: 0,
    verticalHold: 0,
    persistence: 0,
    ghosting: 1,
    ghostDelay: delay,
    _frameIndex: 0,
    _isAnimating: false,
    _prevOutput: null,
  };
  const out = canvasPixels(filter.func(source, opts) as HTMLCanvasElement);
  if (!out) return { ok: false, reason: "Analog Static readback failed" };

  // Ghost echo of the bar should appear ~delay px to its right.
  const midY = Math.floor(h / 2);
  const ghostX = barX + delay + 1;
  const ghostLuma = luma(out, (midY * w + ghostX) * 4);
  const bgLuma = luma(out, (midY * w + (w - 2)) * 4);
  if (!(ghostLuma > bgLuma + 20)) {
    return {
      ok: false,
      reason: `no multipath ghost at x=${ghostX} (luma ${ghostLuma.toFixed(1)} vs bg ${bgLuma.toFixed(1)})`,
    };
  }
  for (let i = 3; i < out.length; i += 4) {
    if (Math.abs(out[i] - expectedAlpha[i]) > 2) {
      return {
        ok: false,
        reason: `Analog Static altered alpha at ${i}: ${expectedAlpha[i]} -> ${out[i]}`,
      };
    }
  }
  return { ok: true };
};
