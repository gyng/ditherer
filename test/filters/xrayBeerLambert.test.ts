import { describe, expect, it } from "vitest";
import {
  beerLambertTransmission,
  MOTTLE_AMPLITUDE_GLSL,
  quantumMottleAmplitude,
  radiographDisplayIntensity,
  veilingGlareMix,
  XRAY_DEVELOP_FS,
} from "filters/xray";

// xray.ts is requiresGL:true with no CPU fallback and jsdom has no WebGL2, so
// the shader itself cannot run here (see the gl-smoke contract for the
// real-GPU pixel check). These assertions pin the pure physics kernels the
// fragment shaders mirror line for line.

describe("Beer–Lambert transmission", () => {
  it("is exactly exp(-k*d)", () => {
    for (const k of [0, 0.5, 1, 2.6, 8]) {
      for (const d of [0, 0.125, 0.4, 0.75, 1]) {
        expect(beerLambertTransmission(d, k)).toBe(Math.exp(-k * d));
      }
    }
  });

  it("is unity at zero density regardless of attenuation", () => {
    for (const k of [0, 1, 2.6, 8]) {
      expect(beerLambertTransmission(0, k)).toBe(1);
    }
  });

  it("decreases monotonically with density and never goes negative", () => {
    const k = 2.6;
    let previous = beerLambertTransmission(0, k);
    for (let d = 0.05; d <= 1.0001; d += 0.05) {
      const t = beerLambertTransmission(d, k);
      expect(t).toBeLessThan(previous);
      expect(t).toBeGreaterThan(0);
      previous = t;
    }
  });

  it("attenuates more as the attenuation coefficient rises", () => {
    const d = 0.6;
    expect(beerLambertTransmission(d, 4)).toBeLessThan(beerLambertTransmission(d, 1));
    expect(beerLambertTransmission(d, 0)).toBe(1);
  });

  it("treats non-finite and negative inputs as zero", () => {
    expect(beerLambertTransmission(Number.NaN, 2)).toBe(1);
    expect(beerLambertTransmission(0.5, Number.NaN)).toBe(1);
    expect(beerLambertTransmission(-3, 2)).toBe(1);
  });
});

describe("quantum mottle", () => {
  // N ~ Poisson(dose*T) and T_hat = N/dose, so Var(T_hat) = T/dose: the
  // ABSOLUTE sigma is sqrt(T/dose), not the relative 1/sqrt(dose*T).
  it("is the absolute Poisson sigma sqrt(T / dose)", () => {
    expect(quantumMottleAmplitude(0.25, 100, 1)).toBeCloseTo(0.05, 12);
    for (const t of [0.05, 0.25, 0.6, 1]) {
      for (const dose of [4, 80, 400]) {
        expect(quantumMottleAmplitude(t, dose, 0.35)).toBeCloseTo(0.35 * Math.sqrt(t / dose), 12);
      }
    }
    // Quadrupling the dose halves the noise.
    const low = quantumMottleAmplitude(0.5, 25, 0.4);
    const high = quantumMottleAmplitude(0.5, 100, 0.4);
    expect(high).toBeCloseTo(low / 2, 12);
  });

  it("shrinks in absolute terms as transmission falls", () => {
    const dose = 80,
      gain = 0.35;
    let previous = quantumMottleAmplitude(1, dose, gain);
    for (const t of [0.8, 0.5, 0.25, 0.1, 0.02, 0.005]) {
      const amplitude = quantumMottleAmplitude(t, dose, gain);
      expect(amplitude).toBeLessThan(previous);
      previous = amplitude;
    }
  });

  it("has RELATIVE noise (sigma/T = 1/sqrt(N)) that rises as transmission falls", () => {
    // The physically meaningful statement: dense, photon-starved regions look
    // the mottliest because their SNR collapses, not because sigma is larger.
    const dose = 80,
      gain = 0.35;
    let previous = quantumMottleAmplitude(1, dose, gain) / 1;
    for (const t of [0.8, 0.5, 0.25, 0.1, 0.02, 0.005]) {
      const relative = quantumMottleAmplitude(t, dose, gain) / t;
      expect(relative).toBeGreaterThan(previous);
      expect(relative).toBeCloseTo(gain / Math.sqrt(dose * t), 12);
      previous = relative;
    }
  });

  it("vanishes exactly where no photons arrive, with no epsilon pedestal", () => {
    // A fully opaque pixel receives nothing, so it must have NO mottle at all —
    // not the tiny floor an epsilon guard would inject.
    expect(quantumMottleAmplitude(0, 80, 1)).toBe(0);
    expect(quantumMottleAmplitude(0, 4, 1)).toBe(0);
    expect(quantumMottleAmplitude(-0.2, 80, 1)).toBe(0);
    expect(quantumMottleAmplitude(0.3, 80, 0)).toBe(0);
  });

  it("rejects meaningless dose instead of exploding", () => {
    const unit = quantumMottleAmplitude(0.25, 1, 1);
    for (const dose of [Number.NaN, 0, -80, Number.NEGATIVE_INFINITY]) {
      expect(quantumMottleAmplitude(0.25, dose, 1)).toBe(unit);
    }
    expect(unit).toBeCloseTo(0.5, 12);
  });
});

// The shader cannot run in jsdom, so the one thing that can silently drift is
// the GLSL twin of quantumMottleAmplitude(). The expression lives in exactly
// one exported string; these pin its shape, its interpolated constant, and the
// fact that the shader actually uses it.
describe("shader / kernel mottle parity", () => {
  it("keeps the mottle expression as the single source of truth in the shader", () => {
    expect(XRAY_DEVELOP_FS).toContain(`float amplitude = ${MOTTLE_AMPLITUDE_GLSL};`);
    expect(XRAY_DEVELOP_FS.split(MOTTLE_AMPLITUDE_GLSL)).toHaveLength(2);
  });

  it("mirrors gain * sqrt(max(0, T) / max(minDose, dose))", () => {
    expect(MOTTLE_AMPLITUDE_GLSL).toBe(
      "max(0.0, u_mottle) * sqrt(max(0.0, transmission) / max(0.000001, u_dose))",
    );
  });

  it("interpolates constants as GLSL float literals, never exponent notation", () => {
    // `1e-6` is a valid JS number but not a GLSL float literal; String() must
    // have produced a plain decimal.
    expect(MOTTLE_AMPLITUDE_GLSL).not.toMatch(/e[+-]?\d/i);
    expect(MOTTLE_AMPLITUDE_GLSL).toMatch(/max\(0\.000001, u_dose\)/);
    for (const literal of MOTTLE_AMPLITUDE_GLSL.match(/\d+\.\d+/g) ?? []) {
      expect(literal).toMatch(/^\d+\.\d+$/);
    }
  });

  it("clamps the noisy transmission only at zero, so excursions stay symmetric", () => {
    // Clamping to [0,1] would discard every upward excursion in the open beam
    // and leave one-sided specks; the single range clamp is the sRGB encode.
    expect(XRAY_DEVELOP_FS).toContain(
      "transmission = max(0.0, transmission + amplitude * gaussian);",
    );
    expect(XRAY_DEVELOP_FS).not.toContain("clamp(transmission + amplitude * gaussian");
  });
});

describe("veiling glare and display convention", () => {
  it("mixes the scattered pedestal under the primary beam", () => {
    expect(veilingGlareMix(1, 0, 0)).toBe(1);
    expect(veilingGlareMix(1, 0, 1)).toBe(0);
    expect(veilingGlareMix(1, 0, 0.25)).toBeCloseTo(0.75, 12);
  });

  it("lowers subject contrast without moving the mean", () => {
    const bright = 0.9,
      dark = 0.1,
      pedestal = 0.5,
      s = 0.4;
    const a = veilingGlareMix(bright, pedestal, s);
    const b = veilingGlareMix(dark, pedestal, s);
    expect(a - b).toBeLessThan(bright - dark);
    expect((a + b) / 2).toBeCloseTo((bright + dark) / 2, 12);
  });

  it("shows dense material white in the positive view and dark on the negative", () => {
    // Dense material transmits little, so T is small.
    expect(radiographDisplayIntensity(0.05, true)).toBeCloseTo(0.95, 12);
    expect(radiographDisplayIntensity(0.05, false)).toBeCloseTo(0.05, 12);
    expect(radiographDisplayIntensity(1, true)).toBe(0);
    expect(radiographDisplayIntensity(1, false)).toBe(1);
  });

  it("is brighter for denser material only in the positive view", () => {
    const dense = beerLambertTransmission(0.9, 2.6);
    const thin = beerLambertTransmission(0.1, 2.6);
    expect(radiographDisplayIntensity(dense, true)).toBeGreaterThan(
      radiographDisplayIntensity(thin, true),
    );
    expect(radiographDisplayIntensity(dense, false)).toBeLessThan(
      radiographDisplayIntensity(thin, false),
    );
  });
});
