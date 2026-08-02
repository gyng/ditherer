import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("utils")>();
  return { ...actual, cloneCanvas: (input: HTMLCanvasElement) => input };
});

import radialBlur, { defaults as radialBlurDefaults } from "filters/radialBlur";
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

afterEach(() => vi.restoreAllMocks());

describe("Radial Blur linear-light averaging (JS path)", () => {
  // W=5,H=1, center=(0,0): output pixel x=2 (black, self) samples exactly
  // three taps at x=0 (white), x=2 (self, black), x=4 (white) — strength is
  // chosen (3.25) so the offsets round to exactly those integer indices.
  it("averages bright+dark samples brighter in linear light than a naive gamma-space average", () => {
    const pixels: Pixel[] = [
      [255, 255, 255, 200],
      [255, 255, 255, 200],
      [0, 0, 0, 77],
      [255, 255, 255, 200],
      [255, 255, 255, 200],
    ];
    const fixture = makeCanvas(5, 1, pixels);
    radialBlur.func(fixture.canvas, {
      ...radialBlurDefaults,
      strength: 3.25,
      centerX: 0,
      centerY: 0,
      palette: identityPalette,
      _webglAcceleration: false,
    } as never);
    const out = fixture.output();
    const r = out[2 * 4];

    // Naive gamma-space average of (255, 0, 255) is 170. Averaging in linear
    // light and converting back is brighter (~213) because the sRGB EOTF is
    // convex — this is the property under test.
    const naiveGammaAverage = 170;
    expect(r).toBeGreaterThan(naiveGammaAverage);
    expect(r).toBeGreaterThanOrEqual(205);
    expect(r).toBeLessThanOrEqual(220);
  });

  it("preserves the center-tap alpha instead of averaging it across samples", () => {
    const pixels: Pixel[] = [
      [255, 255, 255, 200],
      [255, 255, 255, 200],
      [0, 0, 0, 77],
      [255, 255, 255, 200],
      [255, 255, 255, 200],
    ];
    const fixture = makeCanvas(5, 1, pixels);
    radialBlur.func(fixture.canvas, {
      ...radialBlurDefaults,
      strength: 3.25,
      centerX: 0,
      centerY: 0,
      palette: identityPalette,
      _webglAcceleration: false,
    } as never);
    const out = fixture.output();
    // Center pixel alpha (77) is preserved verbatim, not blended with the
    // sampled neighbours' alpha of 200 (which would average to 159).
    expect(out[2 * 4 + 3]).toBe(77);
  });
});
