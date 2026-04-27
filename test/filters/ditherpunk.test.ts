import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("utils", async importOriginal => {
  const actual = await importOriginal<typeof import("utils")>();
  return {
    ...actual,
    cloneCanvas: (original: any) => original,
  };
});

import {
  BAYER_2X2,
  THRESHOLD_POLARITY,
  WHITE_NOISE_64X64,
  getOrderedThresholdMapPreview,
} from "filters/ordered";
import riemersma from "filters/riemersma";
import { filterList } from "filters";
import { initWasmFromBinary, wasmIsLoaded } from "utils";

const binaryPalette = {
  name: "Binary",
  options: {},
  getColor: (pixel: number[]) => {
    const value = pixel[0] >= 128 ? 255 : 0;
    return [value, value, value, 255];
  },
};

const makeGradientCanvas = (width: number, height: number) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = Math.round(((x + y * width) / (width * height - 1)) * 255);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
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

type TestCanvas = ReturnType<typeof makeGradientCanvas>;

const runAndCapture = (input: TestCanvas, options: Record<string, unknown>): Uint8ClampedArray | null => {
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
    riemersma.func(input as any, options);
  } finally {
    (globalThis as any).ImageData = OriginalImageData;
  }

  return captured;
};

describe("ditherpunk ordered maps", () => {
  it("exposes a deterministic white-noise threshold map", () => {
    const a = getOrderedThresholdMapPreview(WHITE_NOISE_64X64);
    const b = getOrderedThresholdMapPreview(WHITE_NOISE_64X64);

    expect(a.width).toBe(64);
    expect(a.height).toBe(64);
    expect(a.levels).toBe(4096);
    expect(a.thresholdMap[0].slice(0, 8)).toEqual(b.thresholdMap[0].slice(0, 8));

    const values = a.thresholdMap.flat();
    expect(new Set(values).size).toBe(4096);
    expect(Math.min(...values)).toBe(0);
    expect(Math.max(...values)).toBeCloseTo(4095 / 4096);
  });

  it("can invert threshold polarity for classic bright Bayer behavior", () => {
    const shadow = getOrderedThresholdMapPreview(BAYER_2X2, THRESHOLD_POLARITY.SHADOW);
    const classic = getOrderedThresholdMapPreview(BAYER_2X2, THRESHOLD_POLARITY.CLASSIC);

    expect(classic.thresholdMap[0][0]).toBe(1 - shadow.thresholdMap[0][0]);
    expect(classic.thresholdMap[1][1]).toBe(1 - shadow.thresholdMap[1][1]);
  });
});

describe("Riemersma dither", () => {
  beforeAll(async () => {
    if (!wasmIsLoaded()) {
      const wasm = readFileSync(resolve(process.cwd(), "src/wasm/rgba2laba/wasm/rgba2laba_bg.wasm"));
      await initWasmFromBinary(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
    }
  });

  it("is registered as a dithering filter", () => {
    expect(filterList.some(entry => entry.displayName === "Riemersma")).toBe(true);
  });

  it("quantizes along its Hilbert error-memory path", () => {
    const output = runAndCapture(makeGradientCanvas(4, 4), {
      ...riemersma.defaults,
      palette: binaryPalette,
      memoryLength: 8,
      falloffRatio: 0.125,
      errorStrength: 1,
      _linearize: false,
    });

    expect(output).not.toBeNull();
    const rgb = Array.from(output!).filter((_v, i) => i % 4 !== 3);
    expect(new Set(rgb)).toEqual(new Set([0, 255]));
  });

  it("leaves the canvas untouched when WASM acceleration is disabled", () => {
    const input = makeGradientCanvas(4, 4);
    const output = runAndCapture(input, {
      ...riemersma.defaults,
      palette: binaryPalette,
      memoryLength: 8,
      falloffRatio: 0.125,
      errorStrength: 1,
      _linearize: false,
      _wasmAcceleration: false,
    });

    expect(wasmIsLoaded()).toBe(true);
    expect(output).toBeNull();
  });
});
