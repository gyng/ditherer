import { describe, expect, it, vi } from "vitest";

vi.mock("utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("utils")>();
  return { ...actual, cloneCanvas: (input: HTMLCanvasElement) => input };
});

import { floydSteinberg } from "filters/errorDiffusing";
import {
  ERR_STRATEGY,
  ORDER,
  ROW_ALT,
  TEMPORAL_MODE,
  optionTypes,
} from "filters/errorDiffusingFilterFactory";

const makeFixture = (width = 7, height = 6) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      data[index] = (x * 39 + y * 17) % 256;
      data[index + 1] = (x * 13 + y * 47) % 256;
      data[index + 2] = (x * 71 + y * 7) % 256;
      data[index + 3] = 255;
    }
  }
  return {
    width,
    height,
    getContext: (type: string) => type === "2d" ? {
      getImageData: () => ({ data: new Uint8ClampedArray(data), width, height }),
      putImageData: () => undefined,
    } : null,
  } as unknown as HTMLCanvasElement;
};

const run = (overrides: Record<string, unknown>, includeDefaults = true) => {
  const input = makeFixture();
  let captured: Uint8ClampedArray | null = null;
  const OriginalImageData = globalThis.ImageData;
  globalThis.ImageData = new Proxy(OriginalImageData, {
    construct(target, args) {
      if (args[0] instanceof Uint8ClampedArray) captured = new Uint8ClampedArray(args[0]);
      return Reflect.construct(target, args);
    },
  });
  try {
    floydSteinberg.func(input, {
      ...(includeDefaults ? floydSteinberg.defaults : {}),
      ...(includeDefaults ? { temporalMode: TEMPORAL_MODE.OFF, _wasmAcceleration: false } : {}),
      ...overrides,
    });
  } finally {
    globalThis.ImageData = OriginalImageData;
  }
  expect(captured).not.toBeNull();
  return captured!;
};

const expectValidQuantizedFrame = (pixels: Uint8ClampedArray) => {
  expect(pixels).toHaveLength(7 * 6 * 4);
  const distinct = new Set<number>();
  for (let index = 0; index < pixels.length; index += 4) {
    expect(pixels[index + 3]).toBe(255);
    distinct.add((pixels[index] << 16) | (pixels[index + 1] << 8) | pixels[index + 2]);
  }
  expect(distinct.size).toBeGreaterThan(1);
};

describe("error diffusion scan conformance", () => {
  it("exercises every row-major direction policy in horizontal and vertical scans", () => {
    for (const scanOrder of [ORDER.HORIZONTAL, ORDER.VERTICAL]) {
      for (const rowAlternation of Object.values(ROW_ALT)) {
        const pixels = run({ scanOrder, rowAlternation, serpentine: true });
        expectValidQuantizedFrame(pixels);
      }
      expectValidQuantizedFrame(run({ scanOrder, serpentine: false }));
    }
  });

  it("exercises every custom topology and error strategy in sRGB and linear light", () => {
    const customOrders = [ORDER.HILBERT, ORDER.SPIRAL, ORDER.DIAGONAL, ORDER.RANDOM_PIXEL];
    for (const scanOrder of customOrders) {
      for (const errorStrategy of Object.values(ERR_STRATEGY)) {
        expectValidQuantizedFrame(run({ scanOrder, errorStrategy, _linearize: false }));
        expectValidQuantizedFrame(run({ scanOrder, errorStrategy, _linearize: true }));
      }
    }
  });

  it("is deterministic and exposes controls only for the modes where they apply", () => {
    const options = { scanOrder: ORDER.RANDOM_PIXEL, errorStrategy: ERR_STRATEGY.ROTATE };
    expect(Array.from(run(options))).toEqual(Array.from(run(options)));

    expect(optionTypes.serpentine.visibleWhen({ scanOrder: ORDER.HORIZONTAL })).toBe(true);
    expect(optionTypes.serpentine.visibleWhen({ scanOrder: ORDER.HILBERT })).toBe(false);
    expect(optionTypes.rowAlternation.visibleWhen({ scanOrder: ORDER.VERTICAL, serpentine: true })).toBe(true);
    expect(optionTypes.rowAlternation.visibleWhen({ scanOrder: ORDER.VERTICAL, serpentine: false })).toBe(false);
    expect(optionTypes.errorStrategy.visibleWhen({ scanOrder: ORDER.SPIRAL })).toBe(true);
    expect(optionTypes.errorStrategy.visibleWhen({ scanOrder: ORDER.HORIZONTAL })).toBe(false);
    expect(optionTypes.temporalBleed.visibleWhen({ temporalMode: TEMPORAL_MODE.BLEED })).toBe(true);
    expect(optionTypes.temporalBleed.visibleWhen({ temporalMode: TEMPORAL_MODE.OFF })).toBe(false);
    expect(optionTypes.voteWindow.visibleWhen({ temporalMode: TEMPORAL_MODE.VOTE })).toBe(true);
    expect(optionTypes.voteWindow.visibleWhen({ temporalMode: TEMPORAL_MODE.BLEED })).toBe(false);
  });

  it("routes the animation action through start and stop contracts", () => {
    const canvas = document.createElement("canvas");
    const start = { isAnimating: () => false, startAnimLoop: vi.fn(), stopAnimLoop: vi.fn() };
    optionTypes.animate.action(start, canvas, null, { animSpeed: 9 });
    expect(start.startAnimLoop).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), 9);
    expect(start.stopAnimLoop).not.toHaveBeenCalled();

    const stop = { isAnimating: () => true, startAnimLoop: vi.fn(), stopAnimLoop: vi.fn() };
    optionTypes.animate.action(stop, canvas, null, {});
    expect(stop.stopAnimLoop).toHaveBeenCalledOnce();
    expect(stop.startAnimLoop).not.toHaveBeenCalled();

    const defaultSpeed = { isAnimating: () => false, startAnimLoop: vi.fn(), stopAnimLoop: vi.fn() };
    optionTypes.animate.action(defaultSpeed, canvas, null, {});
    expect(defaultSpeed.startAnimLoop).toHaveBeenCalledWith(canvas, 15);
  });

  it("honors the filter contract when persisted options are sparse", () => {
    const pixels = run({}, false);
    expectValidQuantizedFrame(pixels);
    expect(optionTypes.serpentine.visibleWhen({})).toBe(true);
    expect(optionTypes.errorStrategy.visibleWhen({})).toBe(false);
    expect(optionTypes.temporalBleed.visibleWhen({})).toBe(true);
  });

  it("contains malformed palette output and missing canvas contexts", () => {
    const emptyPalette = {
      name: "Broken user palette",
      options: {},
      getColor: () => [],
    };
    const rowMajor = run({ palette: emptyPalette, scanOrder: ORDER.HORIZONTAL });
    const custom = run({ palette: emptyPalette, scanOrder: ORDER.SPIRAL });
    for (const pixels of [rowMajor, custom]) {
      expect(pixels).toHaveLength(7 * 6 * 4);
      expect(pixels[0]).toBe(0);
      expect(pixels[1]).toBe(0);
      expect(pixels[2]).toBe(0);
    }

    const noContext = {
      width: 1,
      height: 1,
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    expect(floydSteinberg.func(noContext, {})).toBe(noContext);

    const noPixels = {
      width: 1,
      height: 1,
      getContext: () => ({ getImageData: () => ({ data: null }) }),
    } as unknown as HTMLCanvasElement;
    expect(floydSteinberg.func(noPixels, {})).toBe(noPixels);
  });

  it("checks composite row numbers in prime alternation mode", () => {
    const input = makeFixture(3, 12);
    expect(() => floydSteinberg.func(input, {
      ...floydSteinberg.defaults,
      rowAlternation: ROW_ALT.PRIME,
      _wasmAcceleration: false,
      temporalMode: TEMPORAL_MODE.OFF,
    })).not.toThrow();
  });
});
