// @vitest-environment node

import { beforeAll, describe, expect, it } from "vitest";
import { ImageData as CanvasImageData, createCanvas } from "canvas";

const installCanvasPolyfills = () => {
  globalThis.ImageData = CanvasImageData as typeof ImageData;
  globalThis.OffscreenCanvas = class OffscreenCanvas {
    constructor(width: number, height: number) {
      return createCanvas(width, height) as unknown as OffscreenCanvas;
    }
  } as typeof OffscreenCanvas;
};

const makeCanvas = (width: number, height: number) =>
  createCanvas(width, height) as unknown as HTMLCanvasElement;

const createTestCanvas = (width: number, height: number) => {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to create test context");

  const imageData = new CanvasImageData(width, height);
  for (let i = 0; i < imageData.data.length; i += 4) {
    imageData.data[i] = (i * 13) % 256;
    imageData.data[i + 1] = (i * 7) % 256;
    imageData.data[i + 2] = (i * 3) % 256;
    imageData.data[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
};

beforeAll(() => {
  installCanvasPolyfills();
});

describe("runWorkerFilterRequest", () => {
  it("matches the main-thread result for grayscale preprocessing plus a simple worker-capable chain", async () => {
    const [{ runWorkerFilterRequest }, { filterIndex }] = await Promise.all([
      import("workers/filterWorker"),
      import("filters"),
    ]);

    const input = createTestCanvas(5, 4);
    const inputCtx = input.getContext("2d");
    if (!inputCtx) throw new Error("Missing input context");

    const request = {
      imageData: inputCtx.getImageData(0, 0, input.width, input.height).data.buffer.slice(0),
      width: input.width,
      height: input.height,
      chain: [
        {
          id: "invert",
          filterName: "Invert",
          displayName: "Invert",
          options: filterIndex.Invert.defaults,
        },
      ],
      frameIndex: 3,
      isAnimating: false,
      linearize: false,
      wasmAcceleration: false,
      convertGrayscale: true,
      prevOutputs: {},
    } as const;

    const workerResult = runWorkerFilterRequest(request, makeCanvas as never);

    const manualInput = createTestCanvas(5, 4);
    const grayscaleOutput = filterIndex.Grayscale.func(manualInput, {
      _linearize: false,
    });
    const manualOutput = filterIndex.Invert.func(
      grayscaleOutput,
      filterIndex.Invert.defaults,
    );
    const manualCtx = manualOutput.getContext("2d");
    if (!manualCtx) throw new Error("Missing manual output context");

    expect(workerResult.stepTimes.map((step) => step.name)).toEqual(["Invert"]);
    expect(Array.from(new Uint8ClampedArray(workerResult.imageData))).toEqual(
      Array.from(manualCtx.getImageData(0, 0, manualOutput.width, manualOutput.height).data),
    );
  }, 15_000);

  it("deserializes palette options and preserves intermediate frame payloads", async () => {
    const [{ runWorkerFilterRequest }, { filterIndex }, { serializePalette }] = await Promise.all([
      import("workers/filterWorker"),
      import("filters"),
      import("palettes"),
    ]);

    const input = createTestCanvas(4, 4);
    const inputCtx = input.getContext("2d");
    if (!inputCtx) throw new Error("Missing input context");

    const ordered = filterIndex.Ordered;
    const request = {
      imageData: inputCtx.getImageData(0, 0, input.width, input.height).data.buffer.slice(0),
      width: input.width,
      height: input.height,
      chain: [
        {
          id: "ordered",
          filterName: "Ordered",
          displayName: "Ordered",
          options: {
            ...ordered.defaults,
            palette: serializePalette(ordered.defaults.palette),
          },
        },
      ],
      frameIndex: 7,
      isAnimating: false,
      linearize: false,
      wasmAcceleration: false,
      convertGrayscale: false,
      prevOutputs: {},
    } as const;

    const workerResult = runWorkerFilterRequest(request, makeCanvas as never);

    const manualInput = createTestCanvas(4, 4);
    const manualOutput = ordered.func(manualInput, {
      ...ordered.defaults,
      _frameIndex: 7,
      _isAnimating: false,
      _linearize: false,
      _wasmAcceleration: false,
      _prevOutput: null,
    });
    const manualCtx = manualOutput.getContext("2d");
    if (!manualCtx) throw new Error("Missing manual output context");

    expect(workerResult.prevOutputs.ordered).toBeDefined();
    expect(workerResult.prevOutputs.ordered.width).toBe(4);
    expect(workerResult.prevOutputs.ordered.height).toBe(4);
    expect(Array.from(new Uint8ClampedArray(workerResult.imageData))).toEqual(
      Array.from(manualCtx.getImageData(0, 0, manualOutput.width, manualOutput.height).data),
    );
  }, 15_000);
});
