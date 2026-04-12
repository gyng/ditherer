import { describe, expect, it, vi } from "vitest";

vi.mock("utils", async importOriginal => {
  const actual = await importOriginal<typeof import("utils")>();
  return {
    ...actual,
    cloneCanvas: (original: any) => original,
  };
});

import abaBounce from "filters/abaBounce";
import abaGhost from "filters/abaGhost";
import abaRebound from "filters/abaRebound";
import flicker from "filters/flicker";

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

describe("ABA temporal filters", () => {
  it("ABA Bounce repeats the first frame on the third beat", () => {
    const a = makeSolidCanvas(1, 1, [10, 10, 10, 255]);
    const b = makeSolidCanvas(1, 1, [120, 120, 120, 255]);
    const c = makeSolidCanvas(1, 1, [240, 240, 240, 255]);
    const options = { ...abaBounce.defaults, strength: 1 };

    const frame0 = runAndCapture(abaBounce.func, a, { ...options, _frameIndex: 0 });
    const frame1 = runAndCapture(abaBounce.func, b, { ...options, _frameIndex: 1 });
    const frame2 = runAndCapture(abaBounce.func, c, { ...options, _frameIndex: 2 });

    expect(frame0?.[0]).toBe(10);
    expect(frame1?.[0]).toBe(120);
    expect(frame2?.[0]).toBe(0);
  });

  it("ABA Ghost mixes the first and second beat on the ghosted frame", () => {
    const a = makeSolidCanvas(1, 1, [0, 0, 0, 255]);
    const b = makeSolidCanvas(1, 1, [100, 100, 100, 255]);
    const c = makeSolidCanvas(1, 1, [200, 200, 200, 255]);
    const options = { ...abaGhost.defaults, ghostMix: 0.5, persistence: 0, flash: 1 };

    runAndCapture(abaGhost.func, a, { ...options, _frameIndex: 0 });
    runAndCapture(abaGhost.func, b, { ...options, _frameIndex: 1 });
    const frame2 = runAndCapture(abaGhost.func, c, { ...options, _frameIndex: 2 });

    expect(frame2?.[0]).toBe(50);
    expect(frame2?.[1]).toBe(50);
    expect(frame2?.[2]).toBe(50);
  });

  it("ABA Ghost persistence carries visible ghosting into the next triplet", () => {
    const a = makeSolidCanvas(1, 1, [0, 0, 0, 255]);
    const b = makeSolidCanvas(1, 1, [100, 100, 100, 255]);
    const c = makeSolidCanvas(1, 1, [200, 200, 200, 255]);
    const nextA = makeSolidCanvas(1, 1, [0, 0, 0, 255]);
    const options = { ...abaGhost.defaults, ghostMix: 1, persistence: 0.9, flash: 1 };

    runAndCapture(abaGhost.func, a, { ...options, _frameIndex: 0 });
    runAndCapture(abaGhost.func, b, { ...options, _frameIndex: 1 });
    runAndCapture(abaGhost.func, c, { ...options, _frameIndex: 2 });
    const frame3 = runAndCapture(abaGhost.func, nextA, { ...options, _frameIndex: 3 });

    expect(frame3).not.toBeNull();
    expect(frame3![0]).toBeGreaterThan(0);
  });

  it("ABA Rebound overshoots motion on the third beat", () => {
    const a = makeSolidCanvas(1, 1, [20, 20, 20, 255]);
    const b = makeSolidCanvas(1, 1, [40, 40, 40, 255]);
    const c = makeSolidCanvas(1, 1, [100, 100, 100, 255]);
    const options = { ...abaRebound.defaults, strength: 2, threshold: 0 };

    runAndCapture(abaRebound.func, a, { ...options, _frameIndex: 0 });
    runAndCapture(abaRebound.func, b, { ...options, _frameIndex: 1 });
    const frame2 = runAndCapture(abaRebound.func, c, { ...options, _frameIndex: 2 });

    expect(frame2).not.toBeNull();
    expect(frame2![0]).toBeGreaterThanOrEqual(150);
  });

  it("Flicker live ghost mode reuses the old live-frame flicker behavior", () => {
    const a = makeSolidCanvas(1, 1, [0, 0, 0, 255]);
    const b = makeSolidCanvas(1, 1, [60, 60, 60, 255]);
    const c = makeSolidCanvas(1, 1, [200, 200, 200, 255]);
    const options = { ...flicker.defaults, mode: "LIVE_GHOST", amount: 0.5, flash: 1 };

    runAndCapture(flicker.func, a, { ...options, _frameIndex: 0 });
    runAndCapture(flicker.func, b, { ...options, _frameIndex: 1 });
    const frame2 = runAndCapture(flicker.func, c, { ...options, _frameIndex: 2 });

    expect(frame2?.[0]).toBe(100);
    expect(frame2?.[1]).toBe(100);
    expect(frame2?.[2]).toBe(100);
  });
});
