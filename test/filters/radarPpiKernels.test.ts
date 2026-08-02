import { describe, expect, it } from "vitest";
import {
  RADAR_MIN_RANGE,
  meanPersistence,
  persistenceDecay,
  rangeAttenuation,
  stcGain,
  sweepBearing,
  sweepElapsedAngle,
} from "../../packages/ditherer-filters/src/filters/radarPpi";

const TWO_PI = Math.PI * 2;
const DEG = Math.PI / 180;

describe("radar equation range falloff", () => {
  it("falls as the INVERSE FOURTH POWER of range", () => {
    // Pr ∝ 1/R^4: doubling the range divides the return by exactly 16.
    for (const r of [0.05, 0.1, 0.2, 0.25, 0.4]) {
      expect(rangeAttenuation(2 * r) / rangeAttenuation(r)).toBeCloseTo(1 / 16, 6);
    }
    // Tripling divides by 81 — an inverse-square law would give 9.
    expect(rangeAttenuation(0.3) / rangeAttenuation(0.1)).toBeCloseTo(1 / 81, 6);
    // Absolute value, not just the ratio.
    expect(rangeAttenuation(0.5)).toBeCloseTo(1 / 0.5 ** 4, 6);
    expect(rangeAttenuation(1)).toBeCloseTo(1, 6);
  });

  it("is monotonically decreasing in range", () => {
    let previous = Infinity;
    for (let r = RADAR_MIN_RANGE; r <= 1.0001; r += 0.01) {
      const a = rangeAttenuation(r);
      expect(a).toBeLessThan(previous);
      previous = a;
    }
  });

  it("floors at the blanked minimum range instead of diverging", () => {
    expect(rangeAttenuation(0)).toBe(rangeAttenuation(RADAR_MIN_RANGE));
    expect(rangeAttenuation(-5)).toBe(rangeAttenuation(RADAR_MIN_RANGE));
    expect(Number.isFinite(rangeAttenuation(0))).toBe(true);
    expect(Number.isFinite(rangeAttenuation(Number.NaN))).toBe(true);
  });

  it("STC partially cancels the falloff, and fully cancels it at stc = 1", () => {
    const combined = (r: number, stc: number) => rangeAttenuation(r) * stcGain(r, stc);
    // stc = 0 leaves the raw 1/r^4 law.
    expect(combined(0.4, 0) / combined(0.2, 0)).toBeCloseTo(1 / 16, 6);
    // stc = 1 makes the return range-independent above the minimum range.
    expect(combined(0.4, 1)).toBeCloseTo(combined(0.2, 1), 6);
    // Halfway cancels half the exponent: r^-4 * r^2 = r^-2.
    expect(combined(0.4, 0.5) / combined(0.2, 0.5)).toBeCloseTo(1 / 4, 6);
    // Partial STC always lifts the far return relative to no STC.
    expect(combined(0.8, 0.55) / combined(0.1, 0.55)).toBeGreaterThan(
      combined(0.8, 0) / combined(0.1, 0),
    );
  });
});

describe("phosphor persistence", () => {
  const tau = 130 * DEG;

  it("is exactly exp(-dPhi / tau)", () => {
    for (const d of [0, 0.1, 0.5, 1, 2, 4, 6]) {
      expect(persistenceDecay(d, tau)).toBeCloseTo(Math.exp(-d / tau), 12);
    }
    // At dPhi = tau the trace has fallen to 1/e by definition.
    expect(persistenceDecay(tau, tau)).toBeCloseTo(Math.E ** -1, 12);
  });

  it("is 1 under the beam and decays monotonically behind it", () => {
    expect(persistenceDecay(0, tau)).toBe(1);
    let previous = Infinity;
    for (let d = 0; d < TWO_PI; d += 0.05) {
      const b = persistenceDecay(d, tau);
      expect(b).toBeLessThanOrEqual(1);
      expect(b).toBeLessThan(previous);
      previous = b;
    }
  });

  it("shortening tau makes the trail die away faster", () => {
    const d = 60 * DEG;
    expect(persistenceDecay(d, 30 * DEG)).toBeLessThan(persistenceDecay(d, 200 * DEG));
  });

  it("guards a degenerate tau", () => {
    expect(Number.isFinite(persistenceDecay(1, 0))).toBe(true);
    expect(persistenceDecay(1, 0)).toBeGreaterThanOrEqual(0);
  });
});

describe("all-bearing mean persistence (scope origin)", () => {
  it("equals the numerical mean of the decay over one revolution", () => {
    for (const tau of [20 * DEG, 130 * DEG, 360 * DEG]) {
      const steps = 20000;
      let sum = 0;
      for (let i = 0; i < steps; i += 1) {
        sum += persistenceDecay(((i + 0.5) / steps) * TWO_PI, tau);
      }
      expect(meanPersistence(tau)).toBeCloseTo(sum / steps, 6);
    }
  });

  it("lies strictly between the freshest and stalest cell on the ring", () => {
    const tau = 130 * DEG;
    const mean = meanPersistence(tau);
    expect(mean).toBeLessThan(persistenceDecay(0, tau));
    expect(mean).toBeGreaterThan(persistenceDecay(TWO_PI, tau));
  });

  it("rises toward 1 as persistence lengthens and toward 0 as it shortens", () => {
    expect(meanPersistence(2 * DEG)).toBeLessThan(0.01);
    expect(meanPersistence(36000 * DEG)).toBeGreaterThan(0.99);
    expect(meanPersistence(30 * DEG)).toBeLessThan(meanPersistence(300 * DEG));
    expect(Number.isFinite(meanPersistence(0))).toBe(true);
  });
});

describe("sweep-angle wrap", () => {
  it("wraps elapsed angle into [0, 2pi)", () => {
    for (const [bearing, sweep] of [
      [0, 0],
      [1, 5],
      [5, 1],
      [-3, 3],
      [7, -7],
      [0.2, 6.2],
    ]) {
      const d = sweepElapsedAngle(bearing, sweep);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(TWO_PI);
    }
    // The interval is HALF-OPEN. A tiny negative (sweep - bearing) is the case
    // that actually trips it: floor() gives -1, but the subtraction rounds up
    // to exactly 2pi in double precision. These must all come back as 0.
    for (const bearing of [1e-16, 1e-17, 5e-17, 1e-18, 2.3e-16, 1e-20, Number.MIN_VALUE]) {
      const d = sweepElapsedAngle(bearing, 0);
      expect(d).toBeLessThan(TWO_PI);
      expect(d).toBe(0);
    }
    // Same boundary approached from a nonzero sweep.
    expect(sweepElapsedAngle(Math.PI + 1e-16, Math.PI)).toBeLessThan(TWO_PI);
    // A dense sweep of near-seam pairs never reaches the open end.
    for (let i = 0; i < 400; i += 1) {
      const bearing = i * 1e-17;
      expect(sweepElapsedAngle(bearing, 0)).toBeLessThan(TWO_PI);
    }
    // A cell 10 degrees behind the sweep waits 10 degrees; 10 degrees ahead
    // waits 350 degrees for the next revolution.
    expect(sweepElapsedAngle(80 * DEG, 90 * DEG)).toBeCloseTo(10 * DEG, 9);
    expect(sweepElapsedAngle(100 * DEG, 90 * DEG)).toBeCloseTo(350 * DEG, 9);
  });

  it("makes the trail follow BEHIND the sweep and wrap correctly", () => {
    const tau = 130 * DEG;
    const sweep = 90 * DEG;
    const behind = persistenceDecay(sweepElapsedAngle(sweep - 10 * DEG, sweep), tau);
    const ahead = persistenceDecay(sweepElapsedAngle(sweep + 10 * DEG, sweep), tau);
    expect(behind).toBeGreaterThan(0.9); // just painted
    expect(ahead).toBeLessThan(0.1); // almost a full revolution stale
    expect(behind).toBeGreaterThan(ahead * 10);

    // The wrap is seamless: crossing the 0/2pi seam changes nothing.
    const nearZero = 5 * DEG;
    expect(persistenceDecay(sweepElapsedAngle(355 * DEG, nearZero), tau)).toBeCloseTo(
      persistenceDecay(10 * DEG, tau),
      9,
    );
  });

  it("advances the bearing with the frame index and wraps at a full turn", () => {
    expect(sweepBearing(0, 6)).toBeCloseTo(0, 9);
    expect(sweepBearing(15, 6)).toBeCloseTo(90 * DEG, 9);
    expect(sweepBearing(60, 6)).toBeCloseTo(0, 9); // 360 deg -> back to north
    for (let f = 0; f < 200; f += 7) {
      const phi = sweepBearing(f, 6.5);
      expect(phi).toBeGreaterThanOrEqual(0);
      expect(phi).toBeLessThan(TWO_PI);
    }
  });

  it("keeps sweepBearing in [0, 2pi) when the turn lands just under k*2pi", () => {
    // omega*t a hair below a whole number of revolutions: floor() disagrees
    // with the subtraction and the naive wrap returns a small NEGATIVE angle.
    // These pairs all produce phi just under k*2pi in double precision.
    const nearSeam: [number, number][] = [
      [1, 6119.999999999999], // phi = 106.81415022205296 -> -1.42e-14 unguarded
      [1, 11879.999999999998],
      [1, 12239.999999999998],
      [1, 13319.999999999998],
      [2, 3059.9999999999995],
      [2, 5939.999999999999],
    ];
    for (const [frameIndex, degreesPerFrame] of nearSeam) {
      const phi = sweepBearing(frameIndex, degreesPerFrame);
      expect(phi).toBeGreaterThanOrEqual(0);
      expect(phi).toBeLessThan(TWO_PI);
      expect(Number.isNaN(phi)).toBe(false);
    }
    // Exact whole revolutions stay pinned at 0, not 2pi.
    for (const k of [1, 2, 10, 100]) {
      expect(sweepBearing(k, 360)).toBe(0);
    }
  });

  it("keeps both angular kernels finite on degenerate and overflowing input", () => {
    // Individually finite operands whose DIFFERENCE overflows to -Infinity.
    expect(Number.isNaN(sweepElapsedAngle(Number.MAX_VALUE, -1e300))).toBe(false);
    expect(sweepElapsedAngle(Number.MAX_VALUE, -1e300)).toBeGreaterThanOrEqual(0);
    expect(sweepElapsedAngle(-Number.MAX_VALUE, 1e300)).toBeLessThan(TWO_PI);
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      for (const value of [
        sweepElapsedAngle(bad, 1),
        sweepElapsedAngle(1, bad),
        sweepBearing(bad, 6),
        sweepBearing(6, bad),
      ]) {
        expect(Number.isNaN(value)).toBe(false);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(TWO_PI);
      }
    }
  });
});
