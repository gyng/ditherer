import { describe, expect, it } from "vitest";
import {
  airlightComposite,
  koschmiederTransmission,
  linearExposure,
  solarizeCurve,
} from "../../packages/ditherer-filters/src/filters/toneTransferContracts";
import { srgbToLinear } from "../../packages/ditherer-filters/src/filters/opticalConvolutionContracts";

describe("solarize (Sabattier) curve", () => {
  it("is identity at zero strength", () => {
    for (const t of [0, 0.2, 0.5, 0.8, 1]) {
      expect(solarizeCurve(t, 0.5, 0)).toBeCloseTo(t, 6);
    }
  });

  it("reverses highlights toward black at full strength", () => {
    // Below the reversal point tone is preserved; the brightest input folds to
    // black — the defining Sabattier reversal (not a per-channel invert).
    expect(solarizeCurve(0, 0.5, 1)).toBeCloseTo(0, 6);
    expect(solarizeCurve(1, 0.5, 1)).toBeCloseTo(0, 6);
    expect(solarizeCurve(0.75, 0.5, 1)).toBeLessThan(0.5);
  });

  it("humps at the reversal point (rises then falls), continuously", () => {
    const r = 0.5;
    const samples = [];
    for (let t = 0; t <= 1.0001; t += 0.05) samples.push(solarizeCurve(t, r, 1));
    // Peak is near the reversal point, above both ends.
    const peak = Math.max(...samples);
    expect(solarizeCurve(r, r, 1)).toBeGreaterThan(0.4);
    expect(peak).toBeGreaterThan(samples[0]);
    expect(peak).toBeGreaterThan(samples[samples.length - 1]);
    // Continuity: no adjacent sample jumps more than a smooth step could.
    for (let i = 1; i < samples.length; i++) {
      expect(Math.abs(samples[i] - samples[i - 1])).toBeLessThan(0.2);
    }
  });

  it("stays within range and guards malformed input", () => {
    expect(solarizeCurve(0.6, Number.NaN, 1)).toBeGreaterThanOrEqual(0);
    expect(solarizeCurve(2, 0.5, 5)).toBeLessThanOrEqual(1);
    expect(solarizeCurve(-1, 0.5, 1)).toBeGreaterThanOrEqual(0);
  });
});

describe("Koschmieder airlight", () => {
  it("is exponential, not linear, in depth", () => {
    expect(koschmiederTransmission(0, 2)).toBeCloseTo(1, 6); // nearest: no haze
    expect(koschmiederTransmission(1, 2)).toBeCloseTo(Math.exp(-2), 6);
    // Exponential falloff: the drop over [0,0.5] exceeds the drop over [0.5,1].
    const dNear = koschmiederTransmission(0, 2) - koschmiederTransmission(0.5, 2);
    const dFar = koschmiederTransmission(0.5, 2) - koschmiederTransmission(1, 2);
    expect(dNear).toBeGreaterThan(dFar);
  });

  it("composites airlight in linear light", () => {
    // Full transmission keeps the source; zero transmission is pure airlight.
    expect(airlightComposite(0.2, 0.9, 1)).toBeCloseTo(0.2, 6);
    expect(airlightComposite(0.2, 0.9, 0)).toBeCloseTo(0.9, 6);
    expect(airlightComposite(0.2, 0.9, 0.5)).toBeCloseTo(0.55, 6);
  });
});

describe("linear-light exposure (dodge/burn)", () => {
  it("brightens/darkens in linear light, not gamma space", () => {
    expect(linearExposure(0.5, 1)).toBeCloseTo(0.5, 6); // no change
    expect(linearExposure(0.5, 2)).toBeGreaterThan(0.5); // dodge brightens
    expect(linearExposure(0.5, 0.5)).toBeLessThan(0.5); // burn darkens
    // Doubling exposure doubles the LINEAR value, not the sRGB value.
    expect(srgbToLinear(linearExposure(0.5, 2))).toBeCloseTo(srgbToLinear(0.5) * 2, 6);
  });

  it("clamps and guards", () => {
    expect(linearExposure(0.9, 10)).toBeLessThanOrEqual(1);
    expect(linearExposure(0.5, Number.NaN)).toBeCloseTo(0.5, 6);
    expect(linearExposure(0.5, -1)).toBeCloseTo(0, 6);
  });
});
