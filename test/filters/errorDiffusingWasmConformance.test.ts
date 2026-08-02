import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  wasmErrorDiffuseBuffer,
  wasmErrorDiffuseCustomOrder,
  wasmIsLoaded,
  colorAlgorithmToWasmMode,
  resolvePaletteColorAlgorithm,
} = vi.hoisted(() => ({
  wasmErrorDiffuseBuffer: vi.fn(),
  wasmErrorDiffuseCustomOrder: vi.fn(),
  wasmIsLoaded: vi.fn(() => true),
  colorAlgorithmToWasmMode: vi.fn<() => number | null>(() => 7),
  resolvePaletteColorAlgorithm: vi.fn(() => "RGB_NEAREST"),
}));

vi.mock("utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("utils")>();
  return {
    ...actual,
    cloneCanvas: (input: HTMLCanvasElement) => input,
    wasmErrorDiffuseBuffer,
    wasmErrorDiffuseCustomOrder,
    wasmIsLoaded,
    colorAlgorithmToWasmMode,
    resolvePaletteColorAlgorithm,
    logFilterWasmStatus: vi.fn(),
  };
});

import { floydSteinberg } from "filters/errorDiffusing";
import { ERR_STRATEGY, ORDER, ROW_ALT, TEMPORAL_MODE } from "filters/errorDiffusingFilterFactory";

const makeCanvas = () => {
  const width = 4;
  const height = 3;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = (index * 7) % 256;
    pixels[index + 1] = (index * 11) % 256;
    pixels[index + 2] = (index * 13) % 256;
    pixels[index + 3] = 255;
  }
  const putImageData = vi.fn();
  const canvas = {
    width,
    height,
    getContext: (kind: string) =>
      kind === "2d"
        ? {
            getImageData: () => ({ data: new Uint8ClampedArray(pixels), width, height }),
            putImageData,
          }
        : null,
  } as unknown as HTMLCanvasElement;
  return { canvas, pixels, putImageData };
};

const levelsPalette = {
  name: "Levels",
  options: { levels: 3 },
  getColor: (color: number[]) => color,
};

const colorPalette = {
  name: "Colors",
  options: {
    colors: [
      [0, 0, 0],
      [255, 255, 255],
    ],
  },
  getColor: (color: number[]) => color,
};

const run = (overrides: Record<string, unknown> = {}) => {
  const fixture = makeCanvas();
  floydSteinberg.func(fixture.canvas, {
    ...floydSteinberg.defaults,
    palette: levelsPalette,
    _wasmAcceleration: true,
    temporalMode: TEMPORAL_MODE.OFF,
    ...overrides,
  });
  expect(fixture.putImageData).toHaveBeenCalledOnce();
  return fixture;
};

describe("error diffusion WASM conformance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    wasmIsLoaded.mockReturnValue(true);
    colorAlgorithmToWasmMode.mockReturnValue(7);
    resolvePaletteColorAlgorithm.mockReturnValue("RGB_NEAREST");
  });

  it("marshals row-major kernels, every alternation code, linear mode, and temporal residuals", () => {
    const previousInput = new Uint8ClampedArray(4 * 3 * 4).fill(80);
    const previousOutput = new Uint8ClampedArray(4 * 3 * 4).fill(64);

    for (const rowAlternation of [...Object.values(ROW_ALT), "UNKNOWN"]) {
      run({
        scanOrder: ORDER.HORIZONTAL,
        rowAlternation,
        serpentine: true,
        _linearize: true,
        temporalMode: TEMPORAL_MODE.BLEED,
        temporalBleed: 0.4,
        _prevInput: previousInput,
        _prevOutput: previousOutput,
      });
    }

    expect(wasmErrorDiffuseBuffer).toHaveBeenCalledTimes(Object.keys(ROW_ALT).length + 1);
    const call = wasmErrorDiffuseBuffer.mock.calls[0];
    expect(call[2]).toBe(4);
    expect(call[3]).toBe(3);
    expect(call[9]).toBe(true);
    expect(call[11]).toBe(true);
    expect(call[12]).toBe(previousInput);
    expect(call[13]).toBe(previousOutput);
    expect(call[14]).toBe(0.4);
    expect(call[15]).toBe(0);
    expect(call[16]).toBe(3);
  });

  it("marshals every custom-order strategy and explicit color palettes", () => {
    for (const errorStrategy of Object.values(ERR_STRATEGY)) {
      run({
        palette: colorPalette,
        scanOrder: ORDER.SPIRAL,
        errorStrategy,
      });
    }

    expect(wasmErrorDiffuseCustomOrder).toHaveBeenCalledTimes(Object.keys(ERR_STRATEGY).length);
    for (const call of wasmErrorDiffuseCustomOrder.mock.calls) {
      expect(call[4]).toBeInstanceOf(Uint32Array);
      expect(call[5]).toBeInstanceOf(Float32Array);
      expect(call[6]).toBeInstanceOf(Uint32Array);
      expect(call[7]).toBeInstanceOf(Uint32Array);
      expect(call[8]).toBeInstanceOf(Float32Array);
      expect(call[14]).toBe(7);
      expect(call[16]).toEqual(colorPalette.options.colors);
    }
  });

  it("falls back to the CPU implementation when acceleration or palette support is unavailable", () => {
    wasmIsLoaded.mockReturnValue(false);
    run({ _wasmAcceleration: true });

    wasmIsLoaded.mockReturnValue(true);
    colorAlgorithmToWasmMode.mockReturnValue(null);
    run({ palette: colorPalette });

    run({ palette: { name: "Unsupported", options: {}, getColor: (color: number[]) => color } });

    expect(wasmErrorDiffuseBuffer).not.toHaveBeenCalled();
    expect(wasmErrorDiffuseCustomOrder).not.toHaveBeenCalled();
  });
});
