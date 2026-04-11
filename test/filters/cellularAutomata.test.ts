import { describe, expect, it, vi } from "vitest";

vi.mock("utils", async importOriginal => {
  const actual = await importOriginal<typeof import("utils")>();
  return {
    ...actual,
    cloneCanvas: (original: any) => original,
  };
});

import cellularAutomata, { __testing } from "filters/cellularAutomata";

const binaryPalette = {
  name: "Binary",
  options: {},
  getColor: (pixel: number[]) => {
    const value = pixel[0] >= 128 ? 255 : 0;
    return [value, value, value, 255];
  },
};

const makeCanvasFromAliveMap = (aliveMap: number[][]) => {
  const height = aliveMap.length;
  const width = aliveMap[0].length;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const value = aliveMap[y][x] ? 255 : 0;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
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
    cellularAutomata.func(input, options);
  } finally {
    (globalThis as any).ImageData = OriginalImageData;
  }

  return captured;
};

describe("Cellular automata", () => {
  it("defaults fresh injection to disabled", () => {
    expect(cellularAutomata.defaults.freshInjectionEvery).toBe(0);
  });

  it("persists automaton state across frames instead of re-seeding from the source each time", () => {
    const blinker = makeCanvasFromAliveMap([
      [0, 1, 0],
      [0, 1, 0],
      [0, 1, 0],
    ]);
    const options = {
      ...cellularAutomata.defaults,
      palette: binaryPalette,
      rule: "CONWAY",
      steps: 1,
      threshold: 128,
    };

    const frame0 = runAndCapture(blinker, { ...options, _frameIndex: 0 });
    const frame1 = runAndCapture(blinker, { ...options, _frameIndex: 1 });

    expect(frame0).not.toEqual(frame1);
  });

  it("resets its simulation when the frame index restarts", () => {
    const singleSeed = makeCanvasFromAliveMap([
      [0, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
    ]);
    const options = {
      ...cellularAutomata.defaults,
      palette: binaryPalette,
      rule: "SEEDS",
      steps: 1,
      threshold: 128,
    };

    const frame0 = runAndCapture(singleSeed, { ...options, _frameIndex: 0 });
    runAndCapture(singleSeed, { ...options, _frameIndex: 1 });
    const restarted = runAndCapture(singleSeed, { ...options, _frameIndex: 0 });

    expect(restarted).toEqual(frame0);
  });

  it("can inject fresh live cells from the source image into the running grid", () => {
    const width = 3;
    const height = 3;
    const source = new Uint8ClampedArray([
      0, 0, 0, 255,   255, 255, 255, 255,   0, 0, 0, 255,
      0, 0, 0, 255,   0, 0, 0, 255,         0, 0, 0, 255,
      0, 0, 0, 255,   0, 0, 0, 255,         0, 0, 0, 255,
    ]);
    const grid = new Uint8Array(width * height);

    __testing.injectSourceState(source, width, height, 128, grid);

    expect(Array.from(grid)).toEqual([
      0, 1, 0,
      0, 0, 0,
      0, 0, 0,
    ]);
  });
});
