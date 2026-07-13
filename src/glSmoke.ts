// GL filter smoke check. Runs in a real browser so WebGL2 is available.
//
// For every filter tagged requiresGL: true we:
//   1. render with default options in default and _linearize=true modes
//   2. render once per non-default ENUM value to exercise alternate shader
//      branches (e.g. bokeh shape, morphology mode, LCD subpixel layout)
//   3. confirm each output is a 16×16 canvas with non-trivial alpha (catches
//      the "float-in-u8-clamped" bug the jsdom smoke was originally guarding,
//      plus any shader-compile/link failure on an enum branch)
// Aggregate pass/fail counts get written to window.__glSmokeResult and the
// page's status node; the Playwright spec reads both.

import { filterIndex } from "filters";
import { getGLCtx, glAvailable, glUnavailableStub } from "gl";
import { ENUM } from "constants/controlTypes";
import { vhsNtscGLUsingFloatPath } from "filters/vhsNtscGL";
import { workerRPC } from "workers/workerRPC";

declare global {
  interface Window {
    __glSmokeResult?: {
      status: "ok" | "failed";
      passed: number;
      failed: number;
      skipped: number;
      failures: { name: string; mode: string; reason: string }[];
    };
  }
}

const statusNode = document.querySelector('[data-testid="status"]');
const detailsNode = document.querySelector('[data-testid="details"]');

const makeGradientCanvas = (w: number, h: number): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  const data = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data.data[i] = Math.round((x / Math.max(1, w - 1)) * 255);
      data.data[i + 1] = Math.round((y / Math.max(1, h - 1)) * 255);
      data.data[i + 2] = 255 - data.data[i];
      data.data[i + 3] = 255;
    }
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
};

const maxAlpha = (canvas: HTMLCanvasElement | OffscreenCanvas): number => {
  const ctx = (canvas as HTMLCanvasElement).getContext(
    "2d",
    { willReadFrequently: true },
  ) as CanvasRenderingContext2D | null;
  if (!ctx) return -1;
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let m = 0;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] > m) m = pixels[i];
  }
  return m;
};

const lumaRange = (canvas: HTMLCanvasElement | OffscreenCanvas): number => {
  const ctx = (canvas as HTMLCanvasElement).getContext(
    "2d",
    { willReadFrequently: true },
  ) as CanvasRenderingContext2D | null;
  if (!ctx) return -1;
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let low = 255;
  let high = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const luma = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
    low = Math.min(low, luma);
    high = Math.max(high, luma);
  }
  return high - low;
};

const runWorkerCrt = async (): Promise<{ ok: true } | { ok: false; reason: string }> => {
  const width = 16;
  const height = 16;
  const inputCanvas = makeGradientCanvas(width, height);
  const inputContext = inputCanvas.getContext("2d", { willReadFrequently: true });
  if (!inputContext) return { ok: false, reason: "worker CRT input has no 2d context" };
  const input = inputContext.getImageData(0, 0, width, height).data;
  const { palette: _palette, ...workerDefaults } = filterIndex.rgbStripe.defaults ?? {};

  try {
    const result = await workerRPC({
      imageData: input.slice().buffer,
      width,
      height,
      chain: [{
        id: "crt-worker-smoke",
        filterName: "rgbStripe",
        displayName: "CRT emulation",
        options: workerDefaults,
      }],
      frameIndex: 0,
      isAnimating: false,
      linearize: false,
      wasmAcceleration: false,
      webglAcceleration: true,
      convertGrayscale: false,
      prevOutputs: {},
      prevInputs: {},
      emaMaps: {},
      degaussFrame: -2147483648,
    });
    const output = new Uint8ClampedArray(result.imageData);
    let changedChannels = 0;
    for (let i = 0; i < output.length; i += 4) {
      if (output[i] !== input[i]) changedChannels += 1;
      if (output[i + 1] !== input[i + 1]) changedChannels += 1;
      if (output[i + 2] !== input[i + 2]) changedChannels += 1;
    }
    return changedChannels > width * height
      ? { ok: true }
      : { ok: false, reason: `worker CRT changed only ${changedChannels} color channels` };
  } catch (error) {
    return { ok: false, reason: `worker CRT threw: ${error instanceof Error ? error.message : String(error)}` };
  }
};

type FilterLike = {
  func: (input: unknown, options: unknown) => unknown;
  defaults?: Record<string, unknown>;
  optionTypes?: Record<string, { type?: string; options?: { value: unknown }[] }>;
};

const runOne = (
  filter: FilterLike,
  options: Record<string, unknown>,
  requireDynamicRange = false,
): { ok: true } | { ok: false; reason: string } => {
  const input = makeGradientCanvas(16, 16);
  let output: unknown;
  try {
    output = filter.func(input, options);
  } catch (e) {
    return { ok: false, reason: `threw: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!output || typeof (output as { getContext?: unknown }).getContext !== "function") {
    return { ok: false, reason: `returned non-canvas: ${typeof output}` };
  }
  const canvas = output as HTMLCanvasElement;
  if (canvas.width !== 16 || canvas.height !== 16) {
    return { ok: false, reason: `size drift ${canvas.width}x${canvas.height}` };
  }
  const a = maxAlpha(canvas);
  if (a <= 100) {
    return { ok: false, reason: `maxAlpha=${a} (expected > 100, a linearize bug likely)` };
  }
  if (requireDynamicRange) {
    const range = lumaRange(canvas);
    if (range < 8) return { ok: false, reason: `lumaRange=${range.toFixed(2)} (black/flat output)` };
  }
  return { ok: true };
};

// Yield every alternate enum value (i.e. everything except the current default)
// as { optionKey, label, overrideValue } triples, so the main loop can build
// option objects and tag failures with the specific branch that broke.
const enumBranches = (
  filter: FilterLike,
): { key: string; label: string; value: unknown }[] => {
  const out: { key: string; label: string; value: unknown }[] = [];
  const defs = filter.optionTypes;
  const defaults = filter.defaults ?? {};
  if (!defs) return out;
  for (const [key, spec] of Object.entries(defs)) {
    if (spec?.type !== ENUM || !Array.isArray(spec.options)) continue;
    const currentDefault = defaults[key];
    for (const entry of spec.options) {
      if (entry.value === currentDefault) continue;
      out.push({ key, label: String(entry.value), value: entry.value });
    }
  }
  return out;
};

const main = async () => {
  if (!glAvailable()) {
    const details = { reason: "WebGL2 unavailable in this browser" };
    if (statusNode) statusNode.textContent = "failed";
    if (detailsNode) detailsNode.textContent = JSON.stringify(details, null, 2);
    window.__glSmokeResult = { status: "failed", passed: 0, failed: 0, skipped: 0, failures: [{ name: "<runtime>", mode: "init", reason: details.reason }] };
    return;
  }

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  const failures: { name: string; mode: string; reason: string }[] = [];

  const record = (name: string, mode: string, result: ReturnType<typeof runOne>) => {
    if (result.ok) passed += 1;
    else { failed += 1; failures.push({ name, mode, reason: result.reason }); }
  };

  // Stub plate contract: amber-on-dark, fully opaque, correct size. Only
  // observable where a real 2d rasteriser exists (not jsdom), so the check
  // lives here next to the filter sweep.
  {
    const stub = glUnavailableStub(48, 32) as HTMLCanvasElement;
    const check = ((): { ok: true } | { ok: false; reason: string } => {
      if (stub.width !== 48 || stub.height !== 32) {
        return { ok: false, reason: `stub size drift ${stub.width}x${stub.height}` };
      }
      const ctx = stub.getContext("2d");
      if (!ctx) return { ok: false, reason: "stub has no 2d context" };
      const pixels = ctx.getImageData(0, 0, stub.width, stub.height).data;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] !== 255) return { ok: false, reason: `stub alpha=${pixels[i]} at idx ${i}` };
      }
      const corner = (x: number, y: number) => {
        const idx = (y * stub.width + x) * 4;
        return [pixels[idx], pixels[idx + 1], pixels[idx + 2]];
      };
      const plate = corner(1, 1);
      if (plate[0] !== 26 || plate[1] !== 26 || plate[2] !== 26) {
        return { ok: false, reason: `stub plate=${plate.join(",")} (expected 26,26,26)` };
      }
      let sawAmber = false;
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        if (r > 180 && g > 100 && g < 220 && b < 120) { sawAmber = true; break; }
      }
      if (!sawAmber) return { ok: false, reason: "stub amber text missing" };
      return { ok: true };
    })();
    record("<glUnavailableStub>", "plate", check);
  }

  for (const [name, filter] of Object.entries(filterIndex)) {
    const f = filter as FilterLike & { requiresGL?: boolean };
    if (!f.requiresGL) { skipped += 1; continue; }

    const defaults = (f.defaults as Record<string, unknown>) ?? {};
    record(name, "default", runOne(f, { ...defaults }));
    record(name, "linearize", runOne(f, { ...defaults, _linearize: true }));

    for (const branch of enumBranches(f)) {
      const options = { ...defaults, [branch.key]: branch.value };
      record(name, `${branch.key}=${branch.label}`, runOne(f, options));
    }
    if (name === "VHS / NTSC") {
      const legacyOptions = { ...defaults };
      delete legacyOptions.tapeSharpness;
      record(name, "legacy-state-without-tapeSharpness", runOne(f, legacyOptions, true));
      const floatCapable = Boolean(getGLCtx()?.gl.getExtension("EXT_color_buffer_float"));
      if (floatCapable && !vhsNtscGLUsingFloatPath()) {
        record(name, "RGBA16F-capability-selection", {
          ok: false,
          reason: "EXT_color_buffer_float is available but the RGBA8 fallback was used",
        });
      }
    }
  }

  record("rgbStripe", "worker", await runWorkerCrt());

  const status: "ok" | "failed" = failed === 0 ? "ok" : "failed";
  const details = { passed, failed, skipped, failures };
  if (statusNode) statusNode.textContent = status;
  if (detailsNode) detailsNode.textContent = JSON.stringify(details, null, 2);
  window.__glSmokeResult = { status, ...details };
};

void main().catch((error) => {
  const reason = error instanceof Error ? error.message : String(error);
  if (statusNode) statusNode.textContent = "failed";
  if (detailsNode) detailsNode.textContent = JSON.stringify({ reason }, null, 2);
  window.__glSmokeResult = { status: "failed", passed: 0, failed: 0, skipped: 0, failures: [{ name: "<runtime>", mode: "boot", reason }] };
  console.error("GL smoke failed:", error);
});
