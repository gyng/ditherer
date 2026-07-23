import { describe, expect, it } from "vitest";
import {
  brightPassLinear,
  channelMedian,
  gaussianKernel1D,
  gaussianWeight,
  linearToSrgb,
  sigmaForRadius,
  srgbToLinear,
  thresholdedMedianPick,
} from "../../packages/ditherer-filters/src/filters/opticalConvolutionContracts";

describe("optical convolution: Gaussian kernel", () => {
  it("is normalised, symmetric, and centre-peaked (not a box)", () => {
    const k = gaussianKernel1D(4);
    const sum = k.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(k.length).toBe(9);
    for (let i = 0; i < k.length; i++) {
      expect(k[i]).toBeCloseTo(k[k.length - 1 - i], 12); // symmetric
    }
    const mid = k.length >> 1;
    expect(k[mid]).toBeGreaterThan(k[0]);          // peaked at centre
    expect(k[mid]).toBeGreaterThan(k[mid - 1]);
    // A box kernel would be uniform; a Gaussian must not be.
    expect(k[mid]).toBeGreaterThan((1 / k.length) * 1.5);
  });

  it("widens sigma with radius", () => {
    expect(sigmaForRadius(3)).toBeCloseTo(1, 6);
    expect(sigmaForRadius(30)).toBeGreaterThan(sigmaForRadius(3));
    expect(gaussianWeight(0, 1)).toBe(1);
    expect(gaussianWeight(2, 1)).toBeLessThan(gaussianWeight(1, 1));
  });

  it("guards malformed radius/sigma", () => {
    expect(gaussianKernel1D(Number.NaN).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(Number.isFinite(gaussianWeight(1, Number.NaN))).toBe(true);
  });
});

describe("optical convolution: median despeckle", () => {
  it("takes the median of a window", () => {
    expect(channelMedian([10, 10, 250, 10, 10])).toBe(10);
    expect(channelMedian([1, 2, 3, 4])).toBe(2.5);
    expect(channelMedian([])).toBe(0);
  });

  it("removes an impulse but preserves values within threshold", () => {
    // A salt impulse (250 vs a flat 10 field) is replaced by the median.
    expect(thresholdedMedianPick(250, 10, 15)).toBe(10);
    // A pixel close to its median (a smooth region / edge side) is kept.
    expect(thresholdedMedianPick(12, 10, 15)).toBe(12);
    // Boundary: exactly at threshold is kept (not an outlier).
    expect(thresholdedMedianPick(25, 10, 15)).toBe(25);
    expect(thresholdedMedianPick(26, 10, 15)).toBe(10);
  });
});

describe("optical convolution: linear-light response", () => {
  it("round-trips the sRGB EOTF", () => {
    for (const c of [0, 0.02, 0.25, 0.5, 0.75, 1]) {
      expect(linearToSrgb(srgbToLinear(c))).toBeCloseTo(c, 6);
    }
    // Mid grey sRGB is much darker in linear light.
    expect(srgbToLinear(0.5)).toBeLessThan(0.25);
  });

  it("passes only energy above the threshold, monotonically", () => {
    expect(brightPassLinear(0.2, 0.5)).toBe(0);
    expect(brightPassLinear(0.5, 0.5)).toBe(0);
    expect(brightPassLinear(0.75, 0.5)).toBeCloseTo(0.5, 6);
    expect(brightPassLinear(1, 0.5)).toBeCloseTo(1, 6);
    expect(brightPassLinear(0.9, 0.5)).toBeGreaterThan(brightPassLinear(0.7, 0.5));
  });
});
