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

describe("Error diffusing temporal vote", () => {
  it("holds the recent majority instead of following a one-frame outlier", () => {
    const dark = makeFakeInputCanvas(1, 1, [0, 0, 0, 255]);
    const bright = makeFakeInputCanvas(1, 1, [255, 255, 255, 255]);
    const options = {
      ...floydSteinberg.defaults,
      palette: binaryPalette,
      temporalMode: "VOTE",
      voteWindow: 3,
      _linearize: false,
    };

    const frame0 = runAndCapture(floydSteinberg.func, dark, { ...options, _frameIndex: 0 });
    const frame1 = runAndCapture(floydSteinberg.func, dark, { ...options, _frameIndex: 1 });
    const frame2 = runAndCapture(floydSteinberg.func, bright, { ...options, _frameIndex: 2 });

    expect(Array.from(frame0!)).toEqual([0, 0, 0, 255]);
    expect(Array.from(frame1!)).toEqual([0, 0, 0, 255]);
    expect(Array.from(frame2!)).toEqual([0, 0, 0, 255]);
  });
});
