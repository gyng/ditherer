// N-candidate dither GL/CPU parity harness. Runs in a real browser so WebGL2 is
// available; the Playwright spec drives it and compares the pixels it returns
// against the CPU oracle in test/fixtures/nCandidateReference.ts.
//
// The oracle is a test-only port of the article's reference implementation and
// must never be imported by src/ (plan 036 — no in-flight JS fallback), so the
// comparison happens across the process boundary: this page renders, the spec
// checks. See docs/plan/055-n-candidate-dithering.md.
import nCandidateDither from "@gyng/ditherer-filters/filters/nCandidateDither";
import { getGLCtx } from "@gyng/ditherer-filters";
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

// Resolve one TIME_ELAPSED query, or null if the driver flagged the measurement
// as disjoint (a clock glitch / power-state change mid-measurement — the spec
// says such a result must be thrown away, not merely distrusted).
const resolveQuery = (
  gl: WebGL2RenderingContext,
  ext: { GPU_DISJOINT_EXT: number },
  query: WebGLQuery,
): Promise<number | null> =>
  new Promise((resolve) => {
    const poll = () => {
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
        setTimeout(poll, 1);
        return;
      }
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const ns = disjoint ? null : (gl.getQueryParameter(query, gl.QUERY_RESULT) as number);
      gl.deleteQuery(query);
      resolve(ns == null ? null : ns / 1e6);
    };
    poll();
  });

// Times the shader at a given palette cap. Calls the GL renderer directly
// because `maxPal` is deliberately not a user-facing filter option — it only
// exists so the cap can be chosen from real-hardware evidence rather than the
// software rasterizer's (see test/e2e/nc-bench.spec.ts).
//
// Timing is GPU-side via EXT_disjoint_timer_query_webgl2, not wall clock. A
// wall-clock version of this bench produced self-contradictory numbers (a
// larger palette measuring *faster* than a smaller one) because at these sizes
// the readback dominates: readoutToCanvas drawImage's the GL canvas into a 2D
// canvas, and forcing that to land costs far more than the draw it wraps.
// TIME_ELAPSED brackets only the GL command stream, so the readback drops out.
const bench = async ({ width, height, rgba, palette, maxPal, candidates, reps }: BenchRequest) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);

  const glCtx = getGLCtx();
  if (!glCtx) return null;
  const { gl } = glCtx;
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  } | null;
  if (!ext) return { error: "EXT_disjoint_timer_query_webgl2 unavailable" };

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

  // Warm up: first call compiles the program for this cap, and lets the GPU
  // clock up so the first timed sample isn't measuring a downclocked card.
  for (let i = 0; i < 3; i++) {
    if (!renderNCandidateGL(canvas, width, height, opts)) return null;
  }

  const times: number[] = [];
  let disjoint = 0;
  for (let i = 0; i < reps; i++) {
    const query = gl.createQuery();
    if (!query) break;
    // Drain everything already queued before opening the window. Without this
    // the samples come out bimodal — some land at the real cost, others at a
    // floor that was identical across configurations, i.e. the query was
    // timing a window our draw hadn't reached yet.
    gl.finish();
    // Only one TIME_ELAPSED query can be in flight per context, so this has to
    // stay sequential.
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    renderNCandidateGL(canvas, width, height, opts);
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    // Force our draw to complete inside the window rather than trailing past
    // endQuery into the next sample.
    gl.finish();
    const ms = await resolveQuery(gl, ext, query);
    if (ms == null) disjoint++;
    else times.push(ms);
  }
  if (times.length === 0) return { error: `all ${reps} samples disjoint` };
  times.sort((a, b) => a - b);

  const out = renderNCandidateGL(canvas, width, height, opts) as HTMLCanvasElement;
  const pixels = out.getContext("2d")!.getImageData(0, 0, width, height).data;
  const distinct = new Set<string>();
  for (let i = 0; i < pixels.length; i += 4) {
    distinct.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
  }

  // Report spread too: a median alone can't tell a clean measurement from a
  // noisy one, and this bench exists precisely because the last one was noise.
  return {
    median: times[Math.floor(times.length / 2)],
    min: times[0],
    max: times[times.length - 1],
    samples: times.length,
    disjoint,
    distinct: distinct.size,
  };
};

(window as unknown as {
  __ncParity: { render: typeof render; bench: typeof bench };
}).__ncParity = { render, bench };

const status = document.querySelector('[data-testid="status"]');
if (status) status.textContent = "ready";
