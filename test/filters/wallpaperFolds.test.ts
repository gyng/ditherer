import { describe, expect, it } from "vitest";
import {
  foldP1,
  foldP2,
  foldP4M,
  foldP6M,
  foldPMM,
} from "../../packages/ditherer-filters/src/filters/wallpaperFolds";

const eq = (a: [number, number], b: [number, number], p = 6) => {
  expect(a[0]).toBeCloseTo(b[0], p);
  expect(a[1]).toBeCloseTo(b[1], p);
};
const same = (a: [number, number], b: [number, number]) =>
  Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

const rot = (x: number, y: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
};

describe("wallpaper group folds", () => {
  const sz = 100;

  it("P1 is translation-invariant", () => {
    eq(foldP1(37, 19, sz), foldP1(37 + sz, 19 - sz, sz));
  });

  it("P2 is a 180° ROTATION with NO mirror lines (not PMM)", () => {
    // Invariant under the 180° rotation about (sz, sz/2): (x,y) -> (2sz-x, sz-y).
    eq(foldP2(30, 20, sz), foldP2(2 * sz - 30, sz - 20, sz));
    // Period 2sz in x, sz in y.
    eq(foldP2(30, 20, sz), foldP2(30 + 2 * sz, 20 + sz, sz));
    // A pure axis mirror must NOT be a symmetry (this is what separates p2 from
    // pmm): the mirror image folds to a DIFFERENT representative.
    expect(same(foldP2(30, 20, sz), foldP2(2 * sz - 30, 20, sz))).toBe(false);
    // And P2 must differ from PMM on the point where they used to coincide.
    expect(same(foldP2(170, 80, sz), foldPMM(170, 80, sz))).toBe(false);
  });

  it("PMM has mirror lines on both axes", () => {
    eq(foldPMM(30, 20, sz), foldPMM(-30, 20, sz));   // mirror about x=0
    eq(foldPMM(30, 20, sz), foldPMM(30, -20, sz));   // mirror about y=0
    eq(foldPMM(30, 20, sz), foldPMM(2 * sz - 30, 20, sz)); // mirror about x=sz
  });

  it("P4M has both axis mirrors and the diagonal mirror", () => {
    const base = foldP4M(30, 55, sz);
    eq(base, foldP4M(-30, 55, sz));           // axis mirror
    eq(base, foldP4M(55, 30, sz));            // diagonal swap x<->y
  });

  it("P6M is a hexagonal 6-fold + mirror kaleidoscope", () => {
    const p: [number, number] = [37, 19];
    const base = foldP6M(p[0], p[1], sz);
    // 60° rotation about a hex centre (origin).
    const [rx, ry] = rot(p[0], p[1], 60);
    eq(base, foldP6M(rx, ry, sz), 4);
    // Mirror about the x-axis (a mirror line of p6m through the centre).
    eq(base, foldP6M(p[0], -p[1], sz), 4);
    // Hex-lattice translation by a1 = (sz, 0).
    eq(base, foldP6M(p[0] + sz, p[1], sz), 4);
  });

  it("keeps every fold within its fundamental domain and guards degeneracy", () => {
    for (const fold of [foldP1, foldP2, foldPMM, foldP4M, foldP6M]) {
      const [fx, fy] = fold(123.4, -57.9, sz);
      expect(fx).toBeGreaterThanOrEqual(-1e-6);
      expect(fx).toBeLessThanOrEqual(sz + 1e-6);
      expect(fy).toBeGreaterThanOrEqual(-1e-6);
      expect(fy).toBeLessThanOrEqual(sz + 1e-6);
      expect(() => fold(10, 10, 0)).not.toThrow();
    }
  });
});
