import { describe, expect, it } from "vitest";

import bilateralBlur from "filters/bilateralBlur";

const makeCanvas = (width: number, height: number, data: Uint8ClampedArray | number[]) => ({
  width,
  height,
  getContext: (type: string) => type === "2d" ? {
    getImageData: () => ({
      data: new Uint8ClampedArray(data),
      width,
      height,
    }),
  } : null,
});

const runAndCapture = (input, options): Uint8ClampedArray | null => {
  let captured: Uint8ClampedArray | null = null;
  const OriginalImageData = globalThis.ImageData;

  globalThis.ImageData = new Proxy(OriginalImageData, {
    construct(target, args): object {
      const instance = Reflect.construct(target, args) as object;
      if (args[0] instanceof Uint8ClampedArray) captured = args[0];
      return instance;
    },
  }) as typeof ImageData;

  try {
    bilateralBlur.func(input, options);
  } finally {
    globalThis.ImageData = OriginalImageData;
  }

  return captured;
};

describe("bilateralBlur", () => {
  it("enables the fast approximation options by default", () => {
    expect(bilateralBlur.defaults.useSeparableApproximation).toBe(true);
    expect(bilateralBlur.defaults.useDownsample).toBe(true);
    expect(bilateralBlur.defaults.downsampleFactor).toBe(2);
  });

  it("preserves strong edges while smoothing nearby tones", () => {
    const width = 3;
    const height = 1;
    const source = new Uint8ClampedArray([
      10, 10, 10, 255,
      12, 12, 12, 255,
      240, 240, 240, 255,
    ]);

    const out = runAndCapture(makeCanvas(width, height, source), {
      ...bilateralBlur.defaults,
      sigmaSpatial: 2,
      sigmaRange: 10,
      useSeparableApproximation: false,
      useDownsample: false,
    });

    expect(out).toBeTruthy();
    expect(out?.[0]).toBeGreaterThanOrEqual(10);
    expect(out?.[0]).toBeLessThanOrEqual(12);
    expect(out?.[4]).toBeGreaterThanOrEqual(10);
    expect(out?.[4]).toBeLessThanOrEqual(12);
    expect(out?.[8]).toBeGreaterThanOrEqual(238);
    expect(out).toHaveLength(width * height * 4);
  });

  it("returns a full-size output buffer with the default fast path", () => {
    const width = 4;
    const height = 4;
    const source = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < source.length; i += 4) {
      source[i] = (i / 4) * 7;
      source[i + 1] = 40;
      source[i + 2] = 180;
      source[i + 3] = 255;
    }

    const out = runAndCapture(makeCanvas(width, height, source), bilateralBlur.defaults);
    expect(out).toBeTruthy();
    expect(out).toHaveLength(width * height * 4);
  });
});
