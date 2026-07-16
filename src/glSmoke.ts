// GL filter smoke check. Runs in a real browser so WebGL2 is available.
//
// For every registered filter we force WebGL acceleration and observe whether
// the browser actually compiles or draws through WebGL2. For every discovered
// GL path we:
//   1. render with default options in default and _linearize=true modes
//   2. render once per non-default ENUM value to exercise alternate shader
//      branches (e.g. bokeh shape, morphology mode, LCD subpixel layout)
//   3. require GL-only filters to issue a draw rather than silently returning
//      their input after a renderer failure
//   4. confirm each output is a contract-sized canvas with non-trivial alpha (catches
//      the "float-in-u8-clamped" bug the jsdom smoke was originally guarding,
//      plus any shader-compile/link failure on an enum branch)
// Aggregate pass/fail counts get written to window.__glSmokeResult and the
// page's status node; the Playwright spec reads both.

import {
  ENUM,
  filterIndex,
  getGLCtx,
  glAvailable,
  glUnavailableStub,
  vhsNtscGLUsingFloatPath,
} from "@gyng/ditherer-filters";
import { workerRPC } from "@gyng/ditherer-filters/client";

declare global {
  interface Window {
    __glSmokeResult?: {
      status: "ok" | "failed";
      passed: number;
      failed: number;
      skipped: number;
      glFilters: number;
      requiredGLFilters: number;
      shaderCompiles: number;
      programLinks: number;
      shaderFailures: number;
      drawCalls: number;
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
      const xBand = Math.floor((x / Math.max(1, w)) * 4) / 3;
      const yBand = Math.floor((y / Math.max(1, h)) * 4) / 3;
      data.data[i] = Math.round(Math.min(1, xBand) * 255);
      data.data[i + 1] = Math.round(Math.min(1, yBand) * 255);
      data.data[i + 2] = 255 - data.data[i];
      // Broad flat bands give edge shaders non-edge interiors, while the
      // central checker and color steps retain high-frequency signal content.
      if (x >= w / 4 && x < (w * 3) / 4 && y >= h / 4 && y < (h * 3) / 4) {
        const high = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 === 0;
        data.data[i] = high ? 245 : 10;
        data.data[i + 1] = high ? 245 : 24;
        data.data[i + 2] = high ? 245 : 48;
      }
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

const peakLuma = (canvas: HTMLCanvasElement | OffscreenCanvas): number => {
  const ctx = (canvas as HTMLCanvasElement).getContext(
    "2d",
    { willReadFrequently: true },
  ) as CanvasRenderingContext2D | null;
  if (!ctx) return -1;
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let high = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    high = Math.max(
      high,
      pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114,
    );
  }
  return high;
};

const runWorkerCrt = async (): Promise<{ ok: true } | { ok: false; reason: string }> => {
  const width = 16;
  const height = 16;
  const inputCanvas = makeGradientCanvas(width, height);
  const inputContext = inputCanvas.getContext("2d", { willReadFrequently: true });
  if (!inputContext) return { ok: false, reason: "worker CRT input has no 2d context" };
  const input = inputContext.getImageData(0, 0, width, height).data;
  const workerDefaults = { ...(filterIndex.rgbStripe.defaults ?? {}) };
  delete workerDefaults.palette;

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
  requiresGL?: boolean;
  temporal?: boolean;
};

// Intercept the browser's WebGL2 entry points instead of relying on filter
// metadata. This covers shared-pipeline renderers, older self-contained GL
// renderers, and worker-safe OffscreenCanvas implementations alike. A compile
// attempt lets us attribute an exception to GL even when drawing never starts.
let shaderCompiles = 0;
let programLinks = 0;
let drawCalls = 0;
const shaderFailureLogs: string[] = [];

const installGLCallTracking = (): void => {
  const proto = WebGL2RenderingContext.prototype;
  const compileShader = proto.compileShader;
  const linkProgram = proto.linkProgram;
  const drawArrays = proto.drawArrays;
  proto.compileShader = function trackedCompileShader(shader: WebGLShader): void {
    shaderCompiles += 1;
    compileShader.call(this, shader);
    if (!this.getShaderParameter(shader, this.COMPILE_STATUS)) {
      shaderFailureLogs.push(`compile: ${this.getShaderInfoLog(shader) || "no driver log"}`);
    }
  };
  proto.linkProgram = function trackedLinkProgram(program: WebGLProgram): void {
    programLinks += 1;
    linkProgram.call(this, program);
    if (!this.getProgramParameter(program, this.LINK_STATUS)) {
      shaderFailureLogs.push(`link: ${this.getProgramInfoLog(program) || "no driver log"}`);
    }
  };
  proto.drawArrays = function trackedDrawArrays(mode: number, first: number, count: number): void {
    drawCalls += 1;
    drawArrays.call(this, mode, first, count);
  };
};

const runtimeOptions = (): Record<string, unknown> => {
  const input = makeGradientCanvas(16, 16);
  const ctx = input.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("temporal fixture has no 2d context");
  const previous = ctx.getImageData(0, 0, input.width, input.height).data;
  // An inverted previous frame activates motion/EMA shaders instead of merely
  // compiling their idle passthrough. Keeping spatial detail avoids falsely
  // diagnosing filters that intentionally render history as black-frame bugs.
  for (let i = 0; i < previous.length; i += 4) {
    previous[i] = 255 - previous[i];
    previous[i + 1] = 255 - previous[i + 1];
    previous[i + 2] = 255 - previous[i + 2];
    previous[i + 3] = 255;
  }
  return {
    _webglAcceleration: true,
    _wasmAcceleration: false,
    _frameIndex: 2,
    _isAnimating: true,
    _prevInput: previous.slice(),
    _prevOutput: previous.slice(),
    _ema: Float32Array.from(previous),
  };
};

// A few filters have a meaningful GL path that their UI default deliberately
// leaves idle. These fixtures activate the real shader contract; they are not
// output snapshots or implementation-specific source assertions.
const shaderValidationOverrides = (
  name: string,
  defaults: Record<string, unknown>,
): Record<string, unknown> => {
  if (name === "Quantize") {
    const palette = defaults.palette as Record<string, unknown> | undefined;
    return {
      palette: {
        ...palette,
        options: {
          ...((palette?.options as Record<string, unknown> | undefined) ?? {}),
          colors: [[0, 0, 0], [255, 255, 255], [255, 64, 32]],
          colorDistanceAlgorithm: "RGB",
        },
      },
    };
  }
  if (name === "CRT Degauss") {
    return { triggerMode: "MOTION", triggerThreshold: 0.01 };
  }
  return {};
};

const outputScaleFor = (name: string): number =>
  name === "Pixel Art Upscale" ? 2 : 1;

type RunResult =
  | { ok: true; attemptedGL: boolean; drewGL: boolean }
  | { ok: false; attemptedGL: boolean; drewGL: boolean; reason: string };

const runOne = (
  filter: FilterLike,
  options: Record<string, unknown>,
  requireDynamicRange = false,
  requireGLDraw = false,
  outputScale = 1,
): RunResult => {
  const compilesBefore = shaderCompiles;
  const drawsBefore = drawCalls;
  const failuresBefore = shaderFailureLogs.length;
  const result = (ok: boolean, reason?: string): RunResult => {
    const attemptedGL = shaderCompiles > compilesBefore || drawCalls > drawsBefore;
    const drewGL = drawCalls > drawsBefore;
    if (ok) return { ok: true, attemptedGL, drewGL };
    return { ok: false, attemptedGL, drewGL, reason: reason ?? "unknown failure" };
  };
  const input = makeGradientCanvas(16, 16);
  let output: unknown;
  try {
    output = filter.func(input, options);
  } catch (e) {
    return result(false, `threw: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (shaderFailureLogs.length > failuresBefore) {
    const logs = shaderFailureLogs.slice(failuresBefore).join(" | ");
    return result(false, `shader compile/link failure: ${logs}`);
  }
  if (requireGLDraw && drawCalls === drawsBefore) {
    return result(false, "declares requiresGL but issued no WebGL draw (silent fallback)");
  }
  if (!output || typeof (output as { getContext?: unknown }).getContext !== "function") {
    return result(false, `returned non-canvas: ${typeof output}`);
  }
  const canvas = output as HTMLCanvasElement;
  const expectedSize = 16 * outputScale;
  if (canvas.width !== expectedSize || canvas.height !== expectedSize) {
    return result(false, `size drift ${canvas.width}x${canvas.height} (expected ${expectedSize}x${expectedSize})`);
  }
  const a = maxAlpha(canvas);
  if (a <= 100) {
    return result(false, `maxAlpha=${a} (expected > 100, a linearize bug likely)`);
  }
  const peak = peakLuma(canvas);
  if (peak < 8) {
    return result(false, `peakLuma=${peak.toFixed(2)} (opaque black output)`);
  }
  if (requireDynamicRange) {
    const range = lumaRange(canvas);
    if (range < 8) return result(false, `lumaRange=${range.toFixed(2)} (black/flat output)`);
  }
  return result(true);
};

const warmTemporalState = (
  filter: FilterLike,
  options: Record<string, unknown>,
): { ok: true } | { ok: false; reason: string } => {
  const failuresBefore = shaderFailureLogs.length;
  try {
    filter.func(makeGradientCanvas(16, 16), options);
  } catch (error) {
    return {
      ok: false,
      reason: `temporal warm-up threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (shaderFailureLogs.length > failuresBefore) {
    return {
      ok: false,
      reason: `temporal warm-up shader failure: ${shaderFailureLogs.slice(failuresBefore).join(" | ")}`,
    };
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
  installGLCallTracking();
  if (!glAvailable()) {
    const details = { reason: "WebGL2 unavailable in this browser" };
    if (statusNode) statusNode.textContent = "failed";
    if (detailsNode) detailsNode.textContent = JSON.stringify(details, null, 2);
    window.__glSmokeResult = { status: "failed", passed: 0, failed: 0, skipped: 0, glFilters: 0, requiredGLFilters: 0, shaderCompiles, programLinks, shaderFailures: shaderFailureLogs.length, drawCalls, failures: [{ name: "<runtime>", mode: "init", reason: details.reason }] };
    return;
  }

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let requiredGLFilters = 0;
  const glFilterNames = new Set<string>();
  const failures: { name: string; mode: string; reason: string }[] = [];

  const record = (
    name: string,
    mode: string,
    result: { ok: true } | { ok: false; reason: string },
  ) => {
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
    const f = filter as FilterLike;
    if (f.requiresGL) requiredGLFilters += 1;
    const defaults = (f.defaults as Record<string, unknown>) ?? {};
    const activated = shaderValidationOverrides(name, defaults);
    const scale = outputScaleFor(name);
    const requireDynamicRange = name === "VHS / NTSC";
    if (f.temporal) {
      const warmup0 = warmTemporalState(f, {
        ...defaults,
        ...activated,
        ...runtimeOptions(),
        _frameIndex: 0,
      });
      if (!warmup0.ok) {
        record(name, "warmup-frame-0", warmup0);
        continue;
      }
      const warmup1 = warmTemporalState(f, {
        ...defaults,
        ...activated,
        ...runtimeOptions(),
        _frameIndex: 1,
      });
      if (!warmup1.ok) {
        record(name, "warmup-frame-1", warmup1);
        continue;
      }
    }
    const defaultResult = runOne(
      f,
      { ...defaults, ...activated, ...runtimeOptions() },
      requireDynamicRange,
      f.requiresGL,
      scale,
    );

    // A CPU-only filter is just a discovery miss, not a GL validation result.
    // Exceptions from one are covered by the normal filter tests. If it tried
    // to compile or draw, however, it belongs to this gate and must pass.
    if (!f.requiresGL && !defaultResult.attemptedGL) {
      skipped += 1;
      continue;
    }

    glFilterNames.add(name);
    record(name, "default", defaultResult);
    if (!defaultResult.ok) continue;

    record(name, "linearize", runOne(
      f,
      { ...defaults, ...activated, ...runtimeOptions(), _linearize: true },
      requireDynamicRange,
      true,
      scale,
    ));

    for (const branch of enumBranches(f)) {
      const options = { ...defaults, ...activated, ...runtimeOptions(), [branch.key]: branch.value };
      record(name, `${branch.key}=${branch.label}`, runOne(
        f,
        options,
        requireDynamicRange,
        true,
        scale,
      ));
    }
    if (name === "VHS / NTSC") {
      const legacyOptions = { ...defaults, ...runtimeOptions() };
      delete legacyOptions.tapeSharpness;
      record(name, "legacy-state-without-tapeSharpness", runOne(f, legacyOptions, true, true));
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
  const details = {
    passed,
    failed,
    skipped,
    glFilters: glFilterNames.size,
    requiredGLFilters,
    shaderCompiles,
    programLinks,
    shaderFailures: shaderFailureLogs.length,
    drawCalls,
    failures,
  };
  if (statusNode) statusNode.textContent = status;
  if (detailsNode) detailsNode.textContent = JSON.stringify(details, null, 2);
  window.__glSmokeResult = { status, ...details };
};

void main().catch((error) => {
  const reason = error instanceof Error ? error.message : String(error);
  if (statusNode) statusNode.textContent = "failed";
  if (detailsNode) detailsNode.textContent = JSON.stringify({ reason }, null, 2);
  window.__glSmokeResult = { status: "failed", passed: 0, failed: 0, skipped: 0, glFilters: 0, requiredGLFilters: 0, shaderCompiles, programLinks, shaderFailures: shaderFailureLogs.length, drawCalls, failures: [{ name: "<runtime>", mode: "boot", reason }] };
  console.error("GL smoke failed:", error);
});
