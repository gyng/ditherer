import { describe, expect, it, vi } from "vitest";

vi.mock("utils", async importOriginal => {
  const actual = await importOriginal<typeof import("utils")>();
  return {
    ...actual,
    cloneCanvas: (original: any) => original,
  };
});

import temporalMedian from "filters/temporalMedian";

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
    temporalMedian.func(input, options);
  } finally {
    (globalThis as any).ImageData = OriginalImageData;
  }

  return captured;
};

const firstRed = (data: Uint8ClampedArray | null) => data ? data[0] : null;

describe("Time Median", () => {
  it("suppresses a one-frame bright outlier", () => {
    const dark = makeSolidCanvas(1, 1, [0, 0, 0, 255]);
    const bright = makeSolidCanvas(1, 1, [255, 255, 255, 255]);
    const options = { ...temporalMedian.defaults, windowSize: 3 };

    const frame0 = runAndCapture(dark, { ...options, _frameIndex: 0 });
    const frame1 = runAndCapture(bright, { ...options, _frameIndex: 1 });
    const frame2 = runAndCapture(dark, { ...options, _frameIndex: 2 });

    expect(firstRed(frame0)).toBe(0);
    expect(firstRed(frame1)).toBe(255);
    expect(firstRed(frame2)).toBe(0);
  });

  it("keeps the majority tone across the current history window", () => {
    const dark = makeSolidCanvas(1, 1, [0, 0, 0, 255]);
    const bright = makeSolidCanvas(1, 1, [255, 255, 255, 255]);
    const options = { ...temporalMedian.defaults, windowSize: 5 };

    runAndCapture(dark, { ...options, _frameIndex: 0 });
    runAndCapture(bright, { ...options, _frameIndex: 1 });
    runAndCapture(bright, { ...options, _frameIndex: 2 });
    runAndCapture(bright, { ...options, _frameIndex: 3 });
    const frame4 = runAndCapture(dark, { ...options, _frameIndex: 4 });

    expect(firstRed(frame4)).toBe(255);
  });

  it("resets history when animation restarts", () => {
    const bright = makeSolidCanvas(1, 1, [255, 255, 255, 255]);
    const dark = makeSolidCanvas(1, 1, [0, 0, 0, 255]);
    const options = { ...temporalMedian.defaults, windowSize: 3 };

    runAndCapture(bright, { ...options, _frameIndex: 0 });
    runAndCapture(bright, { ...options, _frameIndex: 1 });
    const restarted = runAndCapture(dark, { ...options, _frameIndex: 0 });

    expect(firstRed(restarted)).toBe(0);
  });
});
