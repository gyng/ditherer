import { describe, expect, it, vi } from "vitest";

vi.mock("utils", async importOriginal => {
  const actual = await importOriginal<typeof import("utils")>();
  return {
    ...actual,
    cloneCanvas: (original: any) => original,
  };
});

import temporalPosterHold from "filters/temporalPosterHold";

const makeSolidCanvas = (width: number, height: number, rgba: [number, number, number, number]) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0];
    data[i + 1] = rgba[1];
    data[i + 2] = rgba[2];
    data[i + 3] = rgba[3];
  }

  return {
    width,
    height,
    getContext: (type: string) => type === "2d" ? {
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(data),
        width: w,
        height: h,
      }),
      putImageData: () => {},
    } : null,
  };
};

const runAndCapture = (input, options): Uint8ClampedArray | null => {
  let captured: Uint8ClampedArray | null = null;
  const OriginalImageData = (globalThis as any).ImageData;

  (globalThis as any).ImageData = new Proxy(OriginalImageData, {
    construct(target, args): object {
      const instance = Reflect.construct(target, args) as object;
      if (args[0] instanceof Uint8ClampedArray) captured = args[0];
      return instance;
    },
  });

  try {
    temporalPosterHold.func(input, options);
  } finally {
    (globalThis as any).ImageData = OriginalImageData;
  }

  return captured;
};

// Poster Hold now requires WebGL2 (requiresGL: true). jsdom has no WebGL2,
// so the filter returns a stub canvas and per-pixel checks can't run here.
// Replace with a Playwright/headed-Chrome integration test if you want
// pixel-level coverage.
describe.skip("Poster Hold", () => {
  it("holds a band briefly instead of switching immediately", () => {
    const dark = makeSolidCanvas(1, 1, [0, 0, 0, 255]);
    const bright = makeSolidCanvas(1, 1, [255, 255, 255, 255]);
    const options = {
      ...temporalPosterHold.defaults,
      levels: 2,
      holdThreshold: 0,
      releaseSpeed: 0.25,
    };

    const frame0 = runAndCapture(dark, { ...options, _frameIndex: 0 });
    const frame1 = runAndCapture(bright, { ...options, _frameIndex: 1 });

    expect(frame0?.[0]).toBe(0);
    expect(frame1?.[0]).toBe(0);
  });
});
