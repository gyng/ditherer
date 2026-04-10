import { describe, expect, it, vi } from "vitest";

vi.mock("utils", async importOriginal => {
  const actual = await importOriginal<typeof import("utils")>();
  return {
    ...actual,
    cloneCanvas: (original: any) => original,
  };
});

import flipDotDisplay from "filters/flipDotDisplay";

const makeSolidCanvas = (w: number, h: number, rgba: [number, number, number, number]) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgba[0];
    data[i + 1] = rgba[1];
    data[i + 2] = rgba[2];
    data[i + 3] = rgba[3];
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
    flipDotDisplay.func(input, options);
  } finally {
    (globalThis as any).ImageData = OriginalImageData;
  }

  return captured;
};

const countLitCenters = (data: Uint8ClampedArray, w: number, h: number, cellSize: number): number => {
  const cols = Math.ceil(w / cellSize);
  const rows = Math.ceil(h / cellSize);
  let lit = 0;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = Math.min(w - 1, Math.floor(cx * cellSize + cellSize * 0.5));
      const y = Math.min(h - 1, Math.floor(cy * cellSize + cellSize * 0.5));
      const i = (y * w + x) * 4;
      if (data[i] > 100) lit++;
    }
  }
  return lit;
};

const centerRed = (data: Uint8ClampedArray, w: number, h: number): number => {
  const x = Math.floor(w * 0.5);
  const y = Math.floor(h * 0.5);
  return data[(y * w + x) * 4];
};

describe("Flip-Dot Display", () => {
  it("respects maxFlipRate as a per-frame cap", () => {
    const input = makeSolidCanvas(4, 4, [0, 0, 0, 255]);
    const options = {
      ...flipDotDisplay.defaults,
      cellSize: 2,
      gap: 0,
      jitter: 0,
      specular: 0,
      stuckDotRate: 0,
      maxFlipRate: 0.25,
      responseFrames: 1,
      _frameIndex: 0,
    };

    const frame0 = runAndCapture(input, options);
    expect(frame0).not.toBeNull();
    expect(countLitCenters(frame0!, 4, 4, 2)).toBe(1);

    const frame1 = runAndCapture(input, { ...options, _frameIndex: 1 });
    expect(frame1).not.toBeNull();
    expect(countLitCenters(frame1!, 4, 4, 2)).toBe(2);
  });

  it("uses hysteresis to avoid toggling inside the deadband", () => {
    const dark = makeSolidCanvas(2, 2, [0, 0, 0, 255]);
    const nearThreshold = makeSolidCanvas(2, 2, [135, 135, 135, 255]);

    const base = {
      ...flipDotDisplay.defaults,
      cellSize: 2,
      gap: 0,
      jitter: 0,
      specular: 0,
      stuckDotRate: 0,
      maxFlipRate: 1,
      responseFrames: 1,
      threshold: 128,
      hysteresis: 12,
    };

    const frame0 = runAndCapture(dark, { ...base, _frameIndex: 0 });
    expect(frame0).not.toBeNull();
    expect(countLitCenters(frame0!, 2, 2, 2)).toBe(1);

    const frame1 = runAndCapture(nearThreshold, { ...base, _frameIndex: 1 });
    expect(frame1).not.toBeNull();
    expect(countLitCenters(frame1!, 2, 2, 2)).toBe(1);
  });

  it("simulates mechanical response delay across multiple frames", () => {
    const dark = makeSolidCanvas(2, 2, [0, 0, 0, 255]);
    const options = {
      ...flipDotDisplay.defaults,
      cellSize: 2,
      gap: 0,
      jitter: 0,
      specular: 0,
      stuckDotRate: 0,
      threshold: 128,
      hysteresis: 0,
      maxFlipRate: 1,
      responseFrames: 3,
    };

    const frame0 = runAndCapture(dark, { ...options, _frameIndex: 0 });
    const frame1 = runAndCapture(dark, { ...options, _frameIndex: 1 });
    const frame2 = runAndCapture(dark, { ...options, _frameIndex: 2 });

    expect(frame0).not.toBeNull();
    expect(frame1).not.toBeNull();
    expect(frame2).not.toBeNull();
    const r0 = centerRed(frame0!, 2, 2);
    const r1 = centerRed(frame1!, 2, 2);
    const r2 = centerRed(frame2!, 2, 2);
    expect(r0).toBeLessThan(r1);
    expect(r1).toBeLessThanOrEqual(r2);
  });
});
