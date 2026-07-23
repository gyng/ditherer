import { describe, expect, it, vi } from "vitest";

vi.mock("utils", async importOriginal => {
  const actual = await importOriginal<typeof import("utils")>();
  return {
    ...actual,
    cloneCanvas: (original: any) => original,
  };
});

import temporalColorCycle from "filters/temporalColorCycle";

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
    temporalColorCycle.func(input, options);
  } finally {
    (globalThis as any).ImageData = OriginalImageData;
  }

  return captured;
};

describe("Color Cycle alpha preservation", () => {
  it("keeps a semi-transparent pixel's alpha unchanged after the hue rotation", () => {
    const semiTransparent = makeSolidCanvas(1, 1, [200, 60, 30, 128]);
    const options = { ...temporalColorCycle.defaults, _frameIndex: 0 };

    const out = runAndCapture(semiTransparent, options);

    expect(out).not.toBeNull();
    expect(out![3]).toBe(128);
  });

  it("keeps a fully-transparent pixel at alpha 0", () => {
    const transparent = makeSolidCanvas(1, 1, [10, 220, 90, 0]);
    const options = { ...temporalColorCycle.defaults, _frameIndex: 0 };

    const out = runAndCapture(transparent, options);

    expect(out).not.toBeNull();
    expect(out![3]).toBe(0);
  });
});
