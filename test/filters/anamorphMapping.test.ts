import { describe, expect, it } from "vitest";
import {
  anamorphAngleU,
  anamorphAnnulusHeight,
  anamorphDiscHeight,
} from "../../packages/ditherer-filters/src/filters/anamorphMapping";

describe("anamorphic cylinder radial map", () => {
  it("maps the annulus LINEARLY (reflection), not logarithmically", () => {
    const cylR = 80, maxR = 480;
    expect(anamorphAnnulusHeight(cylR, cylR, maxR)).toBeCloseTo(1, 6); // wall
    expect(anamorphAnnulusHeight(maxR, cylR, maxR)).toBeCloseTo(0, 6); // outer rim
    // Linear => the midpoint radius maps to exactly 0.5. A log map (the old
    // rSrc = cylR*exp(t*ln(maxR/cylR))) would not.
    expect(anamorphAnnulusHeight((cylR + maxR) / 2, cylR, maxR)).toBeCloseTo(0.5, 6);
    // Equal radius steps -> equal height steps (constant slope).
    const s1 = anamorphAnnulusHeight(cylR + 100, cylR, maxR) - anamorphAnnulusHeight(cylR + 200, cylR, maxR);
    const s2 = anamorphAnnulusHeight(cylR + 200, cylR, maxR) - anamorphAnnulusHeight(cylR + 300, cylR, maxR);
    expect(s1).toBeCloseTo(s2, 6);
  });

  it("joins the disc and annulus continuously at the cylinder wall", () => {
    const cylR = 100, maxR = 400;
    expect(anamorphDiscHeight(cylR, cylR)).toBeCloseTo(1, 6);
    expect(anamorphAnnulusHeight(cylR, cylR, maxR)).toBeCloseTo(1, 6);
    // Disc centre is height 0.
    expect(anamorphDiscHeight(0, cylR)).toBeCloseTo(0, 6);
  });

  it("wraps angle (plus twist) into a source column fraction", () => {
    expect(anamorphAngleU(0, 0)).toBeCloseTo(0, 6);          // theta 0 -> column 0
    expect(anamorphAngleU(Math.PI, 0)).toBeCloseTo(0.5, 6);  // half turn -> mid column
    // Wrapping: adding a full turn of twist returns to the same column.
    expect(anamorphAngleU(0.3, 0)).toBeCloseTo(anamorphAngleU(0.3, Math.PI * 2), 6);
    // Always in [0, 1).
    for (const t of [-3, -1, 0, 1, 3, 10]) {
      const u = anamorphAngleU(t, 0);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });

  it("guards degenerate radii", () => {
    expect(anamorphAnnulusHeight(100, 100, 100)).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(anamorphDiscHeight(10, 0))).toBe(true);
    expect(anamorphAnnulusHeight(Number.NaN, 80, 400)).toBeGreaterThanOrEqual(0);
  });
});
