/**
 * Filter performance benchmarks.
 * Run with: npx vitest bench test/perf/filterBench.ts
 *
 * Measures per-frame cost of the main filters used in realtime video mode.
 * Each bench runs the filter on a fixed noise canvas.
 */
import { describe, bench, beforeAll } from "vitest";
import { floydSteinberg } from "filters/errorDiffusing";
import convolve from "filters/convolve";
import ordered from "filters/ordered";
import binarize from "filters/binarize";
import * as palettes from "palettes";

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

const makeNoiseCanvas = (w: number, h: number): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.createImageData(w, h);
  // Pseudo-random noise — deterministic so results are reproducible
  for (let i = 0; i < imageData.data.length; i++) {
    imageData.data[i] = (i * 2654435761) & 0xff;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
};

// ---------------------------------------------------------------------------
// Shared inputs — allocated once, filters must not mutate the source canvas
// ---------------------------------------------------------------------------

let canvas320: HTMLCanvasElement;
let canvas640: HTMLCanvasElement;

beforeAll(() => {
  canvas320 = makeNoiseCanvas(320, 240);
  canvas640 = makeNoiseCanvas(640, 480);
});

const palette = palettes.nearest;
const fsOpts = { palette, _linearize: false };
const fsLinearOpts = { palette, _linearize: true };

// ---------------------------------------------------------------------------
// Floyd-Steinberg (error diffusion — the most expensive filter)
// ---------------------------------------------------------------------------

describe("Floyd-Steinberg 320×240", () => {
  bench("sRGB path", () => {
    floydSteinberg.func(canvas320, fsOpts);
  });
  bench("linear path", () => {
    floydSteinberg.func(canvas320, fsLinearOpts);
  });
});

describe("Floyd-Steinberg 640×480", () => {
  bench("sRGB path", () => {
    floydSteinberg.func(canvas640, fsOpts);
  });
  bench("linear path", () => {
    floydSteinberg.func(canvas640, fsLinearOpts);
  });
});

// ---------------------------------------------------------------------------
// Convolve (triple-nested loop)
// ---------------------------------------------------------------------------

describe("Convolve (Gaussian 3×3) 320×240", () => {
  const opts = { ...convolve.defaults, _linearize: false };
  const optsLinear = { ...convolve.defaults, _linearize: true };
  bench("sRGB path", () => { convolve.func(canvas320, opts as any); });
  bench("linear path", () => { convolve.func(canvas320, optsLinear as any); });
});

describe("Convolve (Gaussian 3×3) 640×480", () => {
  const opts = { ...convolve.defaults, _linearize: false };
  const optsLinear = { ...convolve.defaults, _linearize: true };
  bench("sRGB path", () => { convolve.func(canvas640, opts as any); });
  bench("linear path", () => { convolve.func(canvas640, optsLinear as any); });
});

// ---------------------------------------------------------------------------
// Ordered dither (fast reference)
// ---------------------------------------------------------------------------

describe("Ordered (Bayer 4×4) 640×480", () => {
  bench("sRGB path", () => { ordered.func(canvas640, ordered.defaults as any); });
});

// ---------------------------------------------------------------------------
// Binarize (simplest filter — floor for overhead)
// ---------------------------------------------------------------------------

describe("Binarize 640×480", () => {
  bench("sRGB path", () => { binarize.func(canvas640, { threshold: 128, _linearize: false } as any); });
});
