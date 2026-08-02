import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAIN_PRESETS } from "components/ChainList/presets";
import { getWebMCPAvailability, setupWebMCP, type WebMCPStatus } from "../src/webmcp";

type Tool = { name: string; execute: (args?: unknown) => unknown | Promise<unknown> };

const noopFilter = {
  name: "noop",
  func: (input: unknown) => input,
  defaults: {
    amount: 1,
    enabled: true,
    mode: "a",
    label: "hello",
    code: "return",
    curve: "0,0 1,1",
    color: "#fff",
    colors: [[0, 0, 0, 255]],
    palette: { name: "nearest", options: { levels: 2 } },
  },
  options: {
    amount: 1,
    enabled: true,
    mode: "a",
    label: "hello",
    code: "return",
    curve: "0,0 1,1",
    color: "#fff",
    colors: [[0, 0, 0, 255]],
    palette: {
      name: "nearest",
      options: { levels: 2 },
      optionTypes: { levels: { type: "RANGE", range: [1, 256], default: 2 } },
      defaults: { levels: 2 },
      getColor: vi.fn(),
    },
  },
  optionTypes: {
    amount: { type: "RANGE", range: [0, 10], step: 1, default: 1 },
    enabled: { type: "BOOL", default: true },
    mode: {
      type: "ENUM",
      options: [{ value: "a" }, { label: "Group", options: [{ value: "b" }] }],
      default: "a",
    },
    label: { type: "STRING", default: "hello" },
    code: { type: "TEXT", default: "return" },
    curve: { type: "CURVE", default: "0,0 1,1" },
    color: { type: "COLOR", default: "#fff" },
    colors: { type: "COLOR_ARRAY", default: [[0, 0, 0, 255]] },
    palette: { type: "PALETTE", default: { name: "nearest", options: { levels: 2 } } },
    run: { type: "ACTION", action: () => undefined },
    preview: { type: "THRESHOLD_MAP_PREVIEW" },
  },
};
const chainEntry = { id: "one", displayName: "Alpha", enabled: true, filter: noopFilter };

const makeHarness = async () => {
  const registered = new Map<string, Tool>();
  const unregisterTool = vi.fn();
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(navigator, "modelContext", {
    configurable: true,
    value: {
      registerTool: (tool: Tool) => registered.set(tool.name, tool),
      unregisterTool,
    },
  });
  const actions = {
    selectFilter: vi.fn(),
    chainAdd: vi.fn(),
    setFilterOption: vi.fn(),
    loadMediaAsync: vi.fn().mockResolvedValue(undefined),
  };
  const waitForMediaReady = vi.fn().mockResolvedValue(undefined);
  const state = {
    activeIndex: 0,
    chain: [chainEntry],
    inputImage: null,
    outputImage: null,
    videoVolume: 0.4,
    videoPlaybackRate: 1.25,
    video: null,
  };
  const filterList = [
    { displayName: "Alpha", category: "Color", description: "First filter", filter: noopFilter },
    { displayName: "Beta", category: "Geometry", description: "Second filter", filter: noopFilter },
  ];
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 3;
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const cleanup = setupWebMCP(
    {
      getState: () => state as never,
      getActions: () => actions as never,
      getFilterList: () => filterList as never,
      getOutputCanvas: () => canvas,
      waitForMediaReady,
    },
    {
      onStatus: (status) => {
        if (status.phase !== "registering") resolveReady();
      },
    },
  );
  await ready;
  const execute = (name: string, args?: unknown) =>
    registered.get(`ditherer.${name}`)!.execute(args);
  return {
    registered,
    unregisterTool,
    actions,
    waitForMediaReady,
    state,
    filterList,
    canvas,
    cleanup,
    execute,
  };
};

beforeEach(() => vi.restoreAllMocks());
afterEach(() => {
  Object.defineProperty(navigator, "modelContext", { configurable: true, value: undefined });
  Object.defineProperty(document, "modelContext", { configurable: true, value: undefined });
});

describe("WebMCP tool contracts", () => {
  it("reports unsupported, navigator, and document availability", () => {
    Object.defineProperty(document, "modelContext", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "modelContext", { configurable: true, value: undefined });
    expect(getWebMCPAvailability()).toMatchObject({
      supported: false,
      phase: "unsupported",
      api: null,
    });

    Object.defineProperty(navigator, "modelContext", {
      configurable: true,
      value: { registerTool: vi.fn() },
    });
    expect(getWebMCPAvailability()).toMatchObject({
      supported: true,
      phase: "registering",
      api: "navigator",
    });

    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool: vi.fn() },
    });
    expect(getWebMCPAvailability()).toMatchObject({ supported: true, api: "document" });
  });

  it("registers, filters read models, and unregisters every tool", async () => {
    const harness = await makeHarness();
    expect(harness.registered.size).toBe(8);
    await expect(
      harness.execute("listFilters", { category: " color ", query: "first" }),
    ).resolves.toEqual({
      count: 1,
      filters: [{ name: "Alpha", category: "Color", description: "First filter" }],
    });
    await expect(harness.execute("listFilters", { query: "missing" })).resolves.toMatchObject({
      count: 0,
    });
    await expect(
      harness.execute("listPresets", { category: "not-a-category" }),
    ).resolves.toMatchObject({ count: 0 });
    await expect(
      harness.execute("listPresets", { query: CHAIN_PRESETS[0].name }),
    ).resolves.toMatchObject({ count: 1 });
    const chain = (await harness.execute("getCurrentChain")) as {
      activeIndex: number;
      chain: Array<{ displayName: string; enabled: boolean; options: Record<string, unknown> }>;
    };
    expect(chain).toMatchObject({
      activeIndex: 0,
      chain: [{ displayName: "Alpha", enabled: true }],
    });
    expect(chain.chain[0].options.palette).toEqual({ name: "nearest", options: { levels: 2 } });

    harness.cleanup();
    expect(harness.unregisterTool).toHaveBeenCalledTimes(8);
  });

  it("validates option mutation and applies valid changes", async () => {
    const harness = await makeHarness();
    await expect(
      harness.execute("setFilterOption", { index: -1, optionName: "amount", value: 2 }),
    ).rejects.toThrow("non-negative integer");
    await expect(harness.execute("setFilterOption", { index: 0, value: 2 })).rejects.toThrow(
      "optionName is required",
    );
    await expect(
      harness.execute("setFilterOption", { index: 9, optionName: "amount", value: 2 }),
    ).rejects.toThrow("No chain entry");
    await expect(
      harness.execute("setFilterOption", { index: 0, optionName: "missing", value: 2 }),
    ).rejects.toThrow("Unknown option");
    await expect(
      harness.execute("setFilterOption", { index: 0, optionName: "amount", value: 20 }),
    ).rejects.toThrow("between 0 and 10");
    await expect(
      harness.execute("setFilterOption", { index: 0, optionName: "enabled", value: "yes" }),
    ).rejects.toThrow("must be a boolean");
    await expect(
      harness.execute("setFilterOption", { index: 0, optionName: "amount", value: Number.NaN }),
    ).rejects.toThrow("finite number");
    await expect(
      harness.execute("setFilterOption", { index: 0, optionName: "mode", value: "missing" }),
    ).rejects.toThrow("must be one of");
    await expect(
      harness.execute("setFilterOption", { index: 0, optionName: "label", value: 1 }),
    ).rejects.toThrow("must be a string");
    await expect(
      harness.execute("setFilterOption", { index: 0, optionName: "color", value: {} }),
    ).rejects.toThrow("must be a color");
    await expect(
      harness.execute("setFilterOption", { index: 0, optionName: "colors", value: ["red"] }),
    ).rejects.toThrow("array of color arrays");
    await expect(
      harness.execute("setFilterOption", { index: 0, optionName: "palette", value: [] }),
    ).rejects.toThrow("palette object");
    await expect(
      harness.execute("setFilterOption", { index: 0, optionName: "run", value: true }),
    ).rejects.toThrow("not directly editable");
    await expect(
      harness.execute("setFilterOption", { index: 0, optionName: "preview", value: true }),
    ).rejects.toThrow("not directly editable");
    await expect(
      harness.execute("setFilterOption", { index: 0, optionName: "amount", value: 2 }),
    ).resolves.toMatchObject({ ok: true, value: 2 });
    for (const [optionName, value] of [
      ["enabled", false],
      ["mode", "b"],
      ["label", "changed"],
      ["code", "changed"],
      ["curve", "0,0"],
      ["color", [1, 2, 3]],
      ["colors", [[1, 2, 3, 255]]],
      ["palette", { name: "Other" }],
    ] as const) {
      await expect(
        harness.execute("setFilterOption", { index: 0, optionName, value }),
      ).resolves.toMatchObject({ ok: true, optionName, value });
    }
    expect(harness.actions.setFilterOption).toHaveBeenCalledWith("amount", 2, 0);
  });

  it("rejects invalid presets/media and loads a data URL with state defaults", async () => {
    const harness = await makeHarness();
    await expect(harness.execute("applyPreset", {})).rejects.toThrow("required");
    await expect(harness.execute("applyPreset", { name: "missing" })).rejects.toThrow("not found");
    await expect(harness.execute("loadMedia", {})).rejects.toThrow("Provide exactly one");
    await expect(harness.execute("loadMedia", { dataUrl: "invalid" })).rejects.toThrow(
      "Invalid dataUrl",
    );
    await expect(
      harness.execute("loadMedia", { dataUrl: "data:text/plain,ok", volume: 2 }),
    ).rejects.toThrow("volume must be between");
    await expect(
      harness.execute("loadMedia", { dataUrl: "data:text/plain,ok", playbackRate: 0 }),
    ).rejects.toThrow("playbackRate must be greater");
    await expect(
      harness.execute("loadMedia", {
        dataUrl: "data:text/plain;base64,SGk=",
        filename: "hello.txt",
      }),
    ).resolves.toMatchObject({
      ok: true,
      filename: "hello.txt",
      mimeType: "text/plain",
      sizeBytes: 2,
    });
    expect(harness.actions.loadMediaAsync).toHaveBeenCalledWith(expect.any(File), 0.4, 1.25);
    expect(harness.waitForMediaReady).toHaveBeenCalledWith({ inputImage: null, outputImage: null });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("image", { status: 200, headers: { "content-type": "image/png" } }),
      )
      .mockResolvedValueOnce(new Response("missing", { status: 404 }));
    await expect(
      harness.execute("loadMedia", { url: "/fixture.png", volume: 0, playbackRate: 2 }),
    ).resolves.toMatchObject({ ok: true, filename: "fixture.png", mimeType: "image/png" });
    await expect(harness.execute("loadMedia", { url: "/missing.png" })).rejects.toThrow(
      "Failed to fetch media: 404",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("exports image metadata and rejects absent or failed canvases", async () => {
    const harness = await makeHarness();
    vi.spyOn(harness.canvas, "toBlob").mockImplementation((callback, type) => {
      callback(new Blob(["pixels"], { type: type || "image/png" }));
    });
    await expect(
      harness.execute("exportImage", { format: "jpeg", quality: 0.5 }),
    ).resolves.toMatchObject({
      ok: true,
      mimeType: "image/jpeg",
      width: 4,
      height: 3,
      sizeBytes: 6,
    });
    await expect(harness.execute("exportImage", { format: "gif" })).rejects.toThrow(
      "format must be",
    );
    await expect(harness.execute("exportImage", { quality: 2 })).rejects.toThrow(
      "quality must be between",
    );

    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:download");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    await expect(
      harness.execute("exportImage", {
        download: true,
        returnDataUrl: true,
        filename: "result.png",
      }),
    ).resolves.toMatchObject({ ok: true, dataUrl: expect.stringMatching(/^data:image\/png/) });
    expect(click).toHaveBeenCalledOnce();

    vi.spyOn(harness.canvas, "toBlob").mockImplementationOnce((callback) => callback(null));
    await expect(harness.execute("exportImage")).rejects.toThrow("Failed to export image");

    harness.canvas.width = 0;
    await expect(harness.execute("exportImage")).rejects.toThrow("No output canvas");
    await expect(harness.execute("exportVideo")).rejects.toThrow("No output canvas");
  });

  it("validates and records video exports with source defaults, teardown, and optional outputs", async () => {
    vi.useFakeTimers();
    const harness = await makeHarness();
    const stop = vi.fn();
    const requestFrame = vi.fn();
    const captureStream = vi.fn(() => ({
      getTracks: () => [{ stop }],
      getVideoTracks: () => [{ requestFrame }],
    }));
    Object.defineProperty(harness.canvas, "captureStream", {
      configurable: true,
      value: captureStream,
    });

    class FakeMediaRecorder {
      static isTypeSupported = vi.fn(
        (mime: string) => mime.includes("mp4") || mime.includes("vp8"),
      );
      state = "recording";
      mimeType: string;
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onerror: (() => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(_stream: unknown, options: { mimeType: string }) {
        this.mimeType = options.mimeType;
      }
      start() {
        this.ondataavailable?.({ data: new Blob(["frame"], { type: this.mimeType }) });
      }
      stop() {
        this.state = "inactive";
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);

    for (const args of [
      { durationSeconds: 0.1 },
      { durationSeconds: 31 },
      { durationSeconds: Number.NaN },
      { fps: 0 },
      { fps: 61 },
      { fps: Number.NaN },
    ]) {
      await expect(harness.execute("exportVideo", args)).rejects.toThrow(/durationSeconds|fps/);
    }

    (harness.state as unknown as { video: { duration: number } }).video = { duration: 60 };
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:video");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const recording = harness.execute("exportVideo", {
      fps: 12.6,
      mimeType: "video/mp4",
      filename: "clip.mp4",
      download: true,
      returnDataUrl: true,
    });
    await vi.runAllTimersAsync();
    await expect(recording).resolves.toMatchObject({
      ok: true,
      mimeType: "video/mp4",
      durationSeconds: 15,
      fps: 13,
      dataUrl: expect.stringMatching(/^data:video\/mp4/),
    });
    expect(captureStream).toHaveBeenCalledWith(13);
    expect(requestFrame).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(createUrl).toHaveBeenCalledOnce();
    expect(revokeUrl).toHaveBeenCalledWith("blob:video");

    harness.unregisterTool.mockImplementationOnce(() => {
      throw new Error("already removed");
    });
    expect(harness.cleanup).not.toThrow();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("degrades safely when the host API is absent or registration fails", () => {
    Object.defineProperty(navigator, "modelContext", { configurable: true, value: undefined });
    expect(() => setupWebMCP({} as never)()).not.toThrow();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    Object.defineProperty(navigator, "modelContext", {
      configurable: true,
      value: {
        registerTool: () => {
          throw new Error("host rejected");
        },
        unregisterTool: vi.fn(),
      },
    });
    expect(() => setupWebMCP({} as never)()).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(8);
  });

  it("prefers the current document API, awaits registration, reports status, and aborts cleanup", async () => {
    const legacyRegister = vi.fn();
    Object.defineProperty(navigator, "modelContext", {
      configurable: true,
      value: { registerTool: legacyRegister, unregisterTool: vi.fn() },
    });

    const registered = new Map<string, Tool>();
    const signals: AbortSignal[] = [];
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool: vi.fn(async (tool: Tool, options?: { signal?: AbortSignal }) => {
          registered.set(tool.name, tool);
          if (options?.signal) signals.push(options.signal);
        }),
      },
    });

    const statuses: WebMCPStatus[] = [];
    const actions = {
      selectFilter: vi.fn(),
      chainAdd: vi.fn(),
      setFilterOption: vi.fn(),
      loadMediaAsync: vi.fn(),
    };
    const canvas = document.createElement("canvas");
    const cleanup = setupWebMCP(
      {
        getState: () =>
          ({ activeIndex: 0, chain: [chainEntry], videoVolume: 1, videoPlaybackRate: 1 }) as never,
        getActions: () => actions as never,
        getFilterList: () =>
          [
            { displayName: "Alpha", category: "Color", description: "First", filter: noopFilter },
          ] as never,
        getOutputCanvas: () => canvas,
      },
      { onStatus: (status) => statuses.push(status) },
    );

    await vi.waitFor(() => expect(registered.size).toBe(8));
    expect(legacyRegister).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toMatchObject({
      phase: "ready",
      api: "document",
      registered: 8,
      total: 8,
    });
    expect(signals).toHaveLength(8);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);

    cleanup();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("reports partial support when only some current-API tools register", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool: vi.fn(async (tool: Tool) => {
          if (tool.name === "ditherer.exportVideo") throw new Error("video tools blocked");
        }),
      },
    });

    const statuses: WebMCPStatus[] = [];
    const cleanup = setupWebMCP(
      {
        getState: () =>
          ({ activeIndex: 0, chain: [chainEntry], videoVolume: 1, videoPlaybackRate: 1 }) as never,
        getActions: () => ({}) as never,
        getFilterList: () => [] as never,
        getOutputCanvas: () => null,
      },
      { onStatus: (status) => statuses.push(status) },
    );

    await vi.waitFor(() => expect(statuses.at(-1)?.phase).toBe("partial"));
    expect(statuses.at(-1)).toMatchObject({ api: "document", registered: 7, total: 8 });
    expect(statuses.at(-1)?.error).toContain("ditherer.exportVideo: video tools blocked");
    expect(warn).toHaveBeenCalledOnce();
    cleanup();
  });

  it("reports an error when every registration fails with non-Error reasons", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool: vi.fn(() => {
          throw "blocked";
        }),
      },
    });
    const statuses: WebMCPStatus[] = [];
    const cleanup = setupWebMCP(
      {
        getState: () => ({}) as never,
        getActions: () => ({}) as never,
        getFilterList: () => [],
        getOutputCanvas: () => null,
      },
      { onStatus: (status) => statuses.push(status) },
    );

    await vi.waitFor(() => expect(statuses.at(-1)?.phase).toBe("error"));
    expect(statuses.at(-1)).toMatchObject({ registered: 0, total: 8, api: "document" });
    expect(statuses.at(-1)?.error).toContain("blocked");
    cleanup();
  });

  it("applies complete and partially available presets without inventing missing stages", async () => {
    const harness = await makeHarness();
    const preset = CHAIN_PRESETS.find(
      (candidate) =>
        candidate.filters.length > 1 && candidate.filters.some((entry) => entry.options),
    )!;
    expect(preset).toBeTruthy();
    harness.filterList.splice(
      0,
      harness.filterList.length,
      ...(preset.filters.map((entry) => ({
        displayName: entry.name,
        category: preset.category,
        description: "Preset stage",
        filter: { ...noopFilter, name: entry.name },
      })) as never),
    );

    await expect(harness.execute("applyPreset", { name: preset.name })).resolves.toMatchObject({
      ok: true,
      preset: preset.name,
      filtersApplied: preset.filters.length,
    });
    expect(harness.actions.selectFilter).toHaveBeenCalledOnce();
    expect(harness.actions.chainAdd).toHaveBeenCalledTimes(preset.filters.length - 1);

    harness.actions.chainAdd.mockClear();
    harness.filterList.splice(1, 1);
    await expect(harness.execute("applyPreset", { name: preset.name })).resolves.toMatchObject({
      ok: true,
    });
    expect(harness.actions.chainAdd).toHaveBeenCalledTimes(preset.filters.length - 2);
  });

  it("describes sparse chain metadata and validates malformed extension definitions defensively", async () => {
    const harness = await makeHarness();
    (harness.state as unknown as { chain: unknown[] }).chain = [
      {
        id: "sparse",
        displayName: "Sparse extension",
        enabled: false,
        filter: {
          name: "Sparse extension",
          options: {
            palette: { name: 17, options: null },
            custom: { arbitrary: true },
          },
          optionTypes: {
            palette: { type: "PALETTE" },
            custom: { type: "EXTENSION_CONTROL" },
            rangeWithoutBounds: { type: "RANGE" },
            enumWithoutChoices: { type: "ENUM" },
          },
        },
      },
    ];

    await expect(harness.execute("listFilters")).resolves.toMatchObject({ count: 2 });
    await expect(harness.execute("listPresets")).resolves.toMatchObject({
      count: CHAIN_PRESETS.length,
    });
    const chain = (await harness.execute("getCurrentChain")) as {
      chain: Array<{ enabled: boolean; options: Record<string, unknown> }>;
    };
    expect(chain.chain[0]).toMatchObject({
      enabled: false,
      options: { palette: { name: "unknown", options: {} } },
    });

    await expect(
      harness.execute("setFilterOption", {
        index: 0,
        optionName: "rangeWithoutBounds",
        value: 1,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      harness.execute("setFilterOption", {
        index: 0,
        optionName: "enumWithoutChoices",
        value: "anything",
      }),
    ).rejects.toThrow("must be one of");
    await expect(
      harness.execute("setFilterOption", {
        index: 0,
        optionName: "custom",
        value: { arbitrary: true },
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      harness.execute("setFilterOption", {
        index: 0,
        optionName: "missing",
        value: 1,
      }),
    ).rejects.toThrow("Available options");
  });

  it("uses data-URL filename and MIME fallbacks when callers omit metadata", async () => {
    const harness = await makeHarness();
    await expect(harness.execute("loadMedia", { dataUrl: "data:;base64," })).resolves.toMatchObject(
      {
        ok: true,
        filename: "uploaded-media",
        mimeType: "application/octet-stream",
        sizeBytes: 0,
      },
    );
    expect(harness.actions.loadMediaAsync).toHaveBeenCalledWith(expect.any(File), 0.4, 1.25);
  });

  it("stops asynchronous registration cleanly when disposed mid-flight", async () => {
    let resolveRegistration!: () => void;
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveRegistration = resolve;
            }),
        ),
      },
    });
    const statuses: WebMCPStatus[] = [];
    const cleanup = setupWebMCP(
      {
        getState: () => ({}) as never,
        getActions: () => ({}) as never,
        getFilterList: () => [],
        getOutputCanvas: () => null,
      },
      { onStatus: (status) => statuses.push(status) },
    );

    await vi.waitFor(() => expect(resolveRegistration).toBeTypeOf("function"));
    cleanup();
    resolveRegistration();
    await Promise.resolve();
    await Promise.resolve();
    expect(statuses.at(-1)?.phase).toBe("registering");
  });
});
