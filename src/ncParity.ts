// N-candidate dither GL/CPU parity harness. Runs in a real browser so WebGL2 is
// available; the Playwright spec drives it and compares the pixels it returns
// against the CPU oracle in test/fixtures/nCandidateReference.ts.
//
// The oracle is a test-only port of the article's reference implementation and
// must never be imported by src/ (plan 036 — no in-flight JS fallback), so the
// comparison happens across the process boundary: this page renders, the spec
// checks. See docs/plan/055-n-candidate-dithering.md.
import nCandidateDither from "@gyng/ditherer-filters/filters/nCandidateDither";
import { renderNCandidateGL, NC_ALGO, NC_SPACE } from "@gyng/ditherer-filters/filters/nCandidateDitherGL";

type RenderRequest = {
  width: number;
  height: number;
  rgba: number[];
  options: Record<string, unknown>;
};

type BenchRequest = {
  width: number;
  height: number;
  rgba: number[];
  palette: number[][];
  maxPal: number;
  candidates: number;
  reps: number;
};

const render = ({ width, height, rgba, options }: RenderRequest): number[] | null => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);

  const out = nCandidateDither.func(canvas, options) as HTMLCanvasElement;
  // A GL-path failure returns the input canvas untouched; the spec asserts on
  // the pixels, which would catch that as a total mismatch.
  const outCtx = out.getContext("2d");
  if (!outCtx) return null;
  return Array.from(outCtx.getImageData(0, 0, width, height).data);
};

// Times the shader at a given palette cap. Calls the GL renderer directly
// because `maxPal` is deliberately not a user-facing filter option — it only
// exists so the cap can be chosen from real-hardware evidence rather than the
// software rasterizer's (see test/e2e/nc-bench.spec.ts).
const bench = ({ width, height, rgba, palette, maxPal, candidates, reps }: BenchRequest) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);

  const opts = {
    thresholdMap: [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]],
    thresholdLevels: 16,
    thresholdMapKey: "NC_BAYER_4X4",
    algo: NC_ALGO.EMA_EXACT,
    candidates,
    strength: 0.8,
    minT: 0.2,
    maxT: 1.0,
    constantT: 0.3,
    colorspace: NC_SPACE.SRGB,
    lumaWeighted: false,
    sweepTests: 8,
    paletteRgb: palette,
    maxPal,
  };

  // Warm up: first call compiles the program for this cap.
  if (!renderNCandidateGL(canvas, width, height, opts)) return null;

  const times: number[] = [];
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    const out = renderNCandidateGL(canvas, width, height, opts);
    // Force the readback to land before stopping the clock, otherwise we time
    // command submission rather than the draw.
    (out as HTMLCanvasElement)?.getContext("2d")?.getImageData(0, 0, 1, 1);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);

  const out = renderNCandidateGL(canvas, width, height, opts) as HTMLCanvasElement;
  const pixels = out.getContext("2d")!.getImageData(0, 0, width, height).data;
  const distinct = new Set<string>();
  for (let i = 0; i < pixels.length; i += 4) {
    distinct.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
  }

  return { median: times[Math.floor(times.length / 2)], distinct: distinct.size };
};

(window as unknown as {
  __ncParity: { render: typeof render; bench: typeof bench };
}).__ncParity = { render, bench };

const status = document.querySelector('[data-testid="status"]');
if (status) status.textContent = "ready";
