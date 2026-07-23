import React, { act, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@gyng/ditherer-filters/client", async () => {
  const actual = await vi.importActual<typeof import("@gyng/ditherer-filters/client")>("@gyng/ditherer-filters/client");
  return { ...actual, USE_WORKER: false, disposeFilterWorker: vi.fn() };
});

import { FilterProvider } from "context/FilterContext";
import { FilterContext, type FilterContextValue } from "context/filterContextValue";
import type { FilterDefinition } from "filters/types";
import { setGlobalAudioVizModulation } from "utils/audioVizBridge";
import {
  getCanvasPoolStats,
  releasePooledCanvas,
  resetCanvasPoolStats,
  takePooledCanvas,
} from "@gyng/ditherer-filters";
import * as slowFilterRegistry from "utils/slowFilterRegistry";

let root: Root;
let container: HTMLDivElement;
let latest: FilterContextValue;

const Probe = () => {
  const value = useContext(FilterContext);
  if (!value) throw new Error("FilterContext is missing");
  latest = value;
  return null;
};

const flush = async (operation: () => void | Promise<void>) => {
  await act(async () => { await operation(); });
};

const makeCanvas = (width: number, height = 1) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const render = async (input: HTMLCanvasElement) => {
  await flush(async () => {
    latest.actions.filterImageAsync(input);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const filter = (
  name: string,
  func: FilterDefinition["func"],
  options: Record<string, unknown> = {},
): FilterDefinition => ({
  name,
  func,
  options,
  defaults: options,
  optionTypes: Object.fromEntries(
    Object.keys(options).map((key) => [key, { type: "RANGE", range: [0, 20], default: options[key] }]),
  ),
});

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  history.replaceState(null, "", "/");
  setGlobalAudioVizModulation("chain", null);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await flush(() => root.render(<FilterProvider><Probe /></FilterProvider>));
});

afterEach(async () => {
  await flush(() => root.unmount());
  container.remove();
  setGlobalAudioVizModulation("chain", null);
  vi.restoreAllMocks();
});

describe("FilterProvider cache dependency invalidation", () => {
  it("defers a displayed aliased cache canvas until output handoff", async () => {
    const width = 227;
    const height = 31;
    let run = 0;
    const pooledStage = filter("Displayed pooled", () => {
      const output = takePooledCanvas(width, height) as HTMLCanvasElement;
      const red = run++ === 0;
      (output as HTMLCanvasElement & { __testPixel?: string }).__testPixel = red ? "red" : "green";
      return output;
    });
    const aliasStage = filter("Displayed alias", (input) => input);
    await flush(() => {
      latest.actions.selectFilter(pooledStage.name, pooledStage);
      latest.actions.chainAdd(aliasStage.name, aliasStage);
    });
    const input = makeCanvas(1);
    await render(input);
    const displayed = latest.state.outputImage!;
    expect((displayed as HTMLCanvasElement & { __testPixel?: string }).__testPixel).toBe("red");

    resetCanvasPoolStats();
    await flush(() => latest.actions.setLinearize(false));
    const unavailableWhileDisplayed = takePooledCanvas(width, height) as HTMLCanvasElement;
    expect(unavailableWhileDisplayed).not.toBe(displayed);
    expect((displayed as HTMLCanvasElement & { __testPixel?: string }).__testPixel).toBe("red");
    expect(getCanvasPoolStats().releases).toBe(0);
    releasePooledCanvas(unavailableWhileDisplayed);
    const releasesBeforeHandoff = getCanvasPoolStats().releases;

    await render(input);
    expect(latest.state.outputImage).not.toBe(displayed);
    expect((latest.state.outputImage as HTMLCanvasElement & { __testPixel?: string }).__testPixel).toBe("green");
    expect(getCanvasPoolStats().releases).toBe(releasesBeforeHandoff + 1);
    expect(takePooledCanvas(width, height)).toBe(displayed);

    resetCanvasPoolStats();
    await flush(() => root.unmount());
    expect(getCanvasPoolStats().releases).toBe(1);
    container.remove();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  it("keeps a staged intermediate checked out until a stale deferred chain settles", async () => {
    const width = 229;
    const height = 37;
    let intermediate: HTMLCanvasElement | undefined;
    let resolveSecond: ((canvas: HTMLCanvasElement) => void) | undefined;
    const firstStage = filter("Transactional first", () => {
      intermediate = takePooledCanvas(width, height) as HTMLCanvasElement;
      return intermediate;
    });
    const deferredStage = filter("Transactional deferred", () =>
      new Promise<HTMLCanvasElement>((resolve) => { resolveSecond = resolve; }));
    await flush(() => {
      latest.actions.selectFilter(firstStage.name, firstStage);
      latest.actions.chainAdd(deferredStage.name, deferredStage);
    });
    const firstId = latest.state.chain[0].id;
    latest.actions.filterImageAsync(makeCanvas(1));
    await flush(async () => { await Promise.resolve(); });
    expect(intermediate).toBeTruthy();
    expect(resolveSecond).toBeTypeOf("function");
    expect(latest.actions.getIntermediatePreview(firstId)).toBeNull();

    await flush(() => latest.actions.setLinearize(false));
    const unavailableInFlight = takePooledCanvas(width, height) as HTMLCanvasElement;
    expect(unavailableInFlight).not.toBe(intermediate);
    resolveSecond?.(intermediate!);
    await flush(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(takePooledCanvas(width, height)).toBe(intermediate);
    releasePooledCanvas(unavailableInFlight);
  });

  it("pins a warmed cached prefix until an invalidated deferred suffix settles", async () => {
    const prefixWidth = 269;
    const height = 71;
    let prefix: HTMLCanvasElement | undefined;
    let suffixRuns = 0;
    let resolveSuffix: ((canvas: HTMLCanvasElement) => void) | undefined;
    const prefixFilter = filter("Pinned prefix", () => {
      prefix = takePooledCanvas(prefixWidth, height) as HTMLCanvasElement;
      return prefix;
    });
    const middleFilter = filter("Pinned middle", () =>
      takePooledCanvas(prefixWidth + 2, height) as HTMLCanvasElement, { amount: 1 });
    const suffixFilter = filter("Pinned suffix", (_input) => {
      suffixRuns += 1;
      if (suffixRuns === 1) return takePooledCanvas(prefixWidth + 4, height) as HTMLCanvasElement;
      return new Promise<HTMLCanvasElement>((resolve) => { resolveSuffix = resolve; });
    });
    await flush(() => {
      latest.actions.selectFilter(prefixFilter.name, prefixFilter);
      latest.actions.chainAdd(middleFilter.name, middleFilter);
      latest.actions.chainAdd(suffixFilter.name, suffixFilter);
    });
    const input = makeCanvas(1);
    await render(input);
    expect(prefix).toBeTruthy();

    await flush(() => latest.actions.setFilterOption("amount", 2, 1));
    latest.actions.filterImageAsync(input);
    await flush(async () => { await Promise.resolve(); });
    expect(resolveSuffix).toBeTypeOf("function");
    await flush(() => latest.actions.setLinearize(false));

    const unavailableWhilePinned = takePooledCanvas(prefixWidth, height) as HTMLCanvasElement;
    expect(unavailableWhilePinned).not.toBe(prefix);
    resolveSuffix?.(takePooledCanvas(prefixWidth + 2, height) as HTMLCanvasElement);
    await flush(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(takePooledCanvas(prefixWidth, height)).toBe(prefix);
    releasePooledCanvas(unavailableWhilePinned);
  });

  it("automatically reruns static chain output when global chain audio modulation changes", async () => {
    const stage = vi.fn((input: HTMLCanvasElement | OffscreenCanvas) => makeCanvas(input.width + 1));
    const tail = vi.fn((input: HTMLCanvasElement | OffscreenCanvas) => makeCanvas(input.width + 1));
    const stageFilter = filter("Scheduled audio stage", stage, { amount: 1 });
    const tailFilter = filter("Scheduled audio tail", tail);
    const input = makeCanvas(2);
    await flush(() => {
      latest.actions.selectFilter(stageFilter.name, stageFilter);
      latest.actions.chainAdd(tailFilter.name, tailFilter);
      latest.actions.setInputCanvas(input);
    });
    await render(input);

    await flush(async () => {
      setGlobalAudioVizModulation("chain", {
        connections: [{ metric: "beat", target: "amount", weight: 0.5 }],
      });
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(stage).toHaveBeenCalledTimes(2);
    expect(tail).toHaveBeenCalledTimes(2);

    await flush(async () => {
      setGlobalAudioVizModulation("chain", null);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(stage).toHaveBeenCalledTimes(3);
    expect(tail).toHaveBeenCalledTimes(3);
  });

  it("contains direct main-thread snapshot and step-callback rejection and accepts the next run", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stage = vi.fn((input: HTMLCanvasElement | OffscreenCanvas) => makeCanvas(input.width + 1));
    const stageFilter = filter("Recoverable direct stage", stage);
    await flush(() => latest.actions.selectFilter(stageFilter.name, stageFilter));
    const input = makeCanvas(3);
    const inputContext = input.getContext("2d")!;
    vi.spyOn(inputContext, "getImageData").mockImplementationOnce(() => {
      throw new Error("injected input snapshot failure");
    });

    await render(input);
    expect(stage).not.toHaveBeenCalled();
    await render(input);
    expect(stage).toHaveBeenCalledOnce();

    vi.spyOn(slowFilterRegistry, "recordFilterStepMs").mockImplementationOnce(() => {
      throw new Error("injected step callback failure");
    });
    await flush(() => latest.actions.setLinearize(false));
    await render(input);
    expect(stage).toHaveBeenCalledTimes(2);
    await render(input);
    expect(stage).toHaveBeenCalledTimes(3);
    expect(latest.state.outputImage).toBeInstanceOf(HTMLCanvasElement);
    expect(error).toHaveBeenCalledWith("Main-thread filter chain failed:", expect.any(Error));
  });

  it("cleans a failed export transaction and allows the session to restart", async () => {
    const width = 271;
    const height = 73;
    let shouldFail = true;
    const stage = filter("Recoverable export stage", () => {
      const output = takePooledCanvas(width, height) as HTMLCanvasElement;
      if (shouldFail) {
        shouldFail = false;
        vi.spyOn(output.getContext("2d")!, "getImageData").mockImplementationOnce(() => {
          throw new Error("injected export output snapshot failure");
        });
      }
      return output;
    });
    await flush(() => latest.actions.selectFilter(stage.name, stage));
    resetCanvasPoolStats();

    await expect(latest.actions.renderFrameForExport(makeCanvas(width, height), {
      sessionId: "recoverable-export",
    })).rejects.toThrow("injected export output snapshot failure");
    const releasesAfterFailure = getCanvasPoolStats().releases;
    expect(releasesAfterFailure).toBeGreaterThanOrEqual(2);

    const recovered = await latest.actions.renderFrameForExport(makeCanvas(width, height), {
      sessionId: "recoverable-export",
      time: 1,
    });
    expect(recovered).toMatchObject({ width, height });
    latest.actions.clearExportSession("recoverable-export");
    expect(getCanvasPoolStats().releases).toBeGreaterThan(releasesAfterFailure);
  });

  it("reruns a paused-video chain when a new frame token redraws the same source canvas", async () => {
    const firstStage = vi.fn((input: HTMLCanvasElement | OffscreenCanvas) => makeCanvas(input.width + 1));
    const secondStage = vi.fn((input: HTMLCanvasElement | OffscreenCanvas) => makeCanvas(input.width + 1));
    const firstFilter = filter("Frame revision first", firstStage);
    const secondFilter = filter("Frame revision second", secondStage);
    await flush(() => {
      latest.actions.selectFilter(firstFilter.name, firstFilter);
      latest.actions.chainAdd(secondFilter.name, secondFilter);
    });

    const createElement = document.createElement.bind(document);
    let video: HTMLVideoElement | undefined;
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = createElement(tagName, options);
      if (tagName === "video") {
        video = element as HTMLVideoElement;
        Object.defineProperties(video, {
          readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
          videoWidth: { configurable: true, value: 3 },
          videoHeight: { configurable: true, value: 2 },
          paused: { configurable: true, value: true },
          currentTime: { configurable: true, writable: true, value: 0 },
        });
        video.play = vi.fn().mockResolvedValue(undefined);
        video.pause = vi.fn();
        video.load = vi.fn();
      }
      return element;
    }) as typeof document.createElement);

    const loading = latest.actions.loadVideoFromUrlAsync("test://paused-video", 0);
    expect(video).toBeTruthy();
    await flush(() => { video!.onloadedmetadata?.(new Event("loadedmetadata")); });
    await loading;
    await flush(() => { video!.onloadeddata?.(new Event("loadeddata")); });
    const sharedSource = latest.state.inputImage as HTMLCanvasElement;
    await render(sharedSource);
    const previousOutput = latest.state.outputImage;

    await flush(() => {
      video!.currentTime = 1;
      video!.onseeked?.(new Event("seeked"));
    });
    expect(latest.state.inputImage).toBe(sharedSource);
    await render(sharedSource);

    expect(firstStage).toHaveBeenCalledTimes(2);
    expect(secondStage).toHaveBeenCalledTimes(2);
    expect(latest.state.outputImage).not.toBe(previousOutput);
  });

  it("plateaus non-caching multi-stage grayscale export canvases", async () => {
    const width = 263;
    const height = 61;
    const firstFilter = filter("Export pooled first", (input) =>
      takePooledCanvas(input.width, input.height) as HTMLCanvasElement);
    const secondFilter = filter("Export pooled second", (input) =>
      takePooledCanvas(input.width, input.height) as HTMLCanvasElement);
    await flush(() => {
      latest.actions.selectFilter(firstFilter.name, firstFilter);
      latest.actions.chainAdd(secondFilter.name, secondFilter);
      latest.actions.setConvertGrayscale(true);
    });
    const input = makeCanvas(width, height);
    resetCanvasPoolStats();
    for (let frame = 0; frame < 6; frame += 1) {
      const rendered = await latest.actions.renderFrameForExport(input, {
        sessionId: "pooled-export",
        time: frame,
      });
      expect(rendered).toMatchObject({ width, height });
    }
    latest.actions.clearExportSession("pooled-export");
    expect(getCanvasPoolStats().allocations).toBeLessThanOrEqual(3);
    expect(getCanvasPoolStats().reuses).toBeGreaterThan(0);
  });

  it.each([
    "grayscale",
    "linearize",
    "wasm",
    "webgl",
    "scale",
    "output-scale",
    "scaling-algorithm",
    "input-canvas",
    "global-audio",
  ] as const)("reruns the complete chain after a %s change", async (change) => {
    const firstStage = vi.fn((input: HTMLCanvasElement | OffscreenCanvas, options: Record<string, unknown> = {}) => {
      const runtimeOffset = Number(options._linearize === false)
        + Number(options._wasmAcceleration === false) * 2
        + Number(options._webglAcceleration === false) * 4;
      return makeCanvas(input.width + 10 + runtimeOffset, input.height);
    });
    const secondStage = vi.fn((input: HTMLCanvasElement | OffscreenCanvas) =>
      makeCanvas(input.width + 1, input.height));
    const firstFilter = filter("Cache first", firstStage);
    const secondFilter = filter("Cache second", secondStage);
    await flush(() => {
      latest.actions.selectFilter(firstFilter.name, firstFilter);
      latest.actions.chainAdd(secondFilter.name, secondFilter);
    });
    const originalInput = makeCanvas(2);
    await render(originalInput);
    const previousOutput = latest.state.outputImage;
    const previousWidth = previousOutput?.width;

    let nextInput = originalInput;
    await flush(() => {
      if (change === "grayscale") latest.actions.setConvertGrayscale(true);
      if (change === "linearize") latest.actions.setLinearize(false);
      if (change === "wasm") latest.actions.setWasmAcceleration(false);
      if (change === "webgl") latest.actions.setWebglAcceleration(false);
      if (change === "scale") latest.actions.setScale(0.5);
      if (change === "output-scale") latest.actions.setOutputScale(2);
      if (change === "scaling-algorithm") latest.actions.setScalingAlgorithm("pixelated");
      if (change === "input-canvas") {
        nextInput = makeCanvas(7);
        latest.actions.setInputCanvas(nextInput);
      }
      if (change === "global-audio") {
        setGlobalAudioVizModulation("chain", {
          connections: [{ metric: "beat", target: "amount", weight: 0.5 }],
          normalizedMetrics: ["beat"],
        });
      }
    });
    await render(nextInput);

    expect(firstStage).toHaveBeenCalledTimes(2);
    expect(secondStage).toHaveBeenCalledTimes(2);
    expect(latest.state.outputImage).not.toBe(previousOutput);
    if (["linearize", "wasm", "webgl", "input-canvas"].includes(change)) {
      expect(latest.state.outputImage?.width).not.toBe(previousWidth);
    }
  });

  it.each(["replace", "audio-modulation"] as const)(
    "evicts an edited middle stage and every downstream stage after %s",
    async (change) => {
      const firstStage = vi.fn((input: HTMLCanvasElement | OffscreenCanvas) => makeCanvas(input.width + 1));
      const middleStage = vi.fn((input: HTMLCanvasElement | OffscreenCanvas) => makeCanvas(input.width + 2));
      const replacementStage = vi.fn((input: HTMLCanvasElement | OffscreenCanvas) => makeCanvas(input.width + 6));
      const lastStage = vi.fn((input: HTMLCanvasElement | OffscreenCanvas) => makeCanvas(input.width + 3));
      const firstFilter = filter("Dependency first", firstStage);
      const middleFilter = filter("Dependency middle", middleStage, { amount: 1 });
      const replacementFilter = filter("Dependency replacement", replacementStage, { amount: 1 });
      const lastFilter = filter("Dependency last", lastStage);
      await flush(() => {
        latest.actions.selectFilter(firstFilter.name, firstFilter);
        latest.actions.chainAdd(middleFilter.name, middleFilter);
        latest.actions.chainAdd(lastFilter.name, lastFilter);
      });
      const middleId = latest.state.chain[1].id;
      const input = makeCanvas(1);
      await render(input);
      const previousOutput = latest.state.outputImage;

      await flush(() => {
        if (change === "replace") {
          latest.actions.chainReplace(middleId, replacementFilter.name, replacementFilter);
        } else {
          latest.actions.setChainAudioModulation(middleId, {
            connections: [{ metric: "beat", target: "amount", weight: 0.5 }],
            normalizedMetrics: ["beat"],
          });
        }
      });
      await render(input);

      expect(firstStage).toHaveBeenCalledOnce();
      expect(lastStage).toHaveBeenCalledTimes(2);
      expect(latest.state.outputImage).not.toBe(previousOutput);
      if (change === "replace") {
        expect(middleStage).toHaveBeenCalledOnce();
        expect(replacementStage).toHaveBeenCalledOnce();
        expect(latest.state.outputImage?.width).toBe(11);
      } else {
        expect(middleStage).toHaveBeenCalledTimes(2);
        expect(replacementStage).not.toHaveBeenCalled();
        expect(latest.state.outputImage?.width).toBe(7);
      }
    },
  );
});
