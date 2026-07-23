import { describe, expect, it, vi } from "vitest";

vi.mock("utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("utils")>();
  return { ...actual, cloneCanvas: (input: HTMLCanvasElement) => input };
});

import motionBlur, { defaults as motionBlurDefaults } from "filters/motionBlur";
import { srgbToLinear, linearToSrgb } from "filters/opticalConvolutionContracts";
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
    getContext: (type: string) => type === "2d" ? {
      getImageData: () => ({ data: new Uint8ClampedArray(source), width, height }),
      putImageData: (image: { data: Uint8ClampedArray }) => { written = new Uint8ClampedArray(image.data); },
    } : null,
  } as unknown as HTMLCanvasElement;
  return { canvas, output: () => { if (!written) throw new Error("no output"); return written; } };
};

describe("Motion Blur linear-light averaging (JS path)", () => {
  it("averages a bright and a dark tap in linear light, brighter than the naive gamma average", () => {
    // width=2,height=1 forces the clamp-to-edge branch for every tap (H-1=0
    // makes sy0 >= H-1 always true), so the two length=1 taps (t=-0.5,+0.5)
    // land exactly on the dark and bright source texels with no bilinear
    // blending muddying the arithmetic.
    const dark = 10;
    const bright = 245;
    const fixture = makeCanvas(2, 1, [
      [dark, dark, dark, 255],
      [bright, bright, bright, 128],
    ]);

    motionBlur.func(fixture.canvas, {
      ...motionBlurDefaults,
      angle: 0,
      length: 1,
      palette: identityPalette,
      _webglAcceleration: false,
    } as never);

    const out = fixture.output();
    const naiveGammaAvg = Math.round((dark + bright) / 2);
    const linearRef = Math.round(
      linearToSrgb((srgbToLinear(dark / 255) + srgbToLinear(bright / 255)) / 2) * 255,
    );

    expect(out[0]).toBeGreaterThan(naiveGammaAvg);
    expect(out[0]).toBe(linearRef);
  });

  it("preserves the centre pixel's own alpha instead of blending tap alphas", () => {
    const fixture = makeCanvas(2, 1, [
      [10, 10, 10, 255],
      [245, 245, 245, 128],
    ]);

    motionBlur.func(fixture.canvas, {
      ...motionBlurDefaults,
      angle: 0,
      length: 1,
      palette: identityPalette,
      _webglAcceleration: false,
    } as never);

    const out = fixture.output();
    expect(out[3]).toBe(255); // pixel 0's own alpha, not a 255/128 blend
    expect(out[7]).toBe(128); // pixel 1's own alpha
  });
});
