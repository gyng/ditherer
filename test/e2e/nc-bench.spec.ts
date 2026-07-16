import { test } from "@playwright/test";

// Palette-cap bench for the N-candidate dither shader.
//
// WHY THIS EXISTS: the shader keeps a per-fragment `float weights[MAX_PAL]`
// accumulator. On a real GPU a large array spills to scratch memory and cuts
// occupancy, which is the only real argument for capping the palette at all.
// A software rasterizer (SwiftShader, what CI and most dev boxes get here) has
// a stack and models none of that — so numbers from CI cannot answer the
// question. This must be run on real hardware.
//
//   NC_BENCH=1 npx playwright test test/e2e/nc-bench.spec.ts --project=chromium
//
// Check the RENDERER line it prints: if it says SwiftShader, the numbers are
// measuring a CPU and tell you nothing about register pressure. Point Playwright
// at a GPU-backed browser instead:
//
//   NC_BENCH=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome \
//     npx playwright test test/e2e/nc-bench.spec.ts --project=chromium
//
// Opt-in because it is slow and its result is a judgement call, not a pass/fail.
// See docs/plan/055-n-candidate-dithering.md.

const W = 640, H = 400;
const CAPS = [16, 64, 128, 256];
const PALETTE_SIZES = [8, 16, 64, 256];
const CANDIDATES = 32;
const REPS = 7;

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

  const rows: string[] = [];
  console.log(`\n${W}x${H}, N=${CANDIDATES}, EMA-Exact, median of ${REPS}\n`);
  console.log(`cap\\K   ${PALETTE_SIZES.map((k) => String(k).padStart(9)).join("")}`);

  for (const maxPal of CAPS) {
    const cells: string[] = [];
    for (const k of PALETTE_SIZES) {
      if (k > maxPal) { cells.push("       --"); continue; }
      const r = await page.evaluate(
        ({ rgba, W, H, palette, maxPal, candidates, reps }) =>
          (window as unknown as { __ncParity: { bench: (b: unknown) => { median: number; distinct: number } | null } })
            .__ncParity.bench({ width: W, height: H, rgba, palette, maxPal, candidates, reps }),
        { rgba, W, H, palette: makePalette(k), maxPal, candidates: CANDIDATES, reps: REPS },
      );
      cells.push(r ? `${r.median.toFixed(1)}ms`.padStart(9) : "     FAIL");
    }
    const row = `${String(maxPal).padEnd(8)}${cells.join("")}`;
    console.log(row);
    rows.push(row);
  }

  console.log(
    "\nRead it down a column: that isolates the cost of the compiled cap at a\n"
    + "fixed real palette size. If a bigger cap is ~free down each column, the\n"
    + "cap only needs to be as large as the palettes we want to support.\n",
  );
});
