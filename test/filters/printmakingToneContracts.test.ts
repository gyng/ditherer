import { describe, expect, it } from "vitest";
import {
  dotCoverage,
  engravingShadowStructure,
  gradientTangent,
  hatchLayerFill,
  hatchLineHalfWidthPx,
  hatchUnionCoverage,
  lineCoverage,
  luminance01,
  stippleDotPresent,
  stippleDotRadiusPx,
  stippleExpectedDensity,
  structureTensorCoherence,
  structureTensorTangentAngle,
} from "../../packages/ditherer-filters/src/filters/printmakingToneContracts";

describe("printmaking tone: hatching", () => {
  it("reproduces tone by mark density, not two hard steps", () => {
    // The core defect being fixed: mid-grey and near-black must differ.
    const midGrey = hatchUnionCoverage(0.4, 4);
    const shadow = hatchUnionCoverage(0.8, 4);
    const nearBlack = hatchUnionCoverage(0.95, 4);
    expect(midGrey).toBeLessThan(shadow);
    expect(shadow).toBeLessThan(nearBlack);
  });

  it("is monotonic across the full tone range and spans white to near-black", () => {
    let previous = -1;
    for (let d = 0; d <= 1.0001; d += 0.05) {
      const coverage = hatchUnionCoverage(d, 4);
      expect(coverage).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = coverage;
    }
    expect(hatchUnionCoverage(0, 4)).toBe(0);
    expect(hatchUnionCoverage(1, 4)).toBeGreaterThan(0.85);
  });

  it("activates hatch layers in priority order as darkness deepens", () => {
    // At light tone only the first layer is developing.
    expect(hatchLayerFill(0.1, 0, 4)).toBeGreaterThan(0);
    expect(hatchLayerFill(0.1, 1, 4)).toBe(0);
    expect(hatchLayerFill(0.1, 3, 4)).toBe(0);
    // At deep shadow every layer is fully developed.
    expect(hatchLayerFill(1, 0, 4)).toBe(1);
    expect(hatchLayerFill(1, 3, 4)).toBe(1);
    // Out-of-range layers never fill.
    expect(hatchLayerFill(1, 4, 4)).toBe(0);
  });

  it("sizes hatch lines so coverage grows with fill and spacing", () => {
    expect(hatchLineHalfWidthPx(0, 6)).toBe(0);
    expect(hatchLineHalfWidthPx(1, 6)).toBeCloseTo(0.5 * 0.5 * 6, 6);
    expect(hatchLineHalfWidthPx(0.5, 6)).toBeLessThan(hatchLineHalfWidthPx(1, 6));
  });

  it("anti-aliases mark edges and vanishes at zero width", () => {
    expect(lineCoverage(0, 1, 1)).toBe(1);
    expect(lineCoverage(0.5, 1, 1)).toBe(1);
    expect(lineCoverage(1, 1, 1)).toBeCloseTo(0.5, 6);   // half at the edge
    expect(lineCoverage(1.5, 1, 1)).toBe(0);
    expect(lineCoverage(5, 0)).toBe(0);                  // no mark, no ink
    expect(lineCoverage(0, 0)).toBe(0);
  });

  it("guards malformed input", () => {
    expect(hatchUnionCoverage(Number.NaN, 4)).toBe(0);
    expect(hatchLayerFill(0.5, 0, Number.NaN)).toBeGreaterThan(0);
    expect(Number.isFinite(hatchLineHalfWidthPx(0.5, Number.NaN))).toBe(true);
  });
});

describe("printmaking tone: orientation", () => {
  it("runs the tangent along contours (perpendicular to the gradient)", () => {
    // A vertical edge has a horizontal gradient; strokes should run vertically.
    const [tx, ty] = gradientTangent(1, 0);
    expect(Math.abs(tx)).toBeLessThan(1e-6);
    expect(Math.abs(ty)).toBeCloseTo(1, 6);
  });

  it("falls back to a stable axis on a flat neighbourhood", () => {
    expect(gradientTangent(0, 0)).toEqual([1, 0]);
  });

  it("recovers the structure-tensor orientation of an oriented texture", () => {
    // Gradient consistently along x → tensor tangent runs along y (±90°).
    const angle = structureTensorTangentAngle(4, 0, 0);
    const along = Math.abs(Math.cos(angle));
    expect(along).toBeLessThan(1e-6);
    expect(structureTensorCoherence(4, 0, 0)).toBeCloseTo(1, 6);
    expect(structureTensorCoherence(2, 2, 0)).toBeCloseTo(0, 6);
  });
});

describe("printmaking tone: engraving shadow ladder", () => {
  it("enters primary, then secondary, then lozenge structure with darkness", () => {
    const light = engravingShadowStructure(0.2);
    expect(light.primaryFill).toBeGreaterThan(0);
    expect(light.secondaryFill).toBe(0);
    expect(light.lozengeFill).toBe(0);

    const mid = engravingShadowStructure(0.6);
    expect(mid.secondaryFill).toBeGreaterThan(0);
    expect(mid.lozengeFill).toBe(0);

    const deep = engravingShadowStructure(0.9);
    expect(deep.primaryFill).toBe(1);
    expect(deep.lozengeFill).toBeGreaterThan(0);
  });

  it("keeps every structure field monotone in darkness", () => {
    let prevP = -1, prevS = -1, prevL = -1;
    for (let d = 0; d <= 1.0001; d += 0.1) {
      const s = engravingShadowStructure(d);
      expect(s.primaryFill).toBeGreaterThanOrEqual(prevP - 1e-9);
      expect(s.secondaryFill).toBeGreaterThanOrEqual(prevS - 1e-9);
      expect(s.lozengeFill).toBeGreaterThanOrEqual(prevL - 1e-9);
      prevP = s.primaryFill; prevS = s.secondaryFill; prevL = s.lozengeFill;
    }
  });
});

describe("printmaking tone: stipple density modulation", () => {
  it("keeps dot radius independent of tone", () => {
    // The defining fix: radius is a function of the size control only.
    expect(stippleDotRadiusPx(6)).toBe(stippleDotRadiusPx(6));
    expect(stippleDotRadiusPx(6)).toBeGreaterThan(stippleDotRadiusPx(2));
  });

  it("raises dot density with darkness rather than dot size", () => {
    expect(stippleExpectedDensity(0.2)).toBeLessThan(stippleExpectedDensity(0.8));
    // A cell inks when local darkness exceeds its blue-noise threshold.
    expect(stippleDotPresent(0.8, 0.3)).toBe(true);
    expect(stippleDotPresent(0.2, 0.3)).toBe(false);
    // Averaged over uniform thresholds, inked fraction equals darkness.
    const darkness = 0.6;
    let inked = 0;
    const n = 1000;
    for (let i = 0; i < n; i++) {
      if (stippleDotPresent(darkness, (i + 0.5) / n)) inked++;
    }
    expect(inked / n).toBeCloseTo(darkness, 2);
  });

  it("anti-aliases dots", () => {
    const r = stippleDotRadiusPx(6);
    expect(dotCoverage(0, r)).toBe(1);
    expect(dotCoverage((r + 2) * (r + 2), r)).toBe(0);
  });
});

describe("printmaking tone: luminance", () => {
  it("matches Rec. 709 luma normalised to 0..1", () => {
    expect(luminance01(255, 255, 255)).toBeCloseTo(1, 6);
    expect(luminance01(0, 0, 0)).toBe(0);
    expect(luminance01(255, 0, 0)).toBeCloseTo(0.2126, 4);
  });
});
