import { describe, expect, it, vi } from "vitest";

vi.mock("utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("utils")>();
  return {
    ...actual,
    cloneCanvas: (original: any) => original,
  };
});

import motionPixelate from "filters/motionPixelate";

const makeFakeCanvas = (width: number, height: number, data: Uint8ClampedArray) => ({
  width,
  height,
  getContext: (type: string) =>
    type === "2d"
      ? {
          getImageData: () => ({
            data: new Uint8ClampedArray(data),
            width,
            height,
          }),
          putImageData: () => {},
        }
      : null,
});

const runAndCapture = (input: any, options: any): Uint8ClampedArray | null => {
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
    motionPixelate.func(input, options);
  } finally {
    (globalThis as any).ImageData = OriginalImageData;
  }

  return captured;
};

describe("Motion Pixelate", () => {
  it("preserves source alpha in the pass-through (no-EMA) path", () => {
    const input = makeFakeCanvas(1, 1, new Uint8ClampedArray([200, 100, 50, 128]));
    const data = runAndCapture(input, {
      ...motionPixelate.defaults,
      _ema: null,
    });

    expect(data![3]).toBe(128);
  });

  it("keeps a transparent tile transparent when it is not pixelated (below threshold, pass-through branch)", () => {
    const input = makeFakeCanvas(
      2,
      2,
      new Uint8ClampedArray([10, 10, 10, 0, 10, 10, 10, 0, 10, 10, 10, 0, 10, 10, 10, 0]),
    );
    const data = runAndCapture(input, {
      ...motionPixelate.defaults,
      blockSize: 2,
      threshold: 50,
      invert: false,
      _ema: new Float32Array([10, 10, 10, 0, 10, 10, 10, 0, 10, 10, 10, 0, 10, 10, 10, 0]),
    });

    expect(data![3]).toBe(0);
    expect(data![7]).toBe(0);
    expect(data![11]).toBe(0);
    expect(data![15]).toBe(0);
  });

  it("keeps a transparent tile transparent when it is pixelated (averaged branch)", () => {
    const input = makeFakeCanvas(
      2,
      2,
      new Uint8ClampedArray([10, 10, 10, 0, 200, 200, 200, 0, 10, 10, 10, 0, 200, 200, 200, 0]),
    );
    const data = runAndCapture(input, {
      ...motionPixelate.defaults,
      blockSize: 2,
      threshold: 0,
      invert: false,
      _ema: new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    });

    expect(data![3]).toBe(0);
    expect(data![7]).toBe(0);
    expect(data![11]).toBe(0);
    expect(data![15]).toBe(0);
  });
});
