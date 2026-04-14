import { describe, it, expect } from "vitest";
import { gaussianBlurRGBA, gaussianBlur1D } from "utils/blur";

const makeRgba = (width: number, height: number, fill: (x: number, y: number) => [number, number, number, number]) => {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b, a] = fill(x, y);
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
    }
  }
  return buf;
};

describe("gaussianBlurRGBA", () => {
  it("preserves a flat field (blurring a constant image returns the same values)", () => {
    const buf = makeRgba(8, 8, () => [120, 64, 200, 255]);
    const { r, g, b, a } = gaussianBlurRGBA(buf, 8, 8, 1.5);
    for (let i = 0; i < r.length; i++) {
      expect(r[i]).toBeCloseTo(120, 1);
      expect(g[i]).toBeCloseTo(64, 1);
      expect(b[i]).toBeCloseTo(200, 1);
      expect(a[i]).toBeCloseTo(255, 1);
    }
  });

  it("spreads a single bright pixel outward", () => {
    const buf = makeRgba(9, 9, (x, y) => (x === 4 && y === 4 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
    const { r } = gaussianBlurRGBA(buf, 9, 9, 1.5);
    // Center should be the brightest, neighbors brighter than far pixels
    const center = r[4 * 9 + 4];
    const neighbor = r[4 * 9 + 3];
    const far = r[0];
    expect(center).toBeGreaterThan(neighbor);
    expect(neighbor).toBeGreaterThan(far);
    // Total energy roughly preserved (kernel is normalized; edge clamping
    // can nudge it slightly). Accept within 5%.
    let total = 0;
    for (const v of r) total += v;
    expect(total).toBeGreaterThan(240);
    expect(total).toBeLessThan(270);
  });

  it("clamps reads at image edges (no NaN / Infinity)", () => {
    const buf = makeRgba(4, 4, () => [100, 100, 100, 100]);
    const { r, g, b, a } = gaussianBlurRGBA(buf, 4, 4, 2);
    for (const arr of [r, g, b, a]) {
      for (const v of arr) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});

describe("gaussianBlur1D", () => {
  it("preserves a flat single-channel field", () => {
    const data = new Float32Array(16).fill(0.5);
    const out = gaussianBlur1D(data, 4, 4, 1);
    for (const v of out) {
      expect(v).toBeCloseTo(0.5, 5);
    }
  });

  it("spreads a 1D impulse and preserves total mass", () => {
    const data = new Float32Array(25);
    data[12] = 10; // center pixel of 5x5
    const out = gaussianBlur1D(data, 5, 5, 1);
    expect(out[12]).toBeGreaterThan(0);
    expect(out[12]).toBeLessThan(10);
    let total = 0;
    for (const v of out) total += v;
    // Mass is preserved to first decimal (kernel normalization + edge clamp)
    expect(total).toBeGreaterThan(9.5);
    expect(total).toBeLessThan(10.5);
  });
});
