import { describe, expect, it, vi } from "vitest";

vi.mock("utils", async importOriginal => {
  const actual = await importOriginal<typeof import("utils")>();
  return {
    ...actual,
    cloneCanvas: (original: any) => original,
  };
});

import ditherGradient from "filters/ditherGradient";

const makeCanvas = (width: number, height: number, fill: [number, number, number, number]) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = fill[3];
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
    ditherGradient.func(input as any, options);
  } finally {
    (globalThis as any).ImageData = OriginalImageData;
  }

  return captured;
};

describe("Dither Gradient", () => {
  it("responds to source luminance instead of generating the same pattern for every input", () => {
    const darkOutput = runAndCapture(makeCanvas(4, 4, [32, 32, 32, 255]), {
      ...ditherGradient.defaults,
      color1: [96, 96, 96],
      color2: [160, 160, 160],
      angle: 0,
      amount: 1,
      sourceInfluence: 1,
      detailInfluence: 0,
      palette: {
        name: "Binary",
        options: {},
        getColor: (pixel: number[]) => {
          const value = pixel[0] >= 128 ? 255 : 0;
          return [value, value, value, 255];
        },
      },
    });

    const brightOutput = runAndCapture(makeCanvas(4, 4, [224, 224, 224, 255]), {
      ...ditherGradient.defaults,
      color1: [96, 96, 96],
      color2: [160, 160, 160],
      angle: 0,
      amount: 1,
      sourceInfluence: 1,
      detailInfluence: 0,
      palette: {
        name: "Binary",
        options: {},
        getColor: (pixel: number[]) => {
          const value = pixel[0] >= 128 ? 255 : 0;
          return [value, value, value, 255];
        },
      },
    });

    expect(darkOutput).not.toBeNull();
    expect(brightOutput).not.toBeNull();
    expect(Array.from(darkOutput!)).not.toEqual(Array.from(brightOutput!));
  });

  it("offers distinct print and dreamy styles", () => {
    const source = makeCanvas(4, 4, [160, 96, 192, 255]);
    const base = {
      ...ditherGradient.defaults,
      color1: [40, 20, 80],
      color2: [250, 220, 120],
      angle: 45,
      amount: 0.8,
      sourceInfluence: 0.7,
      detailInfluence: 0.5,
      palette: {
        name: "Binary",
        options: {},
        getColor: (pixel: number[]) => {
          const value = pixel[0] >= 128 ? 255 : 0;
          return [value, value, value, 255];
        },
      },
    };

    const printOutput = runAndCapture(source, {
      ...base,
      style: "PRINT",
    });
    const dreamyOutput = runAndCapture(source, {
      ...base,
      style: "DREAMY",
      sourceColorMix: 0.6,
    });

    expect(printOutput).not.toBeNull();
    expect(dreamyOutput).not.toBeNull();
    expect(Array.from(printOutput!)).not.toEqual(Array.from(dreamyOutput!));
  });
});
