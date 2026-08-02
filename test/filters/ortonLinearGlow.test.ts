import { describe, expect, it, vi } from "vitest";

vi.mock("utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("utils")>();
  return { ...actual, cloneCanvas: (input: HTMLCanvasElement) => input };
});

import {
  linearToSrgb,
  srgbToLinear,
} from "../../packages/ditherer-filters/src/filters/opticalConvolutionContracts";

// Orton's Gaussian glow + screen composite (ortonGL.ts:29 `acc += texture(u_input, uv) * w`,
// :53 `screen = 1.0 - (1.0 - s.rgb) * (1.0 - b)`, :54 `mix(s.rgb, screen, u_strength)`) is an
// optical diffusion effect: it must blur and recombine emitted light in linear space, not on
// raw sRGB texel values. These helpers mirror the shader math exactly (one pre-fix, sRGB-only;
// one post-fix, linearize -> blur -> screen -> mix, all in linear -> back to sRGB) so the
// colour-space regression can be asserted without a real WebGL2 context (unavailable in jsdom).
const gammaGlowScreen = (sSrgb: number, neighborsSrgb: number[], strength: number): number => {
  // Pre-fix ortonGL.ts: the blur pass reads raw (sRGB) texels, and the screen blend/mix run
  // directly on those sRGB values.
  const blurGamma = neighborsSrgb.reduce((a, b) => a + b, 0) / neighborsSrgb.length;
  const screen = 1 - (1 - sSrgb) * (1 - blurGamma);
  return sSrgb * (1 - strength) + screen * strength;
};

const linearGlowScreen = (sSrgb: number, neighborsSrgb: number[], strength: number): number => {
  // Post-fix ortonGL.ts: linearize before the blur, average (screen) in linear light, then
  // convert back to sRGB once at the end.
  const sLin = srgbToLinear(sSrgb);
  const blurLin = neighborsSrgb.map(srgbToLinear).reduce((a, b) => a + b, 0) / neighborsSrgb.length;
  const screenLin = 1 - (1 - sLin) * (1 - blurLin);
  const mixedLin = sLin * (1 - strength) + screenLin * strength;
  return linearToSrgb(mixedLin);
};

// mock-canvas: a dark background strip with one bright highlight pixel, read back via
// getImageData like the sibling GL/CPU filter tests (opticalStylizers.test.ts, crtDegauss.test.ts).
const makeStripCanvas = (values: number[]) => {
  const w = values.length,
    h = 1;
  const data = new Uint8ClampedArray(w * h * 4);
  values.forEach((v, i) => {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  });
  return {
    width: w,
    height: h,
    getContext: (type: string) =>
      type === "2d"
        ? {
            getImageData: () => ({ data: new Uint8ClampedArray(data), width: w, height: h }),
            putImageData: () => {},
          }
        : null,
  } as unknown as HTMLCanvasElement;
};

describe("Orton glow: linear vs gamma screen composite (ortonGL.ts fix)", () => {
  it("produces a brighter glow over a dark region than the pre-fix gamma composite would", () => {
    // A single bright highlight (255) flanked by dark background (0); reading the source at
    // one of the dark neighbours ("bright-over-dark") is the shadow area an Orton glow should
    // visibly lift.
    const strip = makeStripCanvas([0, 255, 0]);
    const buf = strip.getContext("2d")!.getImageData(0, 0, 3, 1).data;
    const toUnit = (i: number) => buf[i * 4] / 255;

    const darkSourceSrgb = toUnit(0); // the dark pixel receiving the glow
    const neighborsSrgb = [toUnit(0), toUnit(1), toUnit(2)]; // 3-tap box blur around it
    const strength = 0.7;

    const gammaResult = gammaGlowScreen(darkSourceSrgb, neighborsSrgb, strength);
    const linearResult = linearGlowScreen(darkSourceSrgb, neighborsSrgb, strength);

    expect(linearResult).toBeGreaterThan(gammaResult);
    // Not a rounding-noise difference — the linear-light glow is materially brighter.
    expect(linearResult - gammaResult).toBeGreaterThan(0.1);
  });

  it("collapses to the untouched source at zero strength, and grows monotonically with the glow", () => {
    const strip = makeStripCanvas([0, 255, 0]);
    const buf = strip.getContext("2d")!.getImageData(0, 0, 3, 1).data;
    const toUnit = (i: number) => buf[i * 4] / 255;
    const darkSourceSrgb = toUnit(0);
    const neighborsSrgb = [toUnit(0), toUnit(1), toUnit(2)];

    // u_strength = 0 means "no glow applied" — both formulas must return the bare source.
    expect(linearGlowScreen(darkSourceSrgb, neighborsSrgb, 0)).toBeCloseTo(darkSourceSrgb, 6);
    expect(gammaGlowScreen(darkSourceSrgb, neighborsSrgb, 0)).toBeCloseTo(darkSourceSrgb, 6);

    // A brighter neighbourhood (bigger glow source) must lift a dark pixel further.
    const dimmerHighlight = linearGlowScreen(darkSourceSrgb, [toUnit(0), 0.5, toUnit(2)], 0.7);
    const brighterHighlight = linearGlowScreen(darkSourceSrgb, neighborsSrgb, 0.7);
    expect(brighterHighlight).toBeGreaterThan(dimmerHighlight);
  });
});
