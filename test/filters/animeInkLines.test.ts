import { describe, expect, it } from "vitest";

import animeInkLines from "filters/animeInkLines";

const makeFakeInputCanvas = (w: number, h: number, pixels: number[]) => {
  const data = new Uint8ClampedArray(pixels);
  return {
    width: w,
    height: h,
    getContext: (type: string) => type === "2d" ? {
      getImageData: (_x: number, _y: number, cw: number, ch: number) => ({
        data: new Uint8ClampedArray(data),
        width: cw,
        height: ch,
      }),
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

describe("Anime Ink Lines filter", () => {
  it("preserves non-edge source pixels in overlay mode", () => {
    const input = makeFakeInputCanvas(3, 1, [
      20, 20, 20, 255,
      250, 250, 250, 255,
      20, 20, 20, 255,
    ]);
    const data = runAndCapture(animeInkLines.func, input, {
      ...animeInkLines.defaults,
      palette: { ...animeInkLines.defaults.palette, options: { levels: 256 } },
    });

    expect(data).not.toBeNull();
    expect(Array.from(data!.slice(0, 4))).toEqual([20, 20, 20, 255]);
    expect(Array.from(data!.slice(8, 12))).toEqual([20, 20, 20, 255]);
  });

  it("supports a solid line-art output mode", () => {
    const input = makeFakeInputCanvas(3, 1, [
      20, 20, 20, 255,
      250, 250, 250, 255,
      20, 20, 20, 255,
    ]);
    const data = runAndCapture(animeInkLines.func, input, {
      ...animeInkLines.defaults,
      renderMode: "SOLID",
    });

    expect(data).not.toBeNull();
    expect(Array.from(data!.slice(0, 4))).toEqual([255, 255, 255, 255]);
  });
});
