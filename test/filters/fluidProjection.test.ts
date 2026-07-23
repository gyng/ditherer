import { describe, expect, it } from "vitest";
import {
  divergence,
  jacobiPressure,
  maxInteriorDivergence,
  projectVelocity,
} from "../../packages/ditherer-filters/src/filters/fluidProjection";

// A smooth, curl-free (gradient) field with zero normal flux at the walls: it is
// entirely the "divergent part" that projection must remove, and it is
// compatible with the closed (Neumann) boundaries. v = ∇φ, φ = cos·cos, so the
// normal velocity vanishes on every edge.
const curlFreeField = (w: number, h: number) => {
  const vx = new Float32Array(w * h);
  const vy = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ax = Math.PI * x / (w - 1), ay = Math.PI * y / (h - 1);
      vx[y * w + x] = -Math.sin(ax) * Math.cos(ay);
      vy[y * w + x] = -Math.cos(ax) * Math.sin(ay);
    }
  }
  return { vx, vy };
};

describe("fluid projection", () => {
  it("measures the divergence of a radial source as ~2", () => {
    const w = 16, h = 16;
    // Radial outflow v = (x - cx, y - cy): uniform interior divergence 2.
    const vx = new Float32Array(w * h), vy = new Float32Array(w * h);
    const cx = (w - 1) / 2, cy = (h - 1) / 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      vx[y * w + x] = x - cx; vy[y * w + x] = y - cy;
    }
    const div = divergence(vx, vy, w, h);
    expect(div[8 * w + 8]).toBeCloseTo(2, 6);
    expect(maxInteriorDivergence(vx, vy, w, h)).toBeCloseTo(2, 6);
  });

  it("drives the divergence of a curl-free field toward zero", () => {
    const w = 20, h = 20;
    const { vx, vy } = curlFreeField(w, h);
    const before = maxInteriorDivergence(vx, vy, w, h);
    const projected = projectVelocity(vx, vy, w, h, 400);
    const after = maxInteriorDivergence(projected.vx, projected.vy, w, h);
    expect(before).toBeGreaterThan(0.05);
    expect(after).toBeLessThan(before * 0.15); // >85% of the divergence removed

    // The border (excluded from the interior measure) must also improve, so a
    // wrong edge stencil can't hide there.
    const fullMax = (fx: Float32Array, fy: Float32Array): number => {
      const d = divergence(fx, fy, w, h);
      let m = 0;
      for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
      return m;
    };
    expect(fullMax(projected.vx, projected.vy)).toBeLessThan(fullMax(vx, vy));
  });

  it("converges monotonically with more Jacobi iterations", () => {
    const w = 20, h = 20;
    const { vx, vy } = curlFreeField(w, h);
    const few = projectVelocity(vx, vy, w, h, 20);
    const many = projectVelocity(vx, vy, w, h, 300);
    expect(maxInteriorDivergence(many.vx, many.vy, w, h))
      .toBeLessThan(maxInteriorDivergence(few.vx, few.vy, w, h));
  });

  it("leaves an already-divergence-free field essentially unchanged", () => {
    // A uniform translation v = (1, 0) is divergence-free; projection is a no-op.
    const w = 12, h = 12;
    const vx = new Float32Array(w * h).fill(1);
    const vy = new Float32Array(w * h);
    const projected = projectVelocity(vx, vy, w, h, 40);
    for (let i = 0; i < vx.length; i++) {
      expect(projected.vx[i]).toBeCloseTo(1, 5);
      expect(projected.vy[i]).toBeCloseTo(0, 5);
    }
  });

  it("solves ∇²p = div at the pressure it returns", () => {
    const w = 12, h = 12;
    // A +1/-1 dipole is zero-sum, so it is Neumann-compatible and converges to
    // an exact steady solution (a point source is not, forcing a loose bound).
    const div = new Float32Array(w * h);
    const a = 3 * w + 6, b = 8 * w + 6;
    div[a] = 1; div[b] = -1;
    const p = jacobiPressure(div, w, h, 600);
    const lap = (i: number) => (p[i - 1] + p[i + 1] + p[i - w] + p[i + w]) - 4 * p[i];
    expect(lap(a)).toBeCloseTo(1, 2);
    expect(lap(b)).toBeCloseTo(-1, 2);
  });

  it("guards degenerate iteration counts", () => {
    const w = 8, h = 8;
    const { vx, vy } = curlFreeField(w, h);
    expect(() => projectVelocity(vx, vy, w, h, 0)).not.toThrow();
    expect(() => projectVelocity(vx, vy, w, h, Number.NaN)).not.toThrow();
    // Zero iterations -> pressure stays 0 -> velocity unchanged.
    const p0 = jacobiPressure(divergence(vx, vy, w, h), w, h, 0);
    expect(Array.from(p0).every((v) => v === 0)).toBe(true);
  });
});
