import { describe, expect, it, vi } from "vitest";

vi.mock("utils", async importOriginal => {
  const actual = await importOriginal<typeof import("utils")>();
  return {
    ...actual,
    cloneCanvas: (original: any) => original,
  };
});

import { floydSteinberg } from "filters/errorDiffusing";

const binaryPalette = {
  name: "Binary",
  options: {},
  getColor: (pixel: number[]) => {
    const value = pixel[0] >= 128 ? 255 : 0;
    return [value, value, value, 255];
  },
};

const makeFakeInputCanvas = (w: number, h: number, fill: number[]) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = fill[3];
  }
  return {
    width: w,
    height: h,
    getContext: (type: string) => type === "2d" ? {
      getImageData: (_x: number, _y: number, cw: number, ch: number) => ({
        data: new Uint8ClampedArray(data),
        width: cw,
        height: ch,
      }),
      putImageData: () => {},
    } : null,
  };
};

const runAndCapture = (filterFn, input, options): Uint8ClampedArray | null => {
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
    filterFn(input, options);
  } finally {
    (globalThis as any).ImageData = OriginalImageData;
  }

  return captured;
};

describe("Error diffusing temporal bleed", () => {
  it("does not bias a pixel when the previous frame had no residual error", () => {
    const input = makeFakeInputCanvas(1, 1, [140, 140, 140, 255]);
    const previous = new Uint8ClampedArray([255, 255, 255, 255]);

    const data = runAndCapture(floydSteinberg.func, input, {
      ...floydSteinberg.defaults,
      palette: binaryPalette,
      temporalBleed: 1,
      _prevInput: previous,
      _prevOutput: previous,
      _linearize: false,
    });

    expect(data).not.toBeNull();
    expect(Array.from(data!)).toEqual([255, 255, 255, 255]);
  });
});
