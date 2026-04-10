import { describe, it, expect } from "vitest";
import curves from "filters/curves";

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
        height: ch
      })
    } : null
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
    }
  });

  try {
    filterFn(input, options);
  } finally {
    (globalThis as any).ImageData = OriginalImageData;
  }

  return captured;
};

describe("Curves filter", () => {
  it("brightens a midtone with a simple lifted curve", () => {
    const input = makeFakeInputCanvas(2, 2, [128, 128, 128, 255]);
    const data = runAndCapture(curves.func, input, {
      ...curves.defaults,
      points: JSON.stringify([[0, 0], [128, 192], [255, 255]])
    });
    expect(data).not.toBeNull();
    expect(data![0]).toBeGreaterThan(128);
    expect(data![1]).toBeGreaterThan(128);
    expect(data![2]).toBeGreaterThan(128);
    expect(data![3]).toBe(255);
  });
});
