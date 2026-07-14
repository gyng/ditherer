import React, { act, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilterProvider } from "context/FilterContext";
import { FilterContext, type FilterContextValue } from "context/filterContextValue";
import { filterIndex } from "filters";
import type { FilterDefinition } from "filters/types";
import { setGlobalAudioVizModulation } from "utils/audioVizBridge";

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
  await act(async () => {
    await operation();
  });
};

const mountProvider = async () => {
  await flush(() => root.render(
    <FilterProvider>
      <Probe />
    </FilterProvider>,
  ));
};

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  history.replaceState(null, "", "/");
  setGlobalAudioVizModulation("chain", null);
  setGlobalAudioVizModulation("screensaver", null);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      readText: vi.fn(),
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await mountProvider();
});

afterEach(async () => {
  await flush(() => root.unmount());
  container.remove();
  setGlobalAudioVizModulation("chain", null);
  setGlobalAudioVizModulation("screensaver", null);
  vi.restoreAllMocks();
});

describe("FilterProvider action contract", () => {
  it("applies scalar settings and exports a shareable v1 state", async () => {
    await flush(() => {
      latest.actions.setConvertGrayscale(true);
      latest.actions.setLinearize(true);
      latest.actions.setWasmAcceleration(false);
      latest.actions.setWebglAcceleration(false);
      latest.actions.setRandomCycleSeconds(4);
      latest.actions.setScale(0.75);
      latest.actions.setOutputScale(1.5);
      latest.actions.setRealtimeFiltering(false);
      latest.actions.setInputVolume(0.25);
      latest.actions.setInputPlaybackRate(1.5);
      latest.actions.setScalingAlgorithm("pixelated");
    });

    expect(latest.state).toMatchObject({
      convertGrayscale: true,
      linearize: true,
      wasmAcceleration: false,
      webglAcceleration: false,
      randomCycleSeconds: 4,
      scale: 0.75,
      outputScale: 1.5,
      realtimeFiltering: false,
      videoVolume: 0.25,
      videoPlaybackRate: 1.5,
      scalingAlgorithm: "pixelated",
    });

    const exported = JSON.parse(latest.actions.exportState(latest.state));
    expect(exported).toMatchObject({
      convertGrayscale: true,
      linearize: true,
      wasmAcceleration: false,
      r: 4,
    });
    expect(latest.actions.getExportUrl(latest.state)).toContain("#!");
  });

  it("mutates a chain through add, reorder, toggle, replace, duplicate, and remove", async () => {
    const initialId = latest.state.chain[0].id;
    await flush(() => latest.actions.chainAdd("Binarize", filterIndex.Binarize));
    const addedId = latest.state.chain[1].id;
    expect(latest.state.chain.map((entry) => entry.displayName)).toEqual(["Floyd-Steinberg", "Binarize"]);

    await flush(() => {
      latest.actions.chainSetActive(1);
      latest.actions.setFilterOption("threshold", 64, 1);
      latest.actions.chainToggle(addedId);
      latest.actions.chainDuplicate(addedId);
    });
    expect(latest.state.chain).toHaveLength(3);
    expect(latest.state.chain[1].enabled).toBe(false);

    await flush(() => latest.actions.chainReorder(2, 0));
    expect(latest.state.chain[0].displayName).toBe("Binarize");

    await flush(() => latest.actions.chainReplace(initialId, "Grayscale", filterIndex.Grayscale));
    expect(latest.state.chain.some((entry) => entry.displayName === "Grayscale")).toBe(true);

    await flush(() => latest.actions.setChainAudioModulation(addedId, {
      connections: [{ metric: "beat", target: "threshold", weight: 0.5 }],
      normalizedMetrics: ["beat"],
    }));
    expect(latest.state.chain.find((entry) => entry.id === addedId)?.audioMod?.connections).toHaveLength(1);

    await flush(() => latest.actions.chainRemove(addedId));
    expect(latest.state.chain.some((entry) => entry.id === addedId)).toBe(false);
  });

  it("round-trips v2 state and global audio modulation through clipboard and JSON", async () => {
    await flush(() => {
      latest.actions.chainAdd("Binarize", filterIndex.Binarize);
      latest.actions.setFilterOption("threshold", 96, 1);
      latest.actions.chainToggle(latest.state.chain[0].id);
    });
    setGlobalAudioVizModulation("chain", {
      connections: [{ metric: "bass", target: `${latest.state.chain[1].id}:threshold`, weight: -0.25 }],
      normalizedMetrics: ["bass"],
    });

    const json = latest.actions.exportState(latest.state);
    const parsed = JSON.parse(json);
    expect(parsed).toMatchObject({ v: 2, chain: expect.any(Array), av: expect.any(Object) });

    latest.actions.copyChainToClipboard();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('"v":2'));

    vi.mocked(navigator.clipboard.readText).mockResolvedValue(json);
    await flush(() => latest.actions.pasteChainFromClipboard());
    expect(latest.state.chain).toHaveLength(2);
    expect(latest.state.chain[1].filter.options?.threshold).toBe(96);

    await flush(() => latest.actions.importState(JSON.stringify({
      selected: { displayName: "Grayscale", filter: { name: "Grayscale" } },
      convertGrayscale: false,
      linearize: false,
      wasmAcceleration: true,
    })));
    expect(latest.state.chain[0].displayName).toBe("Grayscale");
  });

  it("stores custom palettes and handles absent and present video controls", async () => {
    await flush(() => {
      latest.actions.saveCurrentColorPalette("My Palette", [[1, 2, 3, 255]]);
      latest.actions.deleteCurrentColorPalette("My Palette");
      latest.actions.toggleVideo();
    });
    expect(localStorage.getItem("_palette_MyPalette")).toBeNull();

    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    const video = Object.assign(document.createElement("video"), { play, pause });
    Object.defineProperty(video, "paused", { configurable: true, value: true });
    await flush(() => latest.actions.loadImage(document.createElement("canvas"), 1, video));
    latest.actions.toggleVideo();
    expect(play).toHaveBeenCalledOnce();

    Object.defineProperty(video, "paused", { configurable: true, value: false });
    latest.actions.toggleVideo();
    expect(pause).toHaveBeenCalledOnce();
  });

  it("renders isolated export frames and clears temporal sessions", async () => {
    await expect(latest.actions.renderFrameForExport(null, { sessionId: "none" })).resolves.toBeNull();

    const input = document.createElement("canvas");
    input.width = 4;
    input.height = 3;
    await flush(() => latest.actions.setConvertGrayscale(true));
    const first = await latest.actions.renderFrameForExport(input, { sessionId: "export", time: 0 });
    const second = await latest.actions.renderFrameForExport(input, { sessionId: "export", time: 1 });
    expect(first).toBeInstanceOf(HTMLCanvasElement);
    expect(second).toBeInstanceOf(HTMLCanvasElement);
    expect(first).toMatchObject({ width: 4, height: 3 });
    latest.actions.clearExportSession("export");
    expect(latest.actions.getIntermediatePreview("missing")).toBeNull();
  });

  it("runs synchronous, asynchronous, failing, and unavailable-GL chain steps safely", async () => {
    const makeOutput = (input: HTMLCanvasElement | OffscreenCanvas) => {
      const output = document.createElement("canvas");
      output.width = input.width;
      output.height = input.height;
      return output;
    };
    const syncFilter: FilterDefinition = {
      name: "Test sync",
      func: (input) => makeOutput(input),
      defaults: { amount: 1 },
      options: { amount: 1 },
      optionTypes: { amount: { type: "RANGE", range: [0, 2], default: 1 } },
    };
    const asyncFilter: FilterDefinition = {
      name: "Test async",
      func: async (input) => makeOutput(input),
      defaults: {},
      options: {},
      optionTypes: {},
    };
    const throwingFilter: FilterDefinition = {
      name: "Test failure",
      func: () => { throw new Error("expected filter failure"); },
      defaults: {},
      options: {},
      optionTypes: {},
    };
    const glFilter: FilterDefinition = {
      name: "Test GL only",
      func: () => { throw new Error("GL-only function must not run without WebGL2"); },
      defaults: {},
      options: {},
      optionTypes: {},
      requiresGL: true,
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await flush(() => {
      latest.actions.selectFilter("Test sync", syncFilter);
      latest.actions.chainAdd("Test async", asyncFilter);
      latest.actions.chainAdd("Test failure", throwingFilter);
      latest.actions.chainAdd("Test GL only", glFilter);
    });
    const input = document.createElement("canvas");
    input.width = 5;
    input.height = 4;
    await flush(async () => {
      latest.actions.setInputCanvas(input);
      latest.actions.filterImageAsync(input);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(error).toHaveBeenCalledWith('Filter "Test failure" threw:', expect.any(Error));
    expect(latest.state.outputImage).toBeInstanceOf(HTMLCanvasElement);
    expect(latest.state.outputImage).toMatchObject({ width: 5, height: 4 });
    expect(latest.actions.getIntermediatePreview(latest.state.chain[0].id)).toBeInstanceOf(HTMLCanvasElement);

    await flush(async () => {
      latest.actions.filterImageAsync(input);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(latest.state.stepTimes).toHaveLength(4);
  });

  it("contains malformed clipboard state and mutates palette-backed filters safely", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(navigator.clipboard.readText).mockResolvedValue("not json");
    await latest.actions.pasteChainFromClipboard();
    expect(warn).toHaveBeenCalledWith("Failed to paste chain:", expect.any(SyntaxError));

    expect(() => latest.actions.importState("not json")).toThrow(SyntaxError);

    await flush(() => latest.actions.selectFilter("Ordered", filterIndex.Ordered));
    const palette = latest.state.chain[0].filter.options?.palette as {
      options?: { colors?: number[][]; [key: string]: unknown };
    };
    expect(palette?.options).toBeTruthy();
    const originalLength = palette.options?.colors?.length ?? 0;

    await flush(() => {
      latest.actions.setFilterPaletteOption("colorDistanceAlgorithm", "RGB_NEAREST");
      latest.actions.addPaletteColor([1, 2, 3, 255]);
    });
    const updated = latest.state.chain[0].filter.options?.palette as {
      options?: { colors?: number[][]; colorDistanceAlgorithm?: string };
    };
    expect(updated.options?.colorDistanceAlgorithm).toBe("RGB_NEAREST");
    expect(updated.options?.colors).toHaveLength(originalLength + 1);

    await flush(() => latest.actions.selectFilter("Grayscale", filterIndex.Grayscale));
    await flush(() => {
      latest.actions.setFilterPaletteOption("missing", true);
      latest.actions.addPaletteColor([0, 0, 0, 255]);
    });
    expect(warn).toHaveBeenCalledWith("Tried to set option on null palette", expect.any(Object));
    expect(warn).toHaveBeenCalledWith("Tried to add color to null palette", expect.any(Object));
  });

  it("starts, advances, and stops explicit and auto-owned animation loops", async () => {
    const callbacks: FrameRequestCallback[] = [];
    let nextHandle = 1;
    const request = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return nextHandle++;
    });
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const input = document.createElement("canvas");
    input.width = 2;
    input.height = 2;
    await flush(() => latest.actions.setInputCanvas(input));

    latest.actions.startAnimLoop(null);
    expect(latest.actions.isAnimating()).toBe(true);
    callbacks.shift()?.(16);
    expect(latest.actions.isAnimating()).toBe(false);

    latest.actions.startAnimLoop(input, 10);
    expect(latest.actions.isAnimating()).toBe(true);
    callbacks.shift()?.(50);
    callbacks.shift()?.(150);
    latest.actions.stopAnimLoop();
    expect(latest.actions.isAnimating()).toBe(false);
    expect(cancel).toHaveBeenCalled();

    const autoFilter: FilterDefinition = {
      name: "Auto",
      func: (canvas) => canvas as HTMLCanvasElement,
      defaults: {},
      options: {},
      optionTypes: {},
      autoAnimate: true,
      autoAnimateFps: 12,
    };
    await flush(() => latest.actions.chainAdd("Auto", autoFilter));
    expect(latest.actions.isAnimating()).toBe(true);
    const autoId = latest.state.chain.at(-1)!.id;
    await flush(() => latest.actions.chainToggle(autoId));
    expect(latest.actions.isAnimating()).toBe(false);
    expect(request).toHaveBeenCalled();
  });

  it("bounds degauss and burst animation lifecycles without overlapping active loops", async () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const input = document.createElement("canvas");
    input.width = 1;
    input.height = 1;

    latest.actions.triggerDegauss(null);
    latest.actions.triggerDegauss(input);
    expect(callbacks).toHaveLength(1);
    callbacks.shift()?.(0);

    latest.actions.triggerBurst(null, 2, 10);
    latest.actions.triggerBurst(input, 2, 10);
    expect(latest.actions.isAnimating()).toBe(true);
    callbacks.shift()?.(100);
    expect(latest.actions.isAnimating()).toBe(false);
    callbacks.shift()?.(101);

    latest.actions.triggerBurst(input, 0);
    callbacks.shift()?.(200);
    expect(latest.actions.isAnimating()).toBe(false);
    callbacks.shift()?.(201);
  });

  it("starts and retires auto-animation when a chain entry is replaced", async () => {
    const callbacks: FrameRequestCallback[] = [];
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const autoFilter: FilterDefinition = {
      name: "Replacement auto",
      func: (canvas) => canvas as HTMLCanvasElement,
      defaults: { animSpeed: 24 },
      options: { animSpeed: 24 },
      optionTypes: { animSpeed: { type: "RANGE", range: [1, 60], default: 24 } },
      autoAnimate: true,
    };
    const staticFilter: FilterDefinition = {
      name: "Replacement static",
      func: (canvas) => canvas as HTMLCanvasElement,
      defaults: {},
      options: {},
      optionTypes: {},
    };
    const id = latest.state.chain[0].id;

    await flush(() => latest.actions.chainReplace(id, "Replacement auto", autoFilter));
    expect(latest.actions.isAnimating()).toBe(false);

    const input = document.createElement("canvas");
    input.width = 1;
    input.height = 1;
    await flush(() => latest.actions.setInputCanvas(input));
    await flush(() => latest.actions.chainReplace(id, "Replacement auto", autoFilter));
    expect(latest.actions.isAnimating()).toBe(true);
    callbacks.shift()?.(50);

    await flush(() => latest.actions.chainReplace(id, "Replacement static", staticFilter));
    expect(latest.actions.isAnimating()).toBe(false);
    expect(cancel).toHaveBeenCalled();
  });

  it("serializes aliases and option-only filters while containing clipboard and export failures", async () => {
    const optionOnly: FilterDefinition = {
      name: "Internal name",
      func: (canvas) => canvas as HTMLCanvasElement,
      options: { keep: 2, skip: () => "not serializable" },
      optionTypes: {},
    };
    await flush(() => latest.actions.chainAdd("Friendly alias", optionOnly));
    const added = latest.state.chain.at(-1)!;
    await flush(() => {
      latest.actions.chainToggle(added.id);
      latest.actions.setChainAudioModulation(added.id, {
        connections: [],
        normalizedMetrics: ["beat"],
      });
    });
    setGlobalAudioVizModulation("screensaver", {
      connections: [{ metric: "level", target: "global", weight: 1 }],
    });

    const exported = JSON.parse(latest.actions.exportState(latest.state));
    expect(exported.chain.at(-1)).toMatchObject({
      n: "Internal name",
      d: "Friendly alias",
      o: { keep: 2 },
      e: false,
      m: { c: [], z: ["beat"] },
    });
    expect(exported.av.screensaver).toBeTruthy();

    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(navigator.clipboard.writeText).mockImplementation(() => {
      throw new Error("clipboard unavailable");
    });
    latest.actions.copyChainToClipboard();
    expect(warning).toHaveBeenCalledWith("Failed to copy chain:", expect.any(Error));

    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const input = document.createElement("canvas");
    await expect(latest.actions.renderFrameForExport(input, { sessionId: "no-context" })).resolves.toBeNull();
    getContext.mockRestore();
  });
});
