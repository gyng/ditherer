import { expect, test } from "@playwright/test";

import {
  ditherNCandidate,
  defaultParams,
  type NCandidateAlgo,
  type NCandidateColorspace,
  type NCandidateParams,
} from "../fixtures/nCandidateReference";

// Does the fragment shader actually implement the algorithm? The unit tests pin
// the CPU oracle's math; this pins the shader to the oracle. jsdom can't compile
// shaders, so this is the only layer where that comparison can happen.
// See docs/plan/055-n-candidate-dithering.md.

test.setTimeout(120_000);

const WIDTH = 24;
const HEIGHT = 24;

const PICO8 = [
  [0, 0, 0, 255], [29, 43, 83, 255], [126, 37, 83, 255], [0, 135, 81, 255],
  [171, 82, 54, 255], [95, 87, 79, 255], [194, 195, 199, 255], [255, 241, 232, 255],
  [255, 0, 77, 255], [255, 163, 0, 255], [255, 236, 39, 255], [0, 228, 54, 255],
  [41, 173, 255, 255], [131, 118, 156, 255], [255, 119, 168, 255], [255, 204, 170, 255],
];

// A smooth two-axis gradient with a luma ramp — exercises far more of the
// candidate search than flat colour, and is deterministic.
const makeSource = () => {
  const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4;
      rgba[i] = (x / (WIDTH - 1)) * 255;
      rgba[i + 1] = (y / (HEIGHT - 1)) * 255;
      rgba[i + 2] = ((x + y) / (WIDTH + HEIGHT - 2)) * 255;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
};

// The filter's UI options, and the oracle params that must mean the same thing.
const paramsFor = (over: Partial<NCandidateParams>): NCandidateParams => ({
  ...defaultParams,
  ...over,
});

const optionsFor = (algo: NCandidateAlgo, over: Record<string, unknown> = {}) => ({
  algo,
  candidates: 32,
  strength: 0.8,
  minT: 0.2,
  constantT: 0.3,
  sweepTests: 8,
  lumaWeighted: false,
  colorspace: "SRGB",
  thresholdMap: "NC_BAYER_4X4",
  palette: { options: { colors: PICO8 } },
  ...over,
});

type Case = {
  name: string;
  options: Record<string, unknown>;
  params: Partial<NCandidateParams>;
};

const CASES: Case[] = [
  { name: "EMA-Exact", options: optionsFor("EMA_EXACT"), params: { algo: "EMA_EXACT" } },
  { name: "EMA-Constant", options: optionsFor("EMA_CONSTANT"), params: { algo: "EMA_CONSTANT" } },
  { name: "Knoll", options: optionsFor("KNOLL"), params: { algo: "KNOLL" } },
  { name: "EMA-Sweep", options: optionsFor("EMA_SWEEP"), params: { algo: "EMA_SWEEP" } },
  {
    name: "EMA-Sweep (luma-weighted, original Yliluoma-2)",
    options: optionsFor("EMA_SWEEP", { lumaWeighted: true }),
    params: { algo: "EMA_SWEEP", lumaWeighted: true },
  },
  {
    name: "EMA-Exact (linear)",
    options: optionsFor("EMA_EXACT", { colorspace: "LINEAR" }),
    params: { algo: "EMA_EXACT", colorspace: "LINEAR" as NCandidateColorspace },
  },
  {
    name: "EMA-Exact (luma-weighted colorspace)",
    options: optionsFor("EMA_EXACT", { colorspace: "LIQ" }),
    params: { algo: "EMA_EXACT", colorspace: "LIQ" as NCandidateColorspace },
  },
];

test("the GL shader matches the CPU reference for every algorithm", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

  await page.goto("/nc-parity.html");
  await expect(page.locator('[data-testid="status"]')).toHaveText("ready", { timeout: 30_000 });

  const source = makeSource();
  const sourceArray = Array.from(source);
  const palette = new Set(PICO8.map((c) => `${c[0]},${c[1]},${c[2]}`));
  const report: string[] = [];

  for (const testCase of CASES) {
    const rendered = await page.evaluate(
      ({ width, height, rgba, options }) =>
        (window as unknown as {
          __ncParity: { render: (r: unknown) => number[] | null };
        }).__ncParity.render({ width, height, rgba, options }),
      { width: WIDTH, height: HEIGHT, rgba: sourceArray, options: testCase.options },
    );
    expect(rendered, `${testCase.name}: harness returned no pixels`).toBeTruthy();

    const expected = ditherNCandidate(source, WIDTH, HEIGHT, PICO8, paramsFor(testCase.params));

    let exact = 0;
    let inPalette = 0;
    const total = WIDTH * HEIGHT;
    for (let i = 0; i < total; i++) {
      const o = i * 4;
      const got = `${rendered![o]},${rendered![o + 1]},${rendered![o + 2]}`;
      if (palette.has(got)) inPalette++;
      if (got === `${expected[o]},${expected[o + 1]},${expected[o + 2]}`) exact++;
    }

    // Whatever the shader does, it must never invent a colour.
    expect(inPalette, `${testCase.name}: emitted a non-palette colour`).toBe(total);

    // Every case agrees with the oracle on 100% of pixels on Chrome 146 /
    // SwiftShader. The margin exists only because the shader runs the candidate
    // search in float32 and the oracle in float64: where two candidates are
    // near-equidistant the argmin can flip, and one flip early in the loop
    // diverges the rest of that pixel's walk. That is a plausible few-pixel
    // difference on other GPUs, not a licence for the shader to drift.
    const agreement = exact / total;
    report.push(`${testCase.name}: ${(agreement * 100).toFixed(1)}% exact`);
    expect(
      agreement,
      `${testCase.name}: only ${(agreement * 100).toFixed(1)}% of pixels matched the CPU reference`,
    ).toBeGreaterThan(0.98);
  }

  console.log(`nc-parity:\n  ${report.join("\n  ")}`);
  expect(consoleErrors, "page logged console errors").toEqual([]);
});
