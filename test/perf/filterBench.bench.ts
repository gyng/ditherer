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
import binarize from "filters/binarize";
import * as palettes from "@gyng/ditherer-filters";

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
// Ordered dither — REMOVED, it can only measure an early return here
// ---------------------------------------------------------------------------
//
// `ordered` is requiresGL:true and there is no WebGL2 under jsdom, so
// `ordered.func` handed back the input canvas untouched and the bench clocked
// 3,090,677 hz — a 640×480 dither in 0.0003ms. Same tell 8d25b0d called out for
// the old WASM benches: throughput that doesn't move with the work.
//
// Not replaceable with `_webglAcceleration: false` either — requiresGL means
// there is no CPU path to fall back to. Bench it where a GPU exists (gl-smoke
// under playwright) or not at all; a number here would be a lie either way.

// ---------------------------------------------------------------------------
// Binarize (simplest filter — floor for overhead)
// ---------------------------------------------------------------------------

// Not a floor, despite the heading: this comes out ~4x SLOWER than
// Floyd-Steinberg, because FS has a whole-buffer Rust kernel and binarize is a
// per-pixel JS loop with a palette lookup. The heading's assumption predates
// the WASM quantizers.
describe("Binarize 640×480", () => {
  // Spread the filter's own defaults, the way the Convolve benches above do.
  // This used to pass `{ threshold: 128 }` — not one of binarize's options; it
  // takes thresholdR/G/B/A and a palette. Supplying an options object suppressed
  // the `= defaults` parameter, so `palette` arrived undefined and the body threw
  // on `palette.options` every iteration. Vitest recorded no stats, the reporter
  // died on the stub, and every other suite's results died with it — which is why
  // bench-results/latest.json only ever held the colour suites.
  //
  // Naming options by hand is what allowed that; spreading defaults cannot drift
  // out of sync with the filter.
  const opts = { ...binarize.defaults, _linearize: false };
  bench("sRGB path", () => { binarize.func(canvas640, opts as any); });
});
