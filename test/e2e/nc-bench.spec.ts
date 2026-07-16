import { test } from "@playwright/test";

// Palette-cap bench for the N-candidate dither shader.
//
// WHY THIS EXISTS: the shader keeps a per-fragment `float weights[MAX_PAL]`
// accumulator. On a real GPU a large array spills to scratch memory and cuts
// occupancy, which is the only real argument for capping the palette at all.
// A software rasterizer has a stack and models none of that, so it cannot
// answer the question no matter how carefully you time it. This must run on
// real hardware, and it times the GPU rather than the wall clock.
//
// PLAYWRIGHT_GPU=1 sets up the Mesa d3d12 route itself (see playwright.config.ts);
// `--use-angle=vulkan` would land on llvmpipe, as there's no NVIDIA Vulkan ICD.
//
//   NC_BENCH=1 PLAYWRIGHT_ANGLE=gl PLAYWRIGHT_GPU=1 \
//   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome \
//     npx playwright test test/e2e/nc-bench.spec.ts --project=chromium
//
// Always read the RENDERER line it prints. If it names llvmpipe or SwiftShader
// you are timing a CPU and the numbers say nothing about register pressure.
//
// BEFORE BELIEVING ANY NUMBER HERE: as of the last attempt this bench could not
// produce a valid result on a WSLg RTX 3080 even with GPU timing and a drained
// pipeline — two runs disagreed, and some cells measured cost *falling* as the
// palette grew, which is impossible. Check `spread`, re-run to confirm it
// reproduces, and check what else is using the GPU. See the "still unmeasured"
// section of docs/plan/055-n-candidate-dithering.md.
//
// Opt-in because it is slow and its result is a judgement call, not a pass/fail.

const W = 640, H = 400;
const CAPS = [16, 64, 128, 256];
const PALETTE_SIZES = [8, 16, 64, 256];
const CANDIDATES = 32;
const REPS = 9;

// Spread colors around the HSV wheel so the candidate search has real choices
// at every palette size.
const makePalette = (k: number) => {
  const out: number[][] = [];
  for (let i = 0; i < k; i++) {
    const h = (i / k) * 6;
    const s = 0.5 + 0.5 * ((i % 3) / 2);
    const v = 0.25 + 0.75 * ((i % 5) / 4);
    const c = v * s, x = c * (1 - Math.abs((h % 2) - 1)), m = v - c;
    const rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h) % 6];
    out.push([
      Math.round((rgb[0] + m) * 255),
      Math.round((rgb[1] + m) * 255),
      Math.round((rgb[2] + m) * 255),
      255,
    ]);
  }
  return out;
};

test.skip(process.env.NC_BENCH !== "1", "opt-in bench — set NC_BENCH=1");

test("palette cap cost across MAX_PAL x K", async ({ page }) => {
  test.setTimeout(600_000);

  await page.goto("/nc-parity.html");
  await page.locator('[data-testid="status"]').waitFor();

  const renderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: ext ? gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown",
      maxFragUniformVectors: gl?.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
    };
  });
  console.log(`\nRENDERER: ${renderer.renderer}`);
  console.log(`MAX_FRAGMENT_UNIFORM_VECTORS: ${renderer.maxFragUniformVectors}`);
  if (String(renderer.renderer).includes("SwiftShader")) {
    console.log(
      "\n  ⚠ SwiftShader is a CPU rasterizer. These numbers cannot show GPU\n"
      + "    register spilling — the whole reason the cap exists. Re-run on a\n"
      + "    GPU-backed browser before drawing conclusions.\n",
    );
  }

  const rgba: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) rgba.push((x / W) * 255, (y / H) * 255, ((x ^ y) & 255), 255);
  }

  type Cell = {
    median: number; min: number; max: number;
    samples: number; disjoint: number; distinct: number;
  } | { error: string } | null;

  const detail: string[] = [];
  console.log(`\n${W}x${H}, N=${CANDIDATES}, EMA-Exact, GPU time, median of ${REPS}\n`);
  console.log(`cap\\K   ${PALETTE_SIZES.map((k) => String(k).padStart(10)).join("")}`);

  for (const maxPal of CAPS) {
    const cells: string[] = [];
    for (const k of PALETTE_SIZES) {
      if (k > maxPal) { cells.push("        --"); continue; }
      const r: Cell = await page.evaluate(
        ({ rgba, W, H, palette, maxPal, candidates, reps }) =>
          (window as unknown as { __ncParity: { bench: (b: unknown) => Promise<Cell> } })
            .__ncParity.bench({ width: W, height: H, rgba, palette, maxPal, candidates, reps }),
        { rgba, W, H, palette: makePalette(k), maxPal, candidates: CANDIDATES, reps: REPS },
      );
      if (!r || "error" in r) {
        cells.push("      FAIL");
        detail.push(`cap=${maxPal} K=${k}: ${r ? r.error : "no result"}`);
        continue;
      }
      cells.push(`${r.median.toFixed(2)}ms`.padStart(10));
      // Spread is the honesty check — if max/min is wide the median is noise.
      detail.push(
        `cap=${String(maxPal).padEnd(4)} K=${String(k).padEnd(4)} `
        + `median=${r.median.toFixed(2)} min=${r.min.toFixed(2)} max=${r.max.toFixed(2)} `
        + `spread=${(r.max / Math.max(r.min, 1e-6)).toFixed(1)}x `
        + `n=${r.samples} disjoint=${r.disjoint} colors=${r.distinct}`,
      );
    }
    console.log(`${String(maxPal).padEnd(8)}${cells.join("")}`);
  }

  console.log(`\n${detail.join("\n")}`);
  console.log(
    "\nRead it down a column: that isolates the cost of the compiled cap at a\n"
    + "fixed real palette size. Check `spread` before believing any median —\n"
    + "and sanity-check that cost rises with K, since it must.\n",
  );
});
