import { describe, expect, it, vi } from "vitest";

vi.mock("utils", async importOriginal => {
  const actual = await importOriginal<typeof import("utils")>();
  return {
    ...actual,
    cloneCanvas: (original: any) => original,
  };
});

import timeMosaic from "filters/timeMosaic";

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
    timeMosaic.func(input, options);
  } finally {
    (globalThis as any).ImageData = OriginalImageData;
  }

  return captured;
};

describe("Time Mosaic stabilizer", () => {
  it("holds a quiet tile until its hold budget expires", () => {
    const dark = makeSolidCanvas(2, 2, [0, 0, 0, 255]);
    const bright = makeSolidCanvas(2, 2, [255, 255, 255, 255]);
    const brightBuf = bright.getContext("2d")!.getImageData(0, 0, 2, 2).data;
    const options = {
      ...timeMosaic.defaults,
      behavior: "STABILIZER",
      tileSize: 2,
      holdFrames: 2,
      motionThreshold: 999,
    };

    const frame0 = runAndCapture(dark, { ...options, _frameIndex: 0 });
    const frame1 = runAndCapture(bright, { ...options, _frameIndex: 1, _prevInput: new Uint8ClampedArray(frame0!) });
    const frame2 = runAndCapture(bright, { ...options, _frameIndex: 2, _prevInput: new Uint8ClampedArray(brightBuf) });
    const frame3 = runAndCapture(bright, { ...options, _frameIndex: 3, _prevInput: new Uint8ClampedArray(brightBuf) });

    expect(frame0?.[0]).toBe(0);
    expect(frame1?.[0]).toBe(0);
    expect(frame2?.[0]).toBe(255);
    expect(frame3?.[0]).toBe(255);
  });
});
