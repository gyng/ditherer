import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("utils")>();
  return { ...actual, cloneCanvas: (input: HTMLCanvasElement) => input };
});

import despeckle, { defaults as despeckleDefaults } from "filters/despeckle";
import sharpen, { defaults as sharpenDefaults } from "filters/sharpen";
import nearest from "palettes/nearest";

const identityPalette = { ...nearest, options: { levels: 256 } };

type Pixel = readonly [number, number, number, number];

const makeCanvas = (width: number, height: number, pixels: Pixel[]) => {
  const source = new Uint8ClampedArray(width * height * 4);
  pixels.forEach((p, i) => source.set(p, i * 4));
  let written: Uint8ClampedArray | null = null;
  const canvas = {
    width,
    height,
    getContext: (type: string) =>
      type === "2d"
        ? {
            getImageData: () => ({ data: new Uint8ClampedArray(source), width, height }),
            putImageData: (image: { data: Uint8ClampedArray }) => {
              written = new Uint8ClampedArray(image.data);
            },
          }
        : null,
  } as unknown as HTMLCanvasElement;
  return {
    canvas,
    output: () => {
      if (!written) throw new Error("no output");
      return written;
    },
  };
};

const gray = (v: number, a = 255): Pixel => [v, v, v, a];

afterEach(() => vi.restoreAllMocks());

describe("Despeckle edge-preserving median (JS path)", () => {
  it("removes a salt impulse but keeps the surrounding field", () => {
    const w = 5,
      h = 5;
    const pixels = Array.from({ length: w * h }, () => gray(40));
    pixels[12] = gray(250); // centre impulse
    const fixture = makeCanvas(w, h, pixels);
    despeckle.func(fixture.canvas, {
      ...despeckleDefaults,
      radius: 2,
      threshold: 15,
      palette: identityPalette,
      _webglAcceleration: false,
    } as never);
    const out = fixture.output();
    expect(out[12 * 4]).toBeLessThan(80); // impulse pulled back toward the field
  });

  it("preserves a step edge instead of blurring it", () => {
    const w = 6,
      h = 3;
    const pixels: Pixel[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pixels.push(gray(x < w / 2 ? 40 : 200));
    const fixture = makeCanvas(w, h, pixels);
    despeckle.func(fixture.canvas, {
      ...despeckleDefaults,
      radius: 2,
      threshold: 15,
      palette: identityPalette,
      _webglAcceleration: false,
    } as never);
    const out = fixture.output();
    let lo = 255,
      hi = 0;
    for (let i = 0; i < out.length; i += 4) {
      lo = Math.min(lo, out[i]);
      hi = Math.max(hi, out[i]);
    }
    expect(hi - lo).toBeGreaterThan(140); // edge contrast retained (not box-blurred)
  });

  it("preserves source alpha and tolerates malformed options", () => {
    const fixture = makeCanvas(
      3,
      3,
      Array.from({ length: 9 }, () => gray(120, 128)),
    );
    expect(() =>
      despeckle.func(fixture.canvas, {
        radius: Number.NaN,
        threshold: "x",
        palette: identityPalette,
        _webglAcceleration: false,
      } as never),
    ).not.toThrow();
    const out = fixture.output();
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(128);
  });
});

describe("Sharpen Gaussian unsharp mask (JS path)", () => {
  it("overshoots on both sides of a step edge (raises local contrast)", () => {
    const pixels: Pixel[] = [40, 40, 40, 40, 200, 200, 200, 200].map((v) => gray(v));
    const fixture = makeCanvas(8, 1, pixels);
    sharpen.func(fixture.canvas, {
      ...sharpenDefaults,
      strength: 1.5,
      radius: 2,
      threshold: 0,
      palette: identityPalette,
      _webglAcceleration: false,
    } as never);
    const out = fixture.output();
    expect(out[3 * 4]).toBeLessThan(40); // dark side undershoots
    expect(out[4 * 4]).toBeGreaterThan(200); // bright side overshoots
  });

  it("leaves a flat region unchanged", () => {
    const fixture = makeCanvas(
      6,
      1,
      Array.from({ length: 6 }, () => gray(128)),
    );
    sharpen.func(fixture.canvas, {
      ...sharpenDefaults,
      strength: 2,
      radius: 3,
      threshold: 0,
      palette: identityPalette,
      _webglAcceleration: false,
    } as never);
    const out = fixture.output();
    for (let i = 0; i < out.length; i += 4) expect(out[i]).toBe(128);
  });

  it("preserves source alpha", () => {
    const fixture = makeCanvas(
      8,
      1,
      [40, 40, 40, 40, 200, 200, 200, 200].map((v) => gray(v, 96)),
    );
    sharpen.func(fixture.canvas, {
      ...sharpenDefaults,
      palette: identityPalette,
      _webglAcceleration: false,
    } as never);
    const out = fixture.output();
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(96);
  });
});
