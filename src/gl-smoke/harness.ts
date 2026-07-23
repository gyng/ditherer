import {
  acquireGradientCanvas,
  lumaRange,
  makeGradientCanvas,
  maxAlpha,
  peakLuma,
} from "./fixtures";
import { glCalls } from "./instrumentation";
import type { CheckResult, FilterLike } from "./types";

export type RunResult =
  | { ok: true; attemptedGL: boolean; drewGL: boolean }
  | { ok: false; attemptedGL: boolean; drewGL: boolean; reason: string };

export const runOne = (
  filter: FilterLike,
  options: Record<string, unknown>,
  requireDynamicRange = false,
  requireGLDraw = false,
  outputScale = 1,
  requireVisibleOutput = true,
  inputWidth = 16,
  inputHeight = inputWidth,
  inputFactory: (width: number, height: number) => HTMLCanvasElement = makeGradientCanvas,
): RunResult => {
  const compilesBefore = glCalls.shaderCompiles;
  const drawsBefore = glCalls.drawCalls;
  const failuresBefore = glCalls.shaderFailureLogs.length;
  const result = (ok: boolean, reason?: string): RunResult => {
    const attemptedGL = glCalls.shaderCompiles > compilesBefore || glCalls.drawCalls > drawsBefore;
    const drewGL = glCalls.drawCalls > drawsBefore;
    if (ok) return { ok: true, attemptedGL, drewGL };
    return { ok: false, attemptedGL, drewGL, reason: reason ?? "unknown failure" };
  };
  const input = inputFactory === makeGradientCanvas
    ? acquireGradientCanvas(inputWidth, inputHeight)
    : inputFactory(inputWidth, inputHeight);
  let output: unknown;
  try {
    output = filter.func(input, options);
  } catch (error) {
    return result(false, `threw: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (glCalls.shaderFailureLogs.length > failuresBefore) {
    return result(false, `shader compile/link failure: ${glCalls.shaderFailureLogs.slice(failuresBefore).join(" | ")}`);
  }
  if (requireGLDraw && glCalls.drawCalls === drawsBefore) {
    return result(false, "declares requiresGL but issued no WebGL draw (silent fallback)");
  }
  if (!output || typeof (output as { getContext?: unknown }).getContext !== "function") {
    return result(false, `returned non-canvas: ${typeof output}`);
  }
  const canvas = output as HTMLCanvasElement;
  const expectedWidth = inputWidth * outputScale;
  const expectedHeight = inputHeight * outputScale;
  if (canvas.width !== expectedWidth || canvas.height !== expectedHeight) {
    return result(false, `size drift ${canvas.width}x${canvas.height} (expected ${expectedWidth}x${expectedHeight})`);
  }
  if (requireVisibleOutput) {
    const alpha = maxAlpha(canvas);
    if (alpha <= 100) return result(false, `maxAlpha=${alpha} (expected > 100, a linearize bug likely)`);
    const peak = peakLuma(canvas);
    if (peak < 8) return result(false, `peakLuma=${peak.toFixed(2)} (opaque black output)`);
  }
  if (requireDynamicRange) {
    const range = lumaRange(canvas);
    if (range < 8) return result(false, `lumaRange=${range.toFixed(2)} (black/flat output)`);
  }
  return result(true);
};

export const runIdentity = (
  filter: FilterLike,
  options: Record<string, unknown>,
  tolerance: number,
): CheckResult => {
  const input = makeGradientCanvas(32, 32);
  const inputPixels = input.getContext("2d", { willReadFrequently: true })
    ?.getImageData(0, 0, 32, 32).data;
  const drawsBefore = glCalls.drawCalls;
  const failuresBefore = glCalls.shaderFailureLogs.length;
  let output: HTMLCanvasElement;
  try {
    output = filter.func(input, options) as HTMLCanvasElement;
  } catch (error) {
    return { ok: false, reason: `threw: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (glCalls.shaderFailureLogs.length > failuresBefore) {
    return { ok: false, reason: `shader failure: ${glCalls.shaderFailureLogs.slice(failuresBefore).join(" | ")}` };
  }
  if (glCalls.drawCalls === drawsBefore) return { ok: false, reason: "issued no WebGL draw" };
  const outputPixels = output.getContext("2d", { willReadFrequently: true })
    ?.getImageData(0, 0, 32, 32).data;
  if (!inputPixels || !outputPixels || inputPixels.length !== outputPixels.length) {
    return { ok: false, reason: "pixel readback failed or changed size" };
  }
  let maximumDelta = 0;
  for (let index = 0; index < inputPixels.length; index += 1) {
    maximumDelta = Math.max(maximumDelta, Math.abs(inputPixels[index] - outputPixels[index]));
  }
  return maximumDelta <= tolerance
    ? { ok: true }
    : { ok: false, reason: `max channel delta=${maximumDelta} (expected <=${tolerance})` };
};

export const runEquivalent = (
  filter: FilterLike,
  leftOptions: Record<string, unknown>,
  rightOptions: Record<string, unknown>,
  tolerance: number,
): CheckResult => {
  const render = (options: Record<string, unknown>): HTMLCanvasElement | null => {
    try {
      return filter.func(makeGradientCanvas(32, 32), options) as HTMLCanvasElement;
    } catch {
      return null;
    }
  };
  const left = render(leftOptions);
  const right = render(rightOptions);
  const leftContext = left?.getContext("2d", { willReadFrequently: true });
  const rightContext = right?.getContext("2d", { willReadFrequently: true });
  if (!leftContext || !rightContext) return { ok: false, reason: "render or readback failed" };
  const leftPixels = leftContext.getImageData(0, 0, 32, 32).data;
  const rightPixels = rightContext.getImageData(0, 0, 32, 32).data;
  let maximumDelta = 0;
  for (let index = 0; index < leftPixels.length; index += 1) {
    maximumDelta = Math.max(maximumDelta, Math.abs(leftPixels[index] - rightPixels[index]));
  }
  return maximumDelta <= tolerance
    ? { ok: true }
    : { ok: false, reason: `max channel delta=${maximumDelta} (expected <=${tolerance})` };
};
