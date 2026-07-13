import { describe, expect, it } from "vitest";

import {
  SplitMix64,
  TAPE_PROFILES,
  alternatingLineEnergy,
  applyCausalKernel,
  frequencyMagnitude,
  makeCompositePreemphasisKernel,
  makeLowpassKernel,
  makeLumaSmearKernel,
  makeConformancePattern,
  makeNoisePlane,
  makeNotchKernel,
  makeRowNoisePlane,
  makeRestorationKernel,
  makeRingingKernel,
  makeSharpenKernel,
  peakIndex,
  stepOvershoot,
  simplex1d,
  simplex2d,
  type TapeFilterType,
} from "filters/vhsNtscConformance";

const sum = (values: ArrayLike<number>) => Array.from(values).reduce((a, b) => a + b, 0);

describe("ntsc-rs tape transfer conformance", () => {
  it.each(["BUTTERWORTH", "CONSTANT_K"] satisfies TapeFilterType[])(
    "%s kernels preserve DC and order SP > LP > EP at high luma frequencies",
    (filterType) => {
      const kernels = (["SP", "LP", "EP"] as const).map((speed) =>
        makeLowpassKernel(TAPE_PROFILES[speed].lumaCutoff, filterType),
      );
      for (const kernel of kernels) {
        expect(kernel).toHaveLength(65);
        expect(Array.from(kernel).every(Number.isFinite)).toBe(true);
        expect(sum(kernel)).toBeCloseTo(1, 5);
      }
      const magnitudes = kernels.map((kernel) => frequencyMagnitude(kernel, Math.PI * 0.35));
      expect(magnitudes[0]).toBeGreaterThan(magnitudes[1]);
      expect(magnitudes[1]).toBeGreaterThan(magnitudes[2]);
    },
  );

  it("uses the upstream four/five/six-sample chroma advance", () => {
    const impulse = new Float32Array(96);
    impulse[40] = 1;
    for (const speed of ["SP", "LP", "EP"] as const) {
      const profile = TAPE_PROFILES[speed];
      const kernel = makeLowpassKernel(profile.chromaCutoff, "BUTTERWORTH");
      const noAdvance = applyCausalKernel(impulse, kernel);
      const advanced = applyCausalKernel(impulse, kernel, profile.chromaDelay);
      const peak = (values: Float32Array) =>
        values.reduce((best, value, index) => value > values[best] ? index : best, 0);
      expect(peak(noAdvance) - peak(advanced)).toBe(profile.chromaDelay);
    }
  });

  it("keeps restoration and sharpen as stable unity-DC stages", () => {
    for (const kernel of [
      makeRestorationKernel(TAPE_PROFILES.LP.lumaCutoff),
      makeSharpenKernel(TAPE_PROFILES.LP.lumaCutoff, "BUTTERWORTH", 0.25),
    ]) {
      expect(sum(kernel)).toBeCloseTo(1, 5);
      expect(Array.from(kernel).every(Number.isFinite)).toBe(true);
      expect(frequencyMagnitude(kernel, Math.PI * 0.35)).toBeGreaterThan(1);
    }
  });

  it("matches upstream composite pre-emphasis instead of a neighbor unsharp mask", () => {
    const identity = makeCompositePreemphasisKernel(0);
    const upstreamDefault = makeCompositePreemphasisKernel(1);
    expect(identity[0]).toBe(1);
    expect(sum(upstreamDefault)).toBeCloseTo(1, 5);
    expect(frequencyMagnitude(upstreamDefault, Math.PI * 0.35)).toBeGreaterThan(1);
    expect(Array.from(upstreamDefault).every(Number.isFinite)).toBe(true);
  });

  it("matches upstream default smear and ringing transfer stages", () => {
    const smear = makeLumaSmearKernel(0.5);
    const ringing = makeRingingKernel(0.45, 4, 4);
    expect(sum(smear)).toBeCloseTo(1, 5);
    expect(sum(ringing)).toBeCloseTo(1, 5);
    expect(frequencyMagnitude(smear, Math.PI * 0.5)).toBeLessThan(0.5);
    expect(frequencyMagnitude(ringing, Math.PI * 0.45)).toBeGreaterThan(1);
  });

  it("calibrates the default demodulation notch at half the sample rate", () => {
    const notch = makeNotchKernel(0.5, 2, 1);
    expect(sum(notch)).toBeCloseTo(1, 5);
    expect(frequencyMagnitude(notch, Math.PI * 0.5)).toBeLessThan(0.5);
  });
});

describe("signal conformance fixtures and metrics", () => {
  it.each(["impulse", "step", "smpte", "zonePlate", "alternatingLines"] as const)(
    "generates a finite, bounded %s fixture",
    (pattern) => {
      const pixels = makeConformancePattern(pattern, 96, 48);
      expect(pixels).toHaveLength(96 * 48 * 3);
      expect(Array.from(pixels).every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
    },
  );

  it("measures causal group delay and sharpen edge overshoot", () => {
    const impulse = new Float32Array(192);
    impulse[64] = 1;
    const lowpass = makeLowpassKernel(TAPE_PROFILES.LP.lumaCutoff, "BUTTERWORTH");
    const filteredImpulse = applyCausalKernel(impulse, lowpass);
    expect(peakIndex(filteredImpulse)).toBeGreaterThanOrEqual(64);

    const step = new Float32Array(192);
    step.fill(1, 64);
    const restored = applyCausalKernel(
      applyCausalKernel(step, lowpass),
      makeRestorationKernel(TAPE_PROFILES.LP.lumaCutoff),
    );
    expect(stepOvershoot(restored)).toBeGreaterThan(0);
    expect(stepOvershoot(restored)).toBeLessThan(1);
  });

  it("quantifies alternating-line energy for comb-rejection comparisons", () => {
    const pattern = makeConformancePattern("alternatingLines", 8, 8);
    const luma = new Float32Array(64);
    for (let i = 0; i < luma.length; i++) luma[i] = pattern[i * 3];
    expect(alternatingLineEnergy(luma, 8)).toBe(1);
    const verticallyBlended = new Float32Array(64).fill(0.5);
    expect(alternatingLineEnergy(verticallyBlended, 8)).toBe(0);
  });
});

describe("ntsc-rs stochastic input conformance", () => {
  it("matches SplitMix64 reference vectors and stable mixing", () => {
    const rng = new SplitMix64(0);
    expect(rng.nextU64()).toBe(0xe220a8397b1dcdafn);
    expect(rng.nextU64()).toBe(0x6e789e6aa1b965f4n);
    expect(new SplitMix64(17).mix(4).mix(9).nextU32())
      .toBe(new SplitMix64(17).mix(4).mix(9).nextU32());
  });

  it("ports upstream 1D simplex without discontinuities at cell boundaries", () => {
    expect(Math.abs(simplex1d(0, 123))).toBe(0);
    expect(Math.abs(simplex1d(1, 123))).toBe(0);
    expect(Math.abs(simplex1d(0.9999, 123) - simplex1d(1.0001, 123))).toBeLessThan(0.01);
  });

  it("keeps upstream 2D simplex in the expected edge-wave amplitude range", () => {
    const samples = Array.from({ length: 256 }, (_, index) => simplex2d(index * 0.05, 1.2, 123));
    expect(Math.max(...samples.map(Math.abs))).toBeLessThan(0.08);
    expect(samples.some((value) => value > 0)).toBe(true);
    expect(samples.some((value) => value < 0)).toBe(true);
  });

  it("repeats a field stream exactly while separating adjacent field frames", () => {
    const a = makeNoisePlane(24, 6, 42, 20).data;
    const again = makeNoisePlane(24, 6, 42, 20).data;
    const otherField = makeNoisePlane(24, 6, 42, 21).data;
    expect(a).toEqual(again);
    expect(a).not.toEqual(otherField);
    expect(Array.from(a).every(Number.isFinite)).toBe(true);
  });

  it("generates deterministic sparse chroma-loss rows independently", () => {
    const rows = makeRowNoisePlane(10_000, 7, 3, 0.02).data;
    const events = Array.from({ length: 10_000 }, (_, y) => rows[y * 4 + 1])
      .reduce((total, value) => total + value, 0);
    expect(events).toBeGreaterThan(150);
    expect(events).toBeLessThan(250);
    expect(makeRowNoisePlane(64, 7, 3, 0.02).data)
      .toEqual(makeRowNoisePlane(64, 7, 3, 0.02).data);
  });
});
