import { describe, expect, it, vi } from "vitest";

vi.mock("utils", async importOriginal => {
  const actual = await importOriginal<typeof import("utils")>();
  return {
    ...actual,
    cloneCanvas: (original: any) => original,
  };
});

import temporalInkDrying from "filters/temporalInkDrying";

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
    temporalInkDrying.func(input, options);
  } finally {
    (globalThis as any).ImageData = OriginalImageData;
  }

  return captured;
};

describe("Ink Drying", () => {
  it("leaves a visible drying trace after a dark mark disappears", () => {
    const dark = makeSolidCanvas(1, 1, [0, 0, 0, 255]);
    const paper = makeSolidCanvas(1, 1, [255, 255, 255, 255]);
    const options = {
      ...temporalInkDrying.defaults,
      inkThreshold: 220,
      darkenAmount: 1,
      paperBleed: 0.5,
      dryRate: 0.05,
      edgeShrink: 0.4,
    };

    const frame0 = runAndCapture(dark, { ...options, _frameIndex: 0 });
    const frame1 = runAndCapture(paper, { ...options, _frameIndex: 1 });

    expect(frame0).not.toBeNull();
    expect(frame1).not.toBeNull();
    expect(frame0![0]).toBeLessThan(50);
    expect(frame1![0]).toBeLessThan(255);
  });

  it("offers distinct fountain pen and marker bleed styles", () => {
    const dark = makeSolidCanvas(1, 1, [0, 0, 0, 255]);
    const paper = makeSolidCanvas(1, 1, [255, 255, 255, 255]);

    runAndCapture(dark, { ...temporalInkDrying.defaults, style: "FOUNTAIN_PEN", _frameIndex: 0 });
    const pen = runAndCapture(paper, { ...temporalInkDrying.defaults, style: "FOUNTAIN_PEN", _frameIndex: 1 });

    runAndCapture(dark, { ...temporalInkDrying.defaults, style: "MARKER_BLEED", _frameIndex: 0 });
    const marker = runAndCapture(paper, { ...temporalInkDrying.defaults, style: "MARKER_BLEED", _frameIndex: 1 });

    expect(pen).not.toBeNull();
    expect(marker).not.toBeNull();
    expect(Array.from(pen!)).not.toEqual(Array.from(marker!));
  });
});
