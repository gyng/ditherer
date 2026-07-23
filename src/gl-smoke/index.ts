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
  filterIndex,
  getGLCtx,
  glAvailable,
  glUnavailableStub,
  nearest,
  user,
  vhsNtscGLUsingFloatPath,
} from "@gyng/ditherer-filters";
import {
  runApolloFractionalHold,
  runAppleHgrDotContract,
  runCgaRgbiPalette,
  runGameboyThresholdMatrix,
  runPalDelayLineCancellation,
  runPxlCaptureHold,
  runSpectrumAttributeContract,
  runTeletextRepeatConcealment,
} from "./contracts/standards";
import {
  acquireGradientCanvas,
  makeSmoothRamp,
  runtimeOptions,
} from "./fixtures";
import { glCalls, installGLCallTracking } from "./instrumentation";
import { runEquivalent, runIdentity, runOne } from "./harness";
import { runContractSuites } from "./contractRunner";
import { numericalContractSuites } from "./suites";
import {
  STRICT_SPEC_FILTERS,
  enumBranches,
  enumOptionKeys,
  hasPaletteControl,
  migratedEnumDefaults,
  migratedScalarDefaults,
  outputScaleFor,
  scalarOptionKeys,
  scalarProfiles,
  shaderValidationOverrides,
} from "./profiles";
import type { FilterLike, GlSmokeResult } from "./types";

declare global {
  interface Window {
    __glSmokeResult?: GlSmokeResult;
  }
}

const statusNode = document.querySelector('[data-testid="status"]');
const detailsNode = document.querySelector('[data-testid="details"]');
const bootStartedAt = performance.now();

const warmTemporalState = (
  filter: FilterLike,
  options: Record<string, unknown>,
): { ok: true } | { ok: false; reason: string } => {
  const failuresBefore = glCalls.shaderFailureLogs.length;
  try {
    filter.func(acquireGradientCanvas(16, 16), options);
  } catch (error) {
    return {
      ok: false,
      reason: `temporal warm-up threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (glCalls.shaderFailureLogs.length > failuresBefore) {
    return {
      ok: false,
      reason: `temporal warm-up shader failure: ${glCalls.shaderFailureLogs.slice(failuresBefore).join(" | ")}`,
    };
  }
  return { ok: true };
};


const main = async () => {
  const startedAt = performance.now();
  installGLCallTracking();
  if (!glAvailable()) {
    const details = { reason: "WebGL2 unavailable in this browser" };
    if (statusNode) statusNode.textContent = "failed";
    if (detailsNode) detailsNode.textContent = JSON.stringify(details, null, 2);
    window.__glSmokeResult = {
      status: "failed",
      passed: 0,
      failed: 0,
      skipped: 0,
      glFilters: 0,
      requiredGLFilters: 0,
      shaderCompiles: glCalls.shaderCompiles,
      programLinks: glCalls.programLinks,
      shaderFailures: glCalls.shaderFailureLogs.length,
      drawCalls: glCalls.drawCalls,
      timings: { totalMs: performance.now() - startedAt, registryMs: 0, contractsMs: 0, suitesMs: {} },
      failures: [{ name: "<runtime>", mode: "init", reason: details.reason }],
    };
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

  const registryStartedAt = performance.now();
  for (const [name, filter] of Object.entries(filterIndex)) {
    const f = filter as FilterLike;
    if (f.requiresGL) requiredGLFilters += 1;
    const defaults = (f.defaults as Record<string, unknown>) ?? {};
    const activated = shaderValidationOverrides(name, defaults);
    const scale = outputScaleFor(name);
    const requireDynamicRange = name === "VHS / NTSC" || STRICT_SPEC_FILTERS.has(name);
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

    if (!f.requiresGL) {
      record(name, "webgl-acceleration-disabled", runOne(
        f,
        {
          ...defaults,
          ...activated,
          ...runtimeOptions(),
          _webglAcceleration: false,
        },
        false,
        false,
        scale,
      ));
    }

    record(name, "linearize", runOne(
      f,
      { ...defaults, ...activated, ...runtimeOptions(), _linearize: true },
      requireDynamicRange,
      true,
      scale,
    ));

    if (name === "Teletext") {
      record(name, "oversized-49px-cells", runOne(
        f,
        { ...defaults, ...runtimeOptions() },
        true,
        true,
        1,
        true,
        1960,
        24,
      ));
      record(name, "repeat-row-concealment", runTeletextRepeatConcealment());
    }
    if (name === "PAL / SECAM") {
      record(name, "delay-line-phase-cancellation", runPalDelayLineCancellation());
    }
    if (name === "Gameboy Camera") {
      record(name, "4x4-controller-threshold-matrix", runGameboyThresholdMatrix());
      record(name, "malformed-state-falls-back", runEquivalent(
        f,
        { ...defaults, ...runtimeOptions() },
        {
          ...defaults,
          ...runtimeOptions(),
          invertSensor: "false",
          edgeMode: "INVALID",
        },
        1,
      ));
      record(name, "extreme-wide-aspect", runOne(
        f,
        { ...defaults, ...runtimeOptions() },
        true,
        true,
        1,
        true,
        2048,
        2,
        makeSmoothRamp,
      ));
    }
    if (name === "CGA Composite") {
      record(name, "legal-rgbi-palette", runCgaRgbiPalette());
    }
    if (name === "Apollo Slow-Scan TV") {
      record(name, "fractional-preview-disc-hold", runApolloFractionalHold());
    }
    if (name === "Apple II HGR") {
      record(name, "seven-dot-byte-artifact-colors", runAppleHgrDotContract());
    }
    if (name === "ZX Spectrum") {
      record(name, "two-colors-per-attribute-cell", runSpectrumAttributeContract());
    }
    if (name === "PXL-2000") {
      record(name, "15hz-ccd-frame-hold", runPxlCaptureHold());
    }
    if (name === "Wavelet Codec") {
      record(name, "53-profile-lossless-settings", runIdentity(f, {
        ...defaults,
        ...runtimeOptions(),
        transform: "REVERSIBLE_53",
        channels: "RGB",
        quality: 100,
        detailLoss: 0,
        bitplaneDrop: 0,
        codeblockLoss: 0,
        ringing: 0,
      }, 1));
    }

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
    for (const profile of scalarProfiles(f)) {
      record(name, profile.label, runOne(
        f,
        { ...defaults, ...activated, ...runtimeOptions(), ...profile.values },
        false,
        false,
        scale,
        false,
      ));
    }
    const scalarKeys = scalarOptionKeys(f);
    if (scalarKeys.length > 0 && !migratedScalarDefaults.has(name)) {
      const legacyOptions = { ...defaults, ...activated, ...runtimeOptions() };
      for (const key of scalarKeys) delete legacyOptions[key];
      const strictState = STRICT_SPEC_FILTERS.has(name);
      record(name, "legacy-state-without-scalars", runOne(
        f,
        legacyOptions,
        strictState,
        strictState,
        scale,
        strictState,
      ));
    }
    for (const key of enumOptionKeys(f)) {
      if (migratedEnumDefaults.has(`${name}:${key}`)) continue;
      const legacyOptions = { ...defaults, ...activated, ...runtimeOptions() };
      delete legacyOptions[key];
      const strictState = STRICT_SPEC_FILTERS.has(name);
      record(name, `legacy-state-without-${key}`, runOne(
        f,
        legacyOptions,
        strictState,
        strictState,
        scale,
        strictState,
      ));
    }
    if (hasPaletteControl(f) && name !== "Quantize") {
      record(name, "non-identity-palette", runOne(
        f,
        {
          ...defaults,
          ...activated,
          ...runtimeOptions(),
          palette: { ...nearest, options: { levels: 2 } },
        },
        false,
        true,
        scale,
        false,
      ));
    }
    if (hasPaletteControl(f)) {
      const customPalette = {
        ...user,
        options: {
          ...user.options,
          colors: [[0, 0, 0, 255], [255, 255, 255, 255], [255, 64, 32, 255]],
          colorDistanceAlgorithm: "RGB",
        },
      };
      record(name, "custom-palette", runOne(
        f,
        { ...defaults, ...activated, ...runtimeOptions(), palette: customPalette },
        false,
        true,
        scale,
        false,
      ));
      record(name, "custom-palette-linearized", runOne(
        f,
        {
          ...defaults,
          ...activated,
          ...runtimeOptions(),
          palette: customPalette,
          _linearize: true,
        },
        false,
        true,
        scale,
        false,
      ));
    }
    if (name === "VHS / NTSC") {
      for (const key of ["tapeSharpness", "ringingFrequency", "ringingPower"]) {
        const legacyOptions = { ...defaults, ...runtimeOptions() };
        delete legacyOptions[key];
        record(name, `legacy-state-without-${key}`, runOne(f, legacyOptions, true, true));
      }
      const floatCapable = Boolean(getGLCtx()?.gl.getExtension("EXT_color_buffer_float"));
      if (floatCapable && !vhsNtscGLUsingFloatPath()) {
        record(name, "RGBA16F-capability-selection", {
          ok: false,
          reason: "EXT_color_buffer_float is available but the RGBA8 fallback was used",
        });
      }
    }
  }

  const registryMs = performance.now() - registryStartedAt;
  const contractsStartedAt = performance.now();
  const suitesMs = await runContractSuites(numericalContractSuites(), record);

  const contractsMs = performance.now() - contractsStartedAt;

  const status: "ok" | "failed" = failed === 0 ? "ok" : "failed";
  const details = {
    passed,
    failed,
    skipped,
    glFilters: glFilterNames.size,
    requiredGLFilters,
    shaderCompiles: glCalls.shaderCompiles,
    programLinks: glCalls.programLinks,
    shaderFailures: glCalls.shaderFailureLogs.length,
    drawCalls: glCalls.drawCalls,
    timings: {
      totalMs: performance.now() - startedAt,
      registryMs,
      contractsMs,
      suitesMs,
    },
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
  window.__glSmokeResult = {
    status: "failed",
    passed: 0,
    failed: 0,
    skipped: 0,
    glFilters: 0,
    requiredGLFilters: 0,
    shaderCompiles: glCalls.shaderCompiles,
    programLinks: glCalls.programLinks,
    shaderFailures: glCalls.shaderFailureLogs.length,
    drawCalls: glCalls.drawCalls,
    timings: { totalMs: performance.now() - bootStartedAt, registryMs: 0, contractsMs: 0, suitesMs: {} },
    failures: [{ name: "<runtime>", mode: "boot", reason }],
  };
  console.error("GL smoke failed:", error);
});
