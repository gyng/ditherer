import React, { act, useContext } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const resourceMocks = vi.hoisted(() => ({
  disposeSharedFilterResources: vi.fn(),
  releaseJpegArtifactFloatTextures: vi.fn(),
  disposeFilterWorker: vi.fn(),
  workerRPC: vi.fn(),
}));

vi.mock("@gyng/ditherer-filters", async () => {
  const actual = await vi.importActual<typeof import("@gyng/ditherer-filters")>("@gyng/ditherer-filters");
  return {
    ...actual,
    disposeSharedFilterResources: resourceMocks.disposeSharedFilterResources,
    releaseJpegArtifactFloatTextures: resourceMocks.releaseJpegArtifactFloatTextures,
  };
});

vi.mock("@gyng/ditherer-filters/client", async () => {
  const actual = await vi.importActual<typeof import("@gyng/ditherer-filters/client")>("@gyng/ditherer-filters/client");
  return {
    ...actual,
    USE_WORKER: true,
    disposeFilterWorker: resourceMocks.disposeFilterWorker,
    workerRPC: resourceMocks.workerRPC,
  };
});

import { FilterProvider } from "context/FilterContext";
import { FilterContext, type FilterContextValue } from "context/filterContextValue";
import {
  filterIndex,
  getCanvasPoolStats,
  resetCanvasPoolStats,
  takePooledCanvas,
} from "@gyng/ditherer-filters";
import type { FilterDefinition } from "filters/types";
import * as slowFilterRegistry from "utils/slowFilterRegistry";

let latest: FilterContextValue;
const Probe = () => {
  const value = useContext(FilterContext);
  if (!value) throw new Error("FilterContext is missing");
  latest = value;
  return null;
};

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("FilterProvider processing reset", () => {
  const mountProvider = async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    resourceMocks.workerRPC.mockReset();
    await act(async () => {
      root.render(<FilterProvider><Probe /></FilterProvider>);
    });
    return root;
  };

  it("disposes both processing realms on source reset and unmount", async () => {
    const root = await mountProvider();
    resourceMocks.disposeSharedFilterResources.mockClear();
    resourceMocks.disposeFilterWorker.mockClear();

    await act(async () => {
      latest.actions.loadImage(document.createElement("canvas"));
    });
    expect(resourceMocks.disposeSharedFilterResources).toHaveBeenCalledOnce();
    expect(resourceMocks.disposeFilterWorker).toHaveBeenCalledOnce();

    resourceMocks.disposeSharedFilterResources.mockClear();
    resourceMocks.disposeFilterWorker.mockClear();
    await act(async () => root.unmount());
    expect(resourceMocks.disposeSharedFilterResources).toHaveBeenCalledOnce();
    expect(resourceMocks.disposeFilterWorker).toHaveBeenCalledOnce();
  });

  it("releases both realms only when the last JPEG codec user leaves the chain", async () => {
    const root = await mountProvider();
    await act(async () => {
      latest.actions.chainAdd("JPEG Artifact", filterIndex["JPEG Artifact"]);
      latest.actions.chainAdd("Mavica FD7", filterIndex["Mavica FD7"]);
    });
    const jpegId = latest.state.chain.find((entry) => entry.displayName === "JPEG Artifact")?.id;
    const mavicaId = latest.state.chain.find((entry) => entry.displayName === "Mavica FD7")?.id;
    expect(jpegId).toBeTruthy();
    expect(mavicaId).toBeTruthy();
    resourceMocks.releaseJpegArtifactFloatTextures.mockClear();
    resourceMocks.disposeFilterWorker.mockClear();

    await act(async () => latest.actions.chainRemove(jpegId!));
    expect(resourceMocks.releaseJpegArtifactFloatTextures).not.toHaveBeenCalled();
    expect(resourceMocks.disposeFilterWorker).not.toHaveBeenCalled();

    await act(async () => latest.actions.chainRemove(mavicaId!));
    expect(latest.state.chain).toHaveLength(1);
    expect(resourceMocks.releaseJpegArtifactFloatTextures).toHaveBeenCalledOnce();
    expect(resourceMocks.disposeFilterWorker).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
  });

  it("keeps an idle worker warm across option edits", async () => {
    const root = await mountProvider();
    resourceMocks.disposeFilterWorker.mockClear();

    await act(async () => latest.actions.setFilterOption("serpentine", false));

    expect(resourceMocks.disposeFilterWorker).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("terminates an active stale worker before applying an option edit", async () => {
    const root = await mountProvider();
    let rejectPending: ((error: Error) => void) | undefined;
    resourceMocks.workerRPC.mockReturnValueOnce(new Promise((_resolve, reject) => {
      rejectPending = reject;
    }));
    const input = document.createElement("canvas");
    input.width = 1;
    input.height = 1;
    latest.actions.filterImageAsync(input);
    expect(resourceMocks.workerRPC).toHaveBeenCalledOnce();
    resourceMocks.disposeFilterWorker.mockClear();

    await act(async () => {
      latest.actions.setFilterOption("serpentine", false);
      rejectPending?.(new Error("Filter worker disposed"));
      await Promise.resolve();
    });

    expect(resourceMocks.disposeFilterWorker).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });

  it("ignores a disposed worker rejection and accepts work from the fresh generation", async () => {
    const root = await mountProvider();
    let rejectPending: ((error: Error) => void) | undefined;
    resourceMocks.workerRPC.mockReturnValueOnce(new Promise((_resolve, reject) => {
      rejectPending = reject;
    }));
    const staleInput = document.createElement("canvas");
    staleInput.width = 1;
    staleInput.height = 1;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    latest.actions.filterImageAsync(staleInput);
    expect(resourceMocks.workerRPC).toHaveBeenCalledOnce();
    await act(async () => {
      latest.actions.loadImage(document.createElement("canvas"));
      rejectPending?.(new Error("Filter worker disposed"));
      await Promise.resolve();
    });
    expect(error).not.toHaveBeenCalledWith(
      "Worker failed, falling back to main thread:",
      expect.anything(),
    );

    resourceMocks.workerRPC.mockResolvedValueOnce({
      imageData: new Uint8ClampedArray(4).buffer,
      width: 1,
      height: 1,
      stepTimes: [],
      prevOutputs: {},
      prevInputs: {},
      emaMaps: {},
    });
    await act(async () => {
      latest.actions.filterImageAsync(staleInput);
      await Promise.resolve();
    });
    expect(resourceMocks.workerRPC).toHaveBeenCalledTimes(2);
    expect(latest.state.outputImage).toMatchObject({ width: 1, height: 1 });

    await act(async () => root.unmount());
  });

  it("drops an async main-thread fallback that resolves after worker disposal", async () => {
    const root = await mountProvider();
    let resolveFallback: ((canvas: HTMLCanvasElement) => void) | undefined;
    const staleOutput = document.createElement("canvas");
    staleOutput.width = 7;
    staleOutput.height = 5;
    const temporalSnapshots: Record<string, unknown>[] = [];
    const asyncFilter: FilterDefinition = {
      name: "Deferred fallback",
      func: (filterInput, options = {}) => {
        temporalSnapshots.push({
          prevOutput: options._prevOutput,
          prevInput: options._prevInput,
          ema: options._ema,
        });
        if (temporalSnapshots.length === 1) {
          return new Promise<HTMLCanvasElement>((resolve) => { resolveFallback = resolve; });
        }
        const output = document.createElement("canvas");
        output.width = filterInput.width;
        output.height = filterInput.height;
        return output;
      },
      options: {},
      defaults: {},
      optionTypes: {},
    };
    await act(async () => {
      latest.actions.chainReplace(latest.state.chain[0].id, asyncFilter.name, asyncFilter);
    });
    const entryId = latest.state.chain[0].id;
    resourceMocks.workerRPC.mockRejectedValueOnce(new Error("injected worker failure"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const input = document.createElement("canvas");
    input.width = 1;
    input.height = 1;

    latest.actions.filterImageAsync(input);
    await act(async () => { await Promise.resolve(); });
    expect(resolveFallback).toBeTypeOf("function");
    await act(async () => {
      latest.actions.loadImage(document.createElement("canvas"));
      resolveFallback?.(staleOutput);
      await Promise.resolve();
    });

    expect(error).toHaveBeenCalledWith(
      "Worker failed, falling back to main thread:",
      expect.any(Error),
    );
    expect(latest.state.outputImage).not.toBe(staleOutput);
    expect(latest.actions.getIntermediatePreview(entryId)).toBeNull();

    resourceMocks.workerRPC.mockRejectedValueOnce(new Error("second worker failure"));
    await act(async () => {
      latest.actions.filterImageAsync(input);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(temporalSnapshots[1]).toEqual({ prevOutput: null, prevInput: null, ema: null });

    resourceMocks.workerRPC.mockRejectedValueOnce(new Error("third worker failure"));
    await act(async () => {
      latest.actions.filterImageAsync(input);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(temporalSnapshots[2]?.prevOutput).toBeInstanceOf(Uint8ClampedArray);
    expect(temporalSnapshots[2]?.prevInput).toBeInstanceOf(Uint8ClampedArray);
    expect(temporalSnapshots[2]?.ema).toBeInstanceOf(Float32Array);
    await act(async () => root.unmount());
  });

  it("contains a rejected main-thread fallback and accepts the next worker request", async () => {
    const root = await mountProvider();
    const width = 277;
    const height = 79;
    const failingFilter: FilterDefinition = {
      name: "Rejected fallback stage",
      func: () => {
        const output = takePooledCanvas(width, height) as HTMLCanvasElement;
        vi.spyOn(output.getContext("2d")!, "getImageData").mockImplementationOnce(() => {
          throw new Error("injected fallback output snapshot failure");
        });
        return output;
      },
      options: {},
      defaults: {},
      optionTypes: {},
    };
    await act(async () => {
      latest.actions.chainReplace(latest.state.chain[0].id, failingFilter.name, failingFilter);
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    resourceMocks.workerRPC.mockRejectedValueOnce(new Error("injected worker failure"));
    resetCanvasPoolStats();
    const input = document.createElement("canvas");
    input.width = width;
    input.height = height;
    latest.actions.filterImageAsync(input);
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(
      "Main-thread worker fallback failed:",
      expect.any(Error),
    ));
    expect(getCanvasPoolStats().releases).toBeGreaterThan(0);

    resourceMocks.workerRPC.mockResolvedValueOnce({
      imageData: new Uint8ClampedArray(width * height * 4).buffer,
      width,
      height,
      stepTimes: [],
      prevOutputs: {},
      prevInputs: {},
      emaMaps: {},
    });
    await act(async () => {
      latest.actions.filterImageAsync(input);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(resourceMocks.workerRPC).toHaveBeenCalledTimes(2);
    expect(latest.state.outputImage).toMatchObject({ width, height });
    await act(async () => root.unmount());
  });

  it("keeps cached previews and temporal state unchanged when a worker result is malformed", async () => {
    const root = await mountProvider();
    const width = 263;
    const height = 59;
    let resolveFallback: ((canvas: HTMLCanvasElement) => void) | undefined;
    let fallbackPreviousOutputLength: number | undefined;
    const firstFilter: FilterDefinition = {
      name: "Worker transaction prefix",
      func: (input) => input,
      options: {},
      defaults: {},
      optionTypes: {},
    };
    const suffixFilter: FilterDefinition = {
      name: "Worker transaction suffix",
      func: (input, options = {}) => {
        fallbackPreviousOutputLength = options._prevOutput instanceof Uint8ClampedArray
          ? options._prevOutput.length
          : undefined;
        return new Promise<HTMLCanvasElement>((resolve) => {
          resolveFallback = () => resolve(input as HTMLCanvasElement);
        });
      },
      options: { amount: 1 },
      defaults: { amount: 1 },
      optionTypes: { amount: { type: "RANGE", range: [0, 2], default: 1 } },
    };
    await act(async () => {
      latest.actions.chainReplace(latest.state.chain[0].id, firstFilter.name, firstFilter);
      latest.actions.chainAdd(suffixFilter.name, suffixFilter);
    });
    const [prefixId, suffixId] = latest.state.chain.map((entry) => entry.id);
    const validPixels = width * height * 4;
    const validFrame = { imageData: new Uint8ClampedArray(validPixels).buffer, width, height };
    resourceMocks.workerRPC.mockResolvedValueOnce({
      imageData: new Uint8ClampedArray(validPixels).buffer,
      width,
      height,
      stepTimes: [],
      prevOutputs: { [prefixId]: validFrame, [suffixId]: validFrame },
      prevInputs: {},
      emaMaps: {},
    });
    const input = document.createElement("canvas");
    input.width = width;
    input.height = height;
    await act(async () => {
      latest.actions.filterImageAsync(input);
      await Promise.resolve();
      await Promise.resolve();
    });
    const cachedPrefix = latest.actions.getIntermediatePreview(prefixId)!;
    expect(cachedPrefix).toBeInstanceOf(HTMLCanvasElement);

    await act(async () => latest.actions.setFilterOption("amount", 2, 1));
    expect(latest.actions.getIntermediatePreview(prefixId)).toBe(cachedPrefix);
    const cachedPrefixContext = cachedPrefix.getContext("2d")!;
    const originalCachedPrefixWrite = cachedPrefixContext.putImageData.bind(cachedPrefixContext);
    const cachedPrefixWrite = vi.fn(originalCachedPrefixWrite);
    cachedPrefixContext.putImageData = cachedPrefixWrite;
    resourceMocks.workerRPC.mockResolvedValueOnce({
      imageData: new Uint8ClampedArray(validPixels).buffer,
      width,
      height,
      stepTimes: [],
      prevOutputs: {
        [prefixId]: validFrame,
        [suffixId]: { imageData: new Uint8ClampedArray(8).buffer, width: 2, height: 2 },
      },
      prevInputs: {},
      emaMaps: {},
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    resetCanvasPoolStats();
    latest.actions.filterImageAsync(input);
    await vi.waitFor(() => expect(resolveFallback).toBeTypeOf("function"));

    expect(cachedPrefixWrite).not.toHaveBeenCalled();
    expect(latest.actions.getIntermediatePreview(prefixId)).toBe(cachedPrefix);
    expect(fallbackPreviousOutputLength).toBe(validPixels);
    expect(getCanvasPoolStats().releases).toBeGreaterThanOrEqual(2);
    expect(error).toHaveBeenCalledWith(
      "Worker failed, falling back to main thread:",
      expect.any(Error),
    );

    await act(async () => {
      resolveFallback?.(input);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => root.unmount());
  });

  it("releases worker transaction canvases when result putImageData rejects", async () => {
    const root = await mountProvider();
    const width = 271;
    const height = 67;
    const passFilter: FilterDefinition = {
      name: "Worker putImageData fallback",
      func: (input) => input,
      options: {},
      defaults: {},
      optionTypes: {},
    };
    await act(async () => {
      latest.actions.chainReplace(latest.state.chain[0].id, passFilter.name, passFilter);
    });
    resourceMocks.workerRPC.mockResolvedValueOnce({
      imageData: new Uint8ClampedArray(width * height * 4).buffer,
      width,
      height,
      stepTimes: [],
      prevOutputs: {},
      prevInputs: {},
      emaMaps: {},
    });
    const input = document.createElement("canvas");
    input.width = width;
    input.height = height;
    const createElement = document.createElement.bind(document);
    let injected = false;
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = createElement(tagName, options);
      if (tagName === "canvas" && !injected) {
        injected = true;
        vi.spyOn((element as HTMLCanvasElement).getContext("2d")!, "putImageData")
          .mockImplementationOnce(() => { throw new Error("injected worker putImageData failure"); });
      }
      return element;
    }) as typeof document.createElement);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    resetCanvasPoolStats();

    expect(() => latest.actions.filterImageAsync(input)).not.toThrow();
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(
      "Worker failed, falling back to main thread:",
      expect.any(Error),
    ));
    await vi.waitFor(() => expect(latest.state.outputImage).toBe(input));
    expect(getCanvasPoolStats().releases).toBeGreaterThanOrEqual(1);
    await act(async () => root.unmount());
  });

  it("does not commit worker previews or temporal maps before timing bookkeeping succeeds", async () => {
    const root = await mountProvider();
    const width = 267;
    const height = 61;
    const pixelCount = width * height * 4;
    let resolveFallback: ((canvas: HTMLCanvasElement) => void) | undefined;
    let fallbackTemporal: Record<string, unknown> | undefined;
    const fallbackFilter: FilterDefinition = {
      name: "Worker timing fallback",
      func: (input, options = {}) => {
        fallbackTemporal = {
          prevOutput: options._prevOutput,
          prevInput: options._prevInput,
          ema: options._ema,
        };
        return new Promise<HTMLCanvasElement>((resolve) => {
          resolveFallback = () => resolve(input as HTMLCanvasElement);
        });
      },
      options: {},
      defaults: {},
      optionTypes: {},
    };
    await act(async () => {
      latest.actions.chainReplace(latest.state.chain[0].id, fallbackFilter.name, fallbackFilter);
    });
    const entryId = latest.state.chain[0].id;
    resourceMocks.workerRPC.mockResolvedValueOnce({
      imageData: new Uint8ClampedArray(pixelCount).buffer,
      width,
      height,
      stepTimes: [{ name: fallbackFilter.name, filterName: fallbackFilter.name, ms: 1 }],
      prevOutputs: { [entryId]: { imageData: new Uint8ClampedArray(pixelCount).buffer, width, height } },
      prevInputs: { [entryId]: new Uint8ClampedArray(pixelCount).buffer },
      emaMaps: { [entryId]: new Float32Array(pixelCount).buffer },
    });
    vi.spyOn(slowFilterRegistry, "recordFilterStepMs").mockImplementationOnce(() => {
      throw new Error("injected worker timing failure");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const input = document.createElement("canvas");
    input.width = width;
    input.height = height;
    resetCanvasPoolStats();

    latest.actions.filterImageAsync(input);
    await vi.waitFor(() => expect(resolveFallback).toBeTypeOf("function"));
    expect(latest.actions.getIntermediatePreview(entryId)).toBeNull();
    expect(fallbackTemporal).toEqual({ prevOutput: null, prevInput: null, ema: null });
    expect(getCanvasPoolStats().releases).toBeGreaterThanOrEqual(2);

    await act(async () => {
      resolveFallback?.(input);
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => root.unmount());
  });

  it("contains synchronous worker option serialization failure and accepts the next request", async () => {
    const root = await mountProvider();
    const passFilter: FilterDefinition = {
      name: "Worker serialization fallback",
      func: (input) => input,
      options: {},
      defaults: {},
      optionTypes: {},
    };
    await act(async () => {
      latest.actions.chainReplace(latest.state.chain[0].id, passFilter.name, passFilter);
    });
    Object.defineProperty(latest.state.chain[0].filter.options!, "injected", {
      configurable: true,
      enumerable: true,
      get: () => { throw new Error("injected worker serialization failure"); },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const input = document.createElement("canvas");
    input.width = 1;
    input.height = 1;

    expect(() => latest.actions.filterImageAsync(input)).not.toThrow();
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith(
      "Main-thread worker fallback failed:",
      expect.any(Error),
    ));
    expect(resourceMocks.workerRPC).not.toHaveBeenCalled();

    delete latest.state.chain[0].filter.options!.injected;
    resourceMocks.workerRPC.mockResolvedValueOnce({
      imageData: new Uint8ClampedArray(4).buffer,
      width: 1,
      height: 1,
      stepTimes: [],
      prevOutputs: {},
      prevInputs: {},
      emaMaps: {},
    });
    await act(async () => {
      latest.actions.filterImageAsync(input);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(resourceMocks.workerRPC).toHaveBeenCalledOnce();
    expect(latest.state.outputImage).toMatchObject({ width: 1, height: 1 });
    await act(async () => root.unmount());
  });

  it("contains a synchronous workerRPC throw and unpins processing for fallback and retry", async () => {
    const root = await mountProvider();
    const passFilter: FilterDefinition = {
      name: "Synchronous workerRPC fallback",
      func: (input) => input,
      options: {},
      defaults: {},
      optionTypes: {},
    };
    await act(async () => {
      latest.actions.chainReplace(latest.state.chain[0].id, passFilter.name, passFilter);
    });
    resourceMocks.workerRPC.mockImplementationOnce(() => {
      throw new Error("injected synchronous workerRPC failure");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const input = document.createElement("canvas");
    input.width = 1;
    input.height = 1;

    expect(() => latest.actions.filterImageAsync(input)).not.toThrow();
    await vi.waitFor(() => expect(latest.state.outputImage).toBe(input));
    expect(error).toHaveBeenCalledWith(
      "Worker failed, falling back to main thread:",
      expect.any(Error),
    );

    resourceMocks.workerRPC.mockResolvedValueOnce({
      imageData: new Uint8ClampedArray(4).buffer,
      width: 1,
      height: 1,
      stepTimes: [],
      prevOutputs: {},
      prevInputs: {},
      emaMaps: {},
    });
    await act(async () => {
      latest.actions.filterImageAsync(input);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(resourceMocks.workerRPC).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
  });
});
