/**
 * End-to-end pipeline benchmarks.
 * Run with: npx vitest bench test/perf/pipelineBench
 *
 * Measures the full filter pipeline cost including canvas I/O overhead
 * (getImageData, putImageData, cloneCanvas) — not just the filter function
 * itself.
 *
 * The "filter only" numbers from filterBench show algorithmic cost.
 * These numbers show what the user actually experiences per frame.
 *
 * NOT measured here: `toDataURL`. See the note at the bottom — jsdom stubs it,
 * so the PNG-encode suites that used to sit here were measuring nothing.
 */
import { describe, bench, beforeAll } from "vitest";
import { floydSteinberg } from "filters/errorDiffusing";
import convolve from "filters/convolve";
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
  for (let i = 0; i < imageData.data.length; i++) {
    imageData.data[i] = (i * 2654435761) & 0xff;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
};

// ---------------------------------------------------------------------------
// Shared inputs
// ---------------------------------------------------------------------------

let canvas640: HTMLCanvasElement;

beforeAll(() => {
  canvas640 = makeNoiseCanvas(640, 480);
});

const palette = palettes.nearest;

// ---------------------------------------------------------------------------
// Pipeline: filter → output (current: direct canvas pass)
// ---------------------------------------------------------------------------

describe("Pipeline 640×480 — direct canvas (current)", () => {
  bench("Floyd-Steinberg sRGB", () => {
    const output = floydSteinberg.func(canvas640, { palette, _linearize: false });
    // Current pipeline: pass canvas directly to state (no encoding)
    // Simulate what emitOutput does now: just reference the canvas
    void (output as HTMLCanvasElement).width;
  });

  // "Ordered Bayer sRGB" was here and reported 2,893,271 hz — a 640×480 dither
  // in 0.0003ms. `ordered` is requiresGL:true and jsdom has no WebGL2, so
  // ordered.func handed back the input canvas untouched and the bench timed the
  // early return. Removed for the same reason as filterBench's copy (cebdd35);
  // requiresGL means there is no CPU path to fall back to, so no option flag
  // rescues it here.

  bench("Convolve Gaussian sRGB", () => {
    const opts = { ...convolve.defaults, _linearize: false };
    const output = convolve.func(canvas640, opts as any);
    void (output as HTMLCanvasElement).width;
  });
});

// ---------------------------------------------------------------------------
// Pipeline: multi-filter chain simulation
// ---------------------------------------------------------------------------

describe("Pipeline 640×480 — 2-filter chain (direct canvas)", () => {
  // Was "Ordered → Convolve → Convolve". The Ordered step was the same
  // requiresGL no-op as above, so this only ever measured two filters — the
  // timing is unchanged by dropping it, the name just stopped lying.
  bench("Convolve → Convolve", () => {
    let canvas: any = convolve.func(canvas640, { ...convolve.defaults, _linearize: false } as any);
    canvas = convolve.func(canvas, { ...convolve.defaults, _linearize: false } as any);
    void canvas.width;
  });
});

// ---------------------------------------------------------------------------
// REMOVED: "PNG encode (old path)" suites
// ---------------------------------------------------------------------------
//
// Two suites compared the current direct-canvas pipeline against the old
// `toDataURL` → `new Image().src` path, which is the comparison that justified
// the pipeline as it stands. They could not have supported it: jsdom's
// `toDataURL` returns the 24-character string "data:image/png;base64,00" in
// 0.04ms. It never encodes anything.
//
// So every "+ toDataURL" bench measured its filter plus nothing, and said so
// plainly for anyone reading: "Ordered Bayer sRGB + toDataURL" at 1,275,550 hz
// (a 640×480 PNG in 0.78µs), "Convolve + toDataURL" 23.6ms against Convolve's
// own 22.2ms, and "FS + toDataURL" coming out *faster* than FS alone. Deleted
// rather than kept as decorative numbers — 151a367 is the cautionary tale, where
// a bench that measured an early return got cited as evidence of a real
// regression.
//
// Measuring this for real needs a canvas that actually encodes: node-canvas
// under vitest, or the browser via the playwright bench path. Worth doing if the
// PNG path is ever reconsidered; until then no number beats a wrong one.
