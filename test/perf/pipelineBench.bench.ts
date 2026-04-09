/**
 * End-to-end pipeline benchmarks.
 * Run with: npx vitest bench test/perf/pipelineBench
 *
 * Measures the full filter pipeline cost including canvas I/O overhead
 * (getImageData, putImageData, cloneCanvas, toDataURL) — not just the
 * filter function itself.
 *
 * The "filter only" numbers from filterBench show algorithmic cost.
 * These numbers show what the user actually experiences per frame.
 */
import { describe, bench, beforeAll } from "vitest";
import { floydSteinberg } from "filters/errorDiffusing";
import ordered from "filters/ordered";
import convolve from "filters/convolve";
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

  bench("Ordered Bayer sRGB", () => {
    const output = ordered.func(canvas640, ordered.defaults as any);
    void (output as HTMLCanvasElement).width;
  });

  bench("Convolve Gaussian sRGB", () => {
    const opts = { ...convolve.defaults, _linearize: false };
    const output = convolve.func(canvas640, opts as any);
    void (output as HTMLCanvasElement).width;
  });
});

// ---------------------------------------------------------------------------
// Pipeline: filter → toDataURL → Image (old path, for comparison)
// ---------------------------------------------------------------------------

describe("Pipeline 640×480 — PNG encode (old path)", () => {
  bench("Floyd-Steinberg sRGB + toDataURL", () => {
    const output = floydSteinberg.func(canvas640, { palette, _linearize: false }) as HTMLCanvasElement;
    const dataUrl = output.toDataURL("image/png");
    // In the old path, this data URL was assigned to new Image().src
    // and decoded async. We measure the synchronous encode cost here.
    void dataUrl.length;
  });

  bench("Ordered Bayer sRGB + toDataURL", () => {
    const output = ordered.func(canvas640, ordered.defaults as any) as HTMLCanvasElement;
    const dataUrl = output.toDataURL("image/png");
    void dataUrl.length;
  });

  bench("Convolve Gaussian sRGB + toDataURL", () => {
    const opts = { ...convolve.defaults, _linearize: false };
    const output = convolve.func(canvas640, opts as any) as HTMLCanvasElement;
    const dataUrl = output.toDataURL("image/png");
    void dataUrl.length;
  });
});

// ---------------------------------------------------------------------------
// Pipeline: multi-filter chain simulation
// ---------------------------------------------------------------------------

describe("Pipeline 640×480 — 3-filter chain (direct canvas)", () => {
  bench("Ordered → Convolve → Convolve", () => {
    let canvas: any = ordered.func(canvas640, ordered.defaults as any);
    canvas = convolve.func(canvas, { ...convolve.defaults, _linearize: false } as any);
    canvas = convolve.func(canvas, { ...convolve.defaults, _linearize: false } as any);
    void canvas.width;
  });
});

describe("Pipeline 640×480 — 3-filter chain (old PNG path)", () => {
  bench("Ordered → Convolve → Convolve + toDataURL", () => {
    let canvas: any = ordered.func(canvas640, ordered.defaults as any);
    canvas = convolve.func(canvas, { ...convolve.defaults, _linearize: false } as any);
    canvas = convolve.func(canvas, { ...convolve.defaults, _linearize: false } as any);
    const dataUrl = canvas.toDataURL("image/png");
    void dataUrl.length;
  });
});
