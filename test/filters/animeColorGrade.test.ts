import { describe, it, expect } from "vitest";
import animeColorGrade from "filters/animeColorGrade";

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

describe("Anime Color Grade filter", () => {
  it("pushes dark tones cooler", () => {
    const input = makeFakeInputCanvas(1, 1, [40, 40, 40, 255]);
    const data = runAndCapture(animeColorGrade.func, input, animeColorGrade.defaults);

    expect(data).not.toBeNull();
    expect(data![2]).toBeGreaterThan(data![0]);
    expect(data![1]).toBeGreaterThanOrEqual(data![0]);
  });

  it("warms bright tones", () => {
    const input = makeFakeInputCanvas(1, 1, [220, 220, 220, 255]);
    const data = runAndCapture(animeColorGrade.func, input, animeColorGrade.defaults);

    expect(data).not.toBeNull();
    expect(data![0]).toBeGreaterThanOrEqual(data![1]);
    expect(data![1]).toBeGreaterThan(data![2]);
  });

  it("visibly grades ordinary midtones with the default settings", () => {
    const input = makeFakeInputCanvas(1, 1, [128, 128, 128, 255]);
    const data = runAndCapture(animeColorGrade.func, input, animeColorGrade.defaults);

    expect(data).not.toBeNull();
    expect(data![2] - data![0]).toBeGreaterThanOrEqual(6);
  });

  it("noticeably shifts a typical photo-like blue gray", () => {
    const input = makeFakeInputCanvas(1, 1, [110, 130, 150, 255]);
    const data = runAndCapture(animeColorGrade.func, input, animeColorGrade.defaults);

    expect(data).not.toBeNull();
    expect(Array.from(data!.slice(0, 3))).not.toEqual([110, 130, 150]);
  });

  it("returns the base image unchanged when mix is zero and tonal controls are neutral", () => {
    const input = makeFakeInputCanvas(1, 1, [120, 150, 180, 255]);
    const data = runAndCapture(animeColorGrade.func, input, {
      ...animeColorGrade.defaults,
      shadowCool: 0,
      highlightWarm: 0,
      contrast: 0,
      midtoneLift: 0,
      vibrance: 0,
      mix: 0,
    });

    expect(data).not.toBeNull();
    expect(Array.from(data!.slice(0, 4))).toEqual([120, 150, 180, 255]);
  });
});
