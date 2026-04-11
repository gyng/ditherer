import { describe, expect, it } from "vitest";

import atmosphericHaze from "filters/atmosphericHaze";
import animeSky from "filters/animeSky";
import foliageSimplifier from "filters/foliageSimplifier";
import animeToneBands from "filters/animeToneBands";

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

describe("Anime look filters", () => {
  it("Atmospheric Haze cools brighter distant areas more strongly", () => {
    const input = makeFakeInputCanvas(1, 2, [
      180, 180, 180, 255,
      90, 90, 90, 255,
    ]);
    const data = runAndCapture(atmosphericHaze.func, input, atmosphericHaze.defaults);

    expect(data).not.toBeNull();
    expect(data![2]).toBeGreaterThan(data![0]);
    expect(data![2]).toBeGreaterThan(data![6]);
  });

  it("Anime Sky restyles likely top-of-frame sky pixels more than ground pixels", () => {
    const input = makeFakeInputCanvas(1, 2, [
      120, 170, 240, 255,
      130, 100, 80, 255,
    ]);
    const data = runAndCapture(animeSky.func, input, animeSky.defaults);

    expect(data).not.toBeNull();
    expect(data![2]).toBeGreaterThanOrEqual(data![0]);
    expect(Math.abs(data![4] - 130)).toBeLessThan(35);
  });

  it("Foliage Simplifier reduces color difference inside leafy regions", () => {
    const input = makeFakeInputCanvas(2, 1, [
      30, 120, 30, 255,
      90, 190, 70, 255,
    ]);
    const data = runAndCapture(foliageSimplifier.func, input, foliageSimplifier.defaults);

    expect(data).not.toBeNull();
    const sourceDiff = Math.abs(30 - 90) + Math.abs(120 - 190) + Math.abs(30 - 70);
    const outputDiff = Math.abs(data![0] - data![4]) + Math.abs(data![1] - data![5]) + Math.abs(data![2] - data![6]);
    expect(outputDiff).toBeLessThan(sourceDiff);
  });

  it("Anime Tone Bands snaps tones into broader bands", () => {
    const input = makeFakeInputCanvas(1, 1, [126, 146, 166, 255]);
    const data = runAndCapture(animeToneBands.func, input, animeToneBands.defaults);

    expect(data).not.toBeNull();
    expect(Array.from(data!.slice(0, 4))).not.toEqual([126, 146, 166, 255]);
    expect(data![3]).toBe(255);
  });
});
