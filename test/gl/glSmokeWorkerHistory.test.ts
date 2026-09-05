import { beforeEach, describe, expect, it, vi } from "vitest";
import { filterIndex, getFilterHistory } from "@gyng/ditherer-filters";
import { workerRPC } from "@gyng/ditherer-filters/client";
import type {
  WorkerFilterRequest,
  WorkerFilterResult,
} from "../../packages/ditherer-filters/src/workers/types";
import { runWorkerSpecFilters } from "../../src/gl-smoke/contracts/core";

vi.mock("@gyng/ditherer-filters/client", () => ({ workerRPC: vi.fn() }));

const resultFor = (request: WorkerFilterRequest): WorkerFilterResult => {
  const { id, filterName } = request.chain[0];
  const history = getFilterHistory(filterIndex[filterName]);
  const pixels = new Uint8ClampedArray(request.imageData.slice(0));
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = pixels[i + 1] = pixels[i + 2] = i % 8 === 0 ? 220 : 30;
    pixels[i + 3] = 255;
  }
  return {
    imageData: pixels.buffer,
    width: request.width,
    height: request.height,
    stepTimes: [{ name: filterName, ms: 1 }],
    prevOutputs: {
      [id]: { imageData: pixels.buffer, width: request.width, height: request.height },
    },
    prevInputs: history.prevInput ? { [id]: request.imageData.slice(0) } : {},
    emaMaps: history.ema ? { [id]: new Float32Array(pixels.length).buffer } : {},
  };
};

describe("worker browser contract history", () => {
  beforeEach(() => {
    vi.mocked(workerRPC)
      .mockReset()
      .mockImplementation(async (request) => resultFor(request));
  });

  it("accepts selective history and exercises subsequent temporal frames", async () => {
    expect(await runWorkerSpecFilters()).toEqual({ ok: true });
    const temporal = vi
      .mocked(workerRPC)
      .mock.calls.map(([request]) => request)
      .filter((request) => request.frameIndex === 1);
    expect(temporal.length).toBeGreaterThan(0);
    for (const request of temporal) {
      const id = request.chain[0].id;
      expect(request.prevOutputs[id].byteLength).toBe(request.width * request.height * 4);
    }
  });

  it("still rejects a missing output snapshot", async () => {
    vi.mocked(workerRPC).mockImplementation(async (request) => ({
      ...resultFor(request),
      prevOutputs: {},
    }));
    expect(await runWorkerSpecFilters()).toMatchObject({ ok: false });
  });

  it("rejects unneeded input and EMA allocations", async () => {
    vi.mocked(workerRPC).mockImplementation(async (request) => {
      const result = resultFor(request);
      const id = request.chain[0].id;
      result.prevInputs[id] = request.imageData.slice(0);
      result.emaMaps[id] = new Float32Array(request.width * request.height * 4).buffer;
      return result;
    });
    expect(await runWorkerSpecFilters()).toMatchObject({ ok: false });
  });
});
