import { describe, expect, it } from "vitest";
import {
  SEM_COS_EPSILON,
  SEM_MATERIAL_FLOOR,
  defaults,
  everhartThornleyResponse,
  secondaryElectronYield,
  semLocalBaseYield,
  softSaturateYield,
  surfaceNormalFromHeightGradient,
} from "../../packages/ditherer-filters/src/filters/scanningElectronMicrograph";

/** cos θ the shader actually sees for a given per-texel luminance gradient. */
const cosThetaFor = (gradient: number, relief = defaults.relief): number =>
  surfaceNormalFromHeightGradient(gradient, 0, relief)[2];

const cosThetaFor2D = (dhdx: number, dhdy: number, relief = defaults.relief): number =>
  surfaceNormalFromHeightGradient(dhdx, dhdy, relief)[2];

/**
 * The shader's central difference is `(hR - hL) * 0.5` over luminance in [0,1],
 * so each axis is bounded to ±0.5 — a black/white corner is the steepest thing
 * any source can produce.
 */
const MAX_AXIS_GRADIENT = 0.5;

// Per-texel central differences of LINEAR luminance, measured on ordinary
// imagery: a smooth region, a typical detail edge, and a hard sRGB step.
const GRAD_SMOOTH = 0.02,
  GRAD_DETAIL = 0.05,
  GRAD_HARD_STEP = 0.4;

describe("SEM secant-law secondary-electron yield", () => {
  it("is exactly delta0 / cos(theta)", () => {
    for (const delta0 of [0.5, 1, 2.5]) {
      for (const cosTheta of [1, 0.9, 0.5, 0.25, 0.1, SEM_COS_EPSILON]) {
        expect(secondaryElectronYield(cosTheta, delta0)).toBeCloseTo(delta0 / cosTheta, 10);
      }
    }
  });

  it("returns delta0 at normal incidence (cos theta = 1)", () => {
    expect(secondaryElectronYield(1, 1)).toBeCloseTo(1, 12);
    expect(secondaryElectronYield(1, 0.4)).toBeCloseTo(0.4, 12);
    expect(secondaryElectronYield(1, 2.75)).toBeCloseTo(2.75, 12);
  });

  it("increases monotonically toward grazing incidence — the edge-brightening property", () => {
    const cosines = [1, 0.8, 0.6, 0.4, 0.2, 0.1, 0.05, SEM_COS_EPSILON];
    let previous = -Infinity;
    for (const cosTheta of cosines) {
      const yieldValue = secondaryElectronYield(cosTheta, 1);
      expect(yieldValue).toBeGreaterThan(previous);
      previous = yieldValue;
    }
    // A grazing face emits far more escaping secondaries than a flat one.
    expect(secondaryElectronYield(0.05, 1)).toBeGreaterThan(secondaryElectronYield(1, 1) * 10);
  });

  it("stays finite and clamped as cos theta -> 0 (no Infinity/NaN)", () => {
    const ceilingYield = 1 / SEM_COS_EPSILON;
    for (const cosTheta of [0, 1e-12, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const yieldValue = secondaryElectronYield(cosTheta, 1);
      expect(Number.isFinite(yieldValue)).toBe(true);
      expect(yieldValue).toBeLessThanOrEqual(ceilingYield + 1e-9);
      expect(yieldValue).toBeGreaterThan(0);
    }
    expect(secondaryElectronYield(0, 1)).toBeCloseTo(ceilingYield, 9);
    // cos theta > 1 is not physical; it must not dip below delta0.
    expect(secondaryElectronYield(4, 2)).toBeCloseTo(2, 12);
  });
});

describe("SEM secant law over the REACHABLE cos theta range", () => {
  // The degenerate guards above certify inputs the shader never produces. These
  // pin the tuning that actually ships: relief maps ordinary per-texel gradients
  // onto tilts steep enough for the secant law to be plainly visible.
  it("brightens meaningfully at stock relief on ordinary gradients", () => {
    expect(secondaryElectronYield(cosThetaFor(GRAD_SMOOTH), 1)).toBeGreaterThan(1.08);
    expect(secondaryElectronYield(cosThetaFor(GRAD_DETAIL), 1)).toBeGreaterThan(1.5);
    expect(secondaryElectronYield(cosThetaFor(GRAD_HARD_STEP), 1)).toBeGreaterThan(8);
  });

  it("would be inert if relief were near 1 — the regression this default guards", () => {
    // At heightScale 1 even a hard step barely tilts: < 10% brightening.
    expect(secondaryElectronYield(cosThetaFor(GRAD_DETAIL, 1), 1)).toBeLessThan(1.01);
    expect(secondaryElectronYield(cosThetaFor(GRAD_HARD_STEP, 1), 1)).toBeLessThan(1.1);
    // The shipped default must be far away from that regime.
    expect(defaults.relief).toBeGreaterThanOrEqual(16);
  });

  it("keeps the reachable cos theta above the epsilon guard at stock relief", () => {
    expect(cosThetaFor(GRAD_HARD_STEP)).toBeGreaterThan(SEM_COS_EPSILON);
    // A single-axis edge can never reach the guard, even at maximum relief and
    // the hardest gradient the central difference can produce...
    expect(cosThetaFor(MAX_AXIS_GRADIENT, 80)).toBeGreaterThan(SEM_COS_EPSILON);
    // ...but a black/white CORNER drives both axes at once and does reach it, so
    // the guard is live insurance rather than dead code.
    expect(cosThetaFor2D(MAX_AXIS_GRADIENT, MAX_AXIS_GRADIENT, 80)).toBeLessThan(SEM_COS_EPSILON);
  });
});

describe("SEM material contrast and the delta0 control", () => {
  it("modulates delta0 by linear luminance, with a floor on black", () => {
    expect(semLocalBaseYield(0, 1)).toBeCloseTo(SEM_MATERIAL_FLOOR, 12);
    expect(semLocalBaseYield(1, 1)).toBeCloseTo(1, 12);
    let previous = -1;
    for (const h of [0, 0.25, 0.5, 0.75, 1]) {
      const d = semLocalBaseYield(h, 1);
      expect(d).toBeGreaterThan(previous);
      previous = d;
    }
    expect(Number.isFinite(semLocalBaseYield(Number.NaN, Number.NaN))).toBe(true);
  });

  it("makes raising delta0 BRIGHTEN the collected signal, as its name promises", () => {
    // Regression guard: normalising the saturated yield by delta0 inverted this,
    // because sat(k*x, C)/k falls with k — the control darkened as it was raised.
    const signal = (baseYield: number, height = 0.216) =>
      softSaturateYield(
        secondaryElectronYield(1, semLocalBaseYield(height, baseYield)),
        defaults.yieldCeiling,
      );
    let previous = -1;
    for (const b of [0.1, 0.5, 1, 2, 3]) {
      const s = signal(b);
      expect(s).toBeGreaterThan(previous);
      previous = s;
    }
    expect(signal(3)).toBeGreaterThan(signal(0.1) * 2);
  });
});

describe("SEM detector saturation", () => {
  it("is near-linear for small yields and asymptotic to the ceiling", () => {
    expect(softSaturateYield(0, 4)).toBeCloseTo(0, 12);
    expect(softSaturateYield(0.01, 4)).toBeCloseTo(0.01, 3);
    expect(softSaturateYield(1e9, 4)).toBeLessThan(4);
    expect(softSaturateYield(1e9, 4)).toBeGreaterThan(3.99);
  });

  it("is monotonic and never exceeds the ceiling, even for a blown-out rim", () => {
    let previous = -1;
    for (const y of [0, 0.5, 1, 2, 8, 1 / SEM_COS_EPSILON, 1e6]) {
      const s = softSaturateYield(y, 4);
      expect(s).toBeGreaterThan(previous);
      expect(s).toBeLessThan(4);
      previous = s;
    }
    expect(Number.isFinite(softSaturateYield(Number.NaN, Number.NaN))).toBe(true);
  });
});

describe("SEM surface normal from the invented heightfield", () => {
  it("is unit length and points at the beam on flat ground", () => {
    const flat = surfaceNormalFromHeightGradient(0, 0, 4);
    expect(Math.hypot(...flat)).toBeCloseTo(1, 12);
    expect(flat[2]).toBeCloseTo(1, 12); // cos theta = 1 => yield = delta0
  });

  it("tilts away from the beam on a slope, and more so with relief scale", () => {
    const gentle = surfaceNormalFromHeightGradient(0.2, 0, 1);
    const steep = surfaceNormalFromHeightGradient(0.2, 0, 12);
    expect(Math.hypot(...steep)).toBeCloseTo(1, 12);
    expect(steep[2]).toBeLessThan(gentle[2]);
    expect(gentle[2]).toBeLessThan(1);
    // Normal leans against the uphill direction.
    expect(gentle[0]).toBeLessThan(0);
    // Steeper relief => lower cos theta => brighter secant-law yield.
    expect(secondaryElectronYield(steep[2], 1)).toBeGreaterThan(
      secondaryElectronYield(gentle[2], 1),
    );
  });

  it("survives degenerate inputs", () => {
    for (const n of [
      surfaceNormalFromHeightGradient(Number.NaN, 0, 4),
      surfaceNormalFromHeightGradient(0, 0, 0),
      surfaceNormalFromHeightGradient(0, 0, Number.NaN),
    ]) {
      expect(n.every(Number.isFinite)).toBe(true);
      expect(Math.hypot(...n)).toBeCloseTo(1, 9);
    }
  });
});

describe("SEM Everhart-Thornley directionality", () => {
  it("favours faces turned toward the detector and floors the rest", () => {
    const az = 0,
      el = Math.PI / 6;
    const facingDetector = surfaceNormalFromHeightGradient(-0.6, 0, 4); // normal leans +x
    const facingAway = surfaceNormalFromHeightGradient(0.6, 0, 4); // normal leans -x
    expect(everhartThornleyResponse(facingDetector, az, el)).toBeGreaterThan(
      everhartThornleyResponse(facingAway, az, el),
    );
    for (const n of [facingDetector, facingAway]) {
      const r = everhartThornleyResponse(n, az, el);
      expect(r).toBeGreaterThanOrEqual(0.25); // collector grid floor, never black
      expect(r).toBeLessThanOrEqual(1);
    }
  });

  it("is bounded and finite for any azimuth/elevation", () => {
    const flat = surfaceNormalFromHeightGradient(0, 0, 4);
    for (let deg = 0; deg <= 360; deg += 30) {
      const r = everhartThornleyResponse(flat, (deg * Math.PI) / 180, Math.PI / 4);
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
    expect(
      Number.isFinite(everhartThornleyResponse([Number.NaN, 0, 1], Number.NaN, Number.NaN)),
    ).toBe(true);
  });
});
