import { beforeAll, describe, expect, it } from "vitest";
import { runWorkerFilterRequest } from "workers/filterWorker";
import { filterIndex } from "filters";
import type { FilterCanvas } from "filters/types";

// Node/jsdom env: use real HTMLCanvasElement from jsdom so filters that need
// a 2d context get one. Workers in prod run with OffscreenCanvas; the
// dispatcher accepts either via its WorkerCanvasFactory injection point.
const makeCanvas = (width: number, height: number): FilterCanvas => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas as FilterCanvas;
};

const seedImageData = (width: number, height: number): ArrayBuffer => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (i * 13) % 256;
    data[i + 1] = (i * 7) % 256;
    data[i + 2] = (i * 3) % 256;
    data[i + 3] = 255;
  }
  return data.buffer;
};

const baseRequest = () => ({
  frameIndex: 0,
  isAnimating: false,
  linearize: false,
  wasmAcceleration: false,
  webglAcceleration: false,
  convertGrayscale: false,
  prevOutputs: {},
  prevInputs: {},
  emaMaps: {},
  degaussFrame: -2147483648,
});

describe("runWorkerFilterRequest", () => {
  beforeAll(() => {
    // JSDOM exposes HTMLCanvasElement but the dispatcher defaults to
    // OffscreenCanvas; we inject makeCanvas via the factory argument so
    // no polyfill is needed here.
    expect(typeof document).toBe("object");
  });

  it("runs a non-GL chain end-to-end and reports step timings", async () => {
    const result = await runWorkerFilterRequest({
      ...baseRequest(),
      imageData: seedImageData(4, 4),
      width: 4,
      height: 4,
      chain: [
        {
          id: "grayscale",
          filterName: "Grayscale",
          displayName: "Grayscale",
          options: filterIndex.Grayscale.defaults,
        },
      ],
    }, makeCanvas);

    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
    expect(result.imageData.byteLength).toBe(4 * 4 * 4);
    expect(result.stepTimes).toHaveLength(1);
    expect(result.stepTimes[0].name).toBe("Grayscale");
    // Worker must remember the prev frame for this step so stateful filters
    // downstream (after-image etc.) get a previous input to diff against.
    expect(result.prevOutputs.grayscale).toBeDefined();
    expect(result.prevOutputs.grayscale.width).toBe(4);
    expect(result.prevOutputs.grayscale.height).toBe(4);
  });

  it("draws the GL-unavailable stub for requiresGL filters in jsdom", async () => {
    // "Invert" is requiresGL: true — with no WebGL2 the dispatcher swaps in
    // the amber error tile rather than letting the filter pass-through.
    const result = await runWorkerFilterRequest({
      ...baseRequest(),
      imageData: seedImageData(16, 16),
      width: 16,
      height: 16,
      chain: [
        {
          id: "invert",
          filterName: "Invert",
          displayName: "Invert",
          options: filterIndex.Invert.defaults,
        },
      ],
    }, makeCanvas);

    expect(result.stepTimes[0].name).toBe("Invert");
    expect(result.stepTimes[0].backend).toMatch(/^GL-unavailable/);
    // Output size matches the stub request — no crash, no size drift.
    expect(result.width).toBe(16);
    expect(result.height).toBe(16);
  });

  it("skips unknown filter names without throwing", async () => {
    const result = await runWorkerFilterRequest({
      ...baseRequest(),
      imageData: seedImageData(2, 2),
      width: 2,
      height: 2,
      chain: [
        {
          id: "fake",
          filterName: "ThisFilterDoesNotExist",
          displayName: "Ghost",
          options: {},
        },
      ],
    }, makeCanvas);

    expect(result.stepTimes).toHaveLength(0);
    expect(result.width).toBe(2);
  });

  it("applies grayscale preprocessing when convertGrayscale is true", async () => {
    // The preprocess step runs before the chain; easiest smoke is to ask
    // for grayscale + an empty chain and confirm the output is free of
    // non-grayscale pixels (R == G == B per pixel).
    const result = await runWorkerFilterRequest({
      ...baseRequest(),
      imageData: seedImageData(3, 3),
      width: 3,
      height: 3,
      chain: [],
      convertGrayscale: true,
    }, makeCanvas);

    const pixels = new Uint8ClampedArray(result.imageData);
    let nonGrayscale = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] !== pixels[i + 1] || pixels[i + 1] !== pixels[i + 2]) {
        nonGrayscale += 1;
      }
    }
    expect(nonGrayscale).toBe(0);
  });
});
