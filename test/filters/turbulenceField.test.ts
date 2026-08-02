import { describe, expect, it } from "vitest";
import {
  curlDivergence,
  curlNoise,
  valueNoise,
} from "../../packages/ditherer-filters/src/filters/turbulenceField";

// The gradient (curl-free) field for the SAME potential — divergence = Laplacian.
const gradDivergence = (x: number, y: number, h = 1): number => {
  const gx = (p: number, q: number) => (valueNoise(p + h, q) - valueNoise(p - h, q)) / (2 * h);
  const gy = (p: number, q: number) => (valueNoise(p, q + h) - valueNoise(p, q - h)) / (2 * h);
  return (gx(x + h, y) - gx(x - h, y)) / (2 * h) + (gy(x, y + h) - gy(x, y - h)) / (2 * h);
};

describe("curl-noise turbulence", () => {
  it("value noise stays in [0,1] and is smooth (deterministic)", () => {
    for (let i = 0; i < 50; i++) {
      const v = valueNoise(i * 1.7, i * 0.9);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(valueNoise(3.2, 5.1)).toBe(valueNoise(3.2, 5.1)); // deterministic
    // Continuity: nearby samples differ only a little.
    expect(Math.abs(valueNoise(3.2, 5.1) - valueNoise(3.21, 5.1))).toBeLessThan(0.05);
  });

  it("the curl field is divergence-free — real turbulence, unlike a gradient", () => {
    // The curl of a scalar potential is divergence-free by construction (the
    // consistent-step discrete divergence cancels exactly). The gradient of the
    // SAME potential (curl-free) has divergence = Laplacian, which is not zero —
    // proving the assertion actually discriminates the field's structure.
    let maxCurlDiv = 0,
      maxGradDiv = 0;
    for (let x = 2; x < 20; x += 1.3) {
      for (let y = 2; y < 20; y += 1.3) {
        maxCurlDiv = Math.max(maxCurlDiv, Math.abs(curlDivergence(x, y)));
        maxGradDiv = Math.max(maxGradDiv, Math.abs(gradDivergence(x, y)));
      }
    }
    expect(maxCurlDiv).toBeLessThan(1e-9); // divergence-free (incompressible)
    expect(maxGradDiv).toBeGreaterThan(0.05); // a gradient field would fail the above
  });

  it("produces a non-trivial, deterministic 2-D field", () => {
    const [ax, ay] = curlNoise(4.3, 7.1);
    expect(curlNoise(4.3, 7.1)).toEqual([ax, ay]);
    // Not identically zero somewhere.
    let energy = 0;
    for (let x = 0; x < 30; x += 2)
      for (let y = 0; y < 30; y += 2) {
        const [vx, vy] = curlNoise(x, y);
        energy += vx * vx + vy * vy;
      }
    expect(energy).toBeGreaterThan(0.01);
  });
});
