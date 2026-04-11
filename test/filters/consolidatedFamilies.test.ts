import { describe, expect, it } from "vitest";
import temporalExposure from "filters/longExposure";
import sceneSeparation from "filters/backgroundSubtraction";
import motionAnalysis from "filters/motionDetect";
import scanline from "filters/scanline";

const makeBuffer = (width: number, height: number, fill = [0, 0, 0, 255]) => {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = fill[0];
    buf[i + 1] = fill[1];
    buf[i + 2] = fill[2];
    buf[i + 3] = fill[3];
  }
  return buf;
};

const makeFakeCanvas = (width: number, height: number, data: Uint8ClampedArray) => ({
  width,
  height,
  getContext: (type: string) => type === "2d" ? {
    getImageData: () => ({
      data: new Uint8ClampedArray(data),
      width,
      height,
    }),
  } : null,
});

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

describe("Long Exposure", () => {
  it("blend mode mixes current and previous output", () => {
    const input = makeFakeCanvas(1, 1, new Uint8ClampedArray([200, 100, 50, 255]));
    const data = runAndCapture(temporalExposure.func, input, {
      ...temporalExposure.defaults,
      mode: "BLEND",
      blendFactor: 0.5,
      _prevOutput: new Uint8ClampedArray([100, 50, 0, 255]),
    });

    expect(Array.from(data!)).toEqual([150, 75, 25, 255]);
  });

  it("shutter mode averages recent frames", () => {
    const first = makeFakeCanvas(2, 1, new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]));
    runAndCapture(temporalExposure.func, first, {
      ...temporalExposure.defaults,
      mode: "SHUTTER",
      windowSize: 2,
    });

    const second = makeFakeCanvas(2, 1, new Uint8ClampedArray([200, 200, 200, 255, 200, 200, 200, 255]));
    const data = runAndCapture(temporalExposure.func, second, {
      ...temporalExposure.defaults,
      mode: "SHUTTER",
      windowSize: 2,
    });

    expect(data![0]).toBe(100);
    expect(data![1]).toBe(100);
    expect(data![2]).toBe(100);
  });
});

describe("Scene Separation", () => {
  it("foreground mode outputs alpha mask for moving pixels", () => {
    const input = makeFakeCanvas(1, 1, new Uint8ClampedArray([200, 50, 50, 255]));
    const data = runAndCapture(sceneSeparation.func, input, {
      ...sceneSeparation.defaults,
      mode: "FOREGROUND",
      background: "TRANSPARENT",
      threshold: 20,
      feather: 0,
      _ema: new Float32Array([0, 0, 0, 255]),
    });

    expect(data![0]).toBe(200);
    expect(data![3]).toBe(255);
  });

  it("background mode favors stable background estimate", () => {
    const input = makeFakeCanvas(1, 1, new Uint8ClampedArray([220, 220, 220, 255]));
    const data = runAndCapture(sceneSeparation.func, input, {
      ...sceneSeparation.defaults,
      mode: "BACKGROUND",
      threshold: 10,
      feather: 0,
      learnRate: 0.02,
      _ema: new Float32Array([20, 30, 40, 255]),
    });

    expect(data![0]).toBeLessThan(100);
    expect(data![1]).toBeLessThan(110);
    expect(data![2]).toBeLessThan(120);
  });
});

describe("Motion Analysis", () => {
  it("difference mode highlights frame-to-frame changes", () => {
    const input = makeFakeCanvas(1, 1, new Uint8ClampedArray([100, 100, 100, 255]));
    const data = runAndCapture(motionAnalysis.func, input, {
      ...motionAnalysis.defaults,
      source: "PREVIOUS_FRAME",
      renderMode: "DIFFERENCE",
      threshold: 5,
      _prevInput: new Uint8ClampedArray([0, 0, 0, 255]),
    });

    expect(data![0]).toBeGreaterThan(64);
    expect(data![1]).toBe(data![0]);
    expect(data![2]).toBe(data![0]);
  });

  it("accumulated heat mode stores persistent heat in output", () => {
    const input = makeFakeCanvas(1, 1, new Uint8ClampedArray([255, 255, 255, 255]));
    const data = runAndCapture(motionAnalysis.func, input, {
      ...motionAnalysis.defaults,
      renderMode: "ACCUMULATED_HEAT",
      colorMap: "HOT",
      accumRate: 0.1,
      coolRate: 0.01,
      _ema: new Float32Array([0, 0, 0, 255]),
      _prevOutput: new Uint8ClampedArray([0, 0, 0, 255]),
    });

    expect(data![0] + data![1] + data![2]).toBeGreaterThan(0);
  });
});

describe("Scanline", () => {
  it("rgb sub-lines isolate channels by row group", () => {
    const width = 1;
    const height = 3;
    const input = makeFakeCanvas(width, height, new Uint8ClampedArray([
      100, 150, 200, 255,
      100, 150, 200, 255,
      100, 150, 200, 255,
    ]));
    const data = runAndCapture(scanline.func, input, {
      ...scanline.defaults,
      mode: "RGB_SUBLINES",
      lineHeight: 1,
      brightness: 1,
      palette: {
        name: "Identity",
        options: {},
        getColor: (pixel: number[]) => pixel,
      },
    });

    expect(Array.from(data!.slice(0, 4))).toEqual([100, 0, 0, 255]);
    expect(Array.from(data!.slice(4, 8))).toEqual([0, 150, 0, 255]);
    expect(Array.from(data!.slice(8, 12))).toEqual([0, 0, 200, 255]);
  });
});
