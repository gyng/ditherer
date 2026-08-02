import { afterEach, describe, expect, it, vi } from "vitest";
import reducer, { initialState, MAX_CHAIN_LENGTH, type ChainEntry } from "reducers/filters";
import { filterIndex } from "@gyng/ditherer-filters";
import { SCALING_ALGORITHM } from "constants/optionTypes";

const entry = (id: string, overrides: Partial<ChainEntry> = {}): ChainEntry => ({
  id,
  displayName: id,
  filter: { ...filterIndex.Invert, options: { ...filterIndex.Invert.options } },
  enabled: true,
  audioMod: null,
  ...overrides,
});

afterEach(() => vi.restoreAllMocks());

describe("filters reducer boundary decisions", () => {
  it("rejects a seventeenth chain stage and tracks the active entry across crossing reorders", () => {
    const chain = Array.from({ length: MAX_CHAIN_LENGTH }, (_, index) => entry(String(index)));
    const full = { ...initialState, chain, activeIndex: 8, selected: initialState.selected };
    expect(
      reducer(full, { type: "CHAIN_ADD", displayName: "extra", filter: filterIndex.Invert }),
    ).toBe(full);
    expect(reducer(full, { type: "CHAIN_DUPLICATE", id: "0" })).toBe(full);

    const movedBeforeActive = reducer(full, { type: "CHAIN_REORDER", fromIndex: 2, toIndex: 10 });
    expect(movedBeforeActive.activeIndex).toBe(7);
    const movedAfterActive = reducer(full, { type: "CHAIN_REORDER", fromIndex: 12, toIndex: 4 });
    expect(movedAfterActive.activeIndex).toBe(9);
  });

  it("caps imported chains by recognized entries without letting unknown filters consume capacity", () => {
    const recognized = Array.from({ length: MAX_CHAIN_LENGTH + 2 }, (_, index) => ({
      n: "Invert",
      d: `known-${index}`,
    }));
    const loaded = reducer(initialState, {
      type: "LOAD_STATE",
      data: {
        v: 2,
        chain: [
          { n: "missing-before" },
          ...recognized.slice(0, 8),
          { n: "missing-middle" },
          ...recognized.slice(8),
        ],
      },
    } as never);

    expect(loaded.chain).toHaveLength(MAX_CHAIN_LENGTH);
    expect(loaded.chain.map((item) => item.displayName)).toEqual(
      recognized.slice(0, MAX_CHAIN_LENGTH).map((item) => item.d),
    );
    expect(loaded.activeIndex).toBe(0);
    expect(loaded.selected.filter).toBe(loaded.chain[0].filter);
  });

  it("rejects non-object state and skips malformed v2 entries without corrupting boolean flags", () => {
    const prior = {
      ...initialState,
      convertGrayscale: true,
      linearize: false,
      wasmAcceleration: false,
    };
    expect(reducer(prior, { type: "LOAD_STATE", data: null } as never)).toBe(prior);
    expect(reducer(prior, { type: "LOAD_STATE", data: 2 } as never)).toBe(prior);

    const loaded = reducer(prior, {
      type: "LOAD_STATE",
      data: {
        v: 2,
        chain: [null, 7, { n: "Invert" }],
        g: "invalid",
        l: null,
        w: {},
      },
    } as never);
    expect(loaded.chain).toHaveLength(1);
    expect(loaded.chain[0].displayName).toBe("Invert");
    expect(loaded).toMatchObject({
      convertGrayscale: true,
      linearize: false,
      wasmAcceleration: false,
    });
  });

  it("keeps current boolean flags when a v1 payload omits or malforms them", () => {
    const prior = {
      ...initialState,
      convertGrayscale: true,
      linearize: false,
      wasmAcceleration: false,
    };
    const loaded = reducer(prior, {
      type: "LOAD_STATE",
      data: {
        selected: { filter: { name: "Invert" } },
        convertGrayscale: undefined,
        linearize: "invalid",
        wasmAcceleration: null,
      },
    } as never);
    expect(loaded).toMatchObject({
      convertGrayscale: true,
      linearize: false,
      wasmAcceleration: false,
    });
  });

  it("preserves the logical active entry when removing an earlier stage and clamps active removal", () => {
    const chain = [entry("a"), entry("b"), entry("c"), entry("d")];
    const editingC = { ...initialState, chain, activeIndex: 2, selected: initialState.selected };

    const removedBefore = reducer(editingC, { type: "CHAIN_REMOVE", id: "a" });
    expect(removedBefore.activeIndex).toBe(1);
    expect(removedBefore.chain[removedBefore.activeIndex].id).toBe("c");

    const removedActive = reducer(editingC, { type: "CHAIN_REMOVE", id: "c" });
    expect(removedActive.activeIndex).toBe(2);
    expect(removedActive.chain[removedActive.activeIndex].id).toBe("d");

    const editingLast = { ...editingC, activeIndex: 3 };
    const removedLast = reducer(editingLast, { type: "CHAIN_REMOVE", id: "d" });
    expect(removedLast.activeIndex).toBe(2);
    expect(removedLast.chain[removedLast.activeIndex].id).toBe("c");
  });

  it("deep-copies optional audio modulation and handles absent option maps", () => {
    const source = entry("audio", {
      filter: { ...filterIndex.Invert, options: undefined },
      audioMod: {
        connections: [{ metric: "beat", target: "amount", weight: 0.5 }],
      },
    });
    const state = {
      ...initialState,
      chain: [source],
      activeIndex: 0,
      selected: initialState.selected,
    };
    const duplicated = reducer(state, { type: "CHAIN_DUPLICATE", id: "audio" });
    expect(duplicated.chain[1].filter.options).toEqual({});
    expect(duplicated.chain[1].audioMod?.connections).toEqual(source.audioMod?.connections);
    expect(duplicated.chain[1].audioMod).not.toBe(source.audioMod);
    expect(duplicated.chain[1].audioMod?.normalizedMetrics).toEqual([]);
    expect(reducer(state, { type: "CHAIN_DUPLICATE", id: "missing" })).toBe(state);
  });

  it("updates a non-active stage and initializes absent palette color arrays", () => {
    const palette = { name: "custom", options: {} };
    const chain = [
      entry("a"),
      entry("b", {
        filter: { ...filterIndex.Ordered, options: { palette } },
      }),
    ];
    const state = { ...initialState, chain, activeIndex: 0, selected: initialState.selected };

    const option = reducer(state, {
      type: "SET_FILTER_OPTION",
      optionName: "amount",
      value: 0.25,
      chainIndex: 1,
    });
    expect(option.chain[0].filter.options?.amount).toBeUndefined();
    expect(option.chain[1].filter.options?.amount).toBe(0.25);

    const color = reducer(state, {
      type: "ADD_PALETTE_COLOR",
      color: [1, 2, 3],
      chainIndex: 1,
    });
    expect((color.chain[1].filter.options?.palette as typeof palette).options).toEqual({
      colors: [[1, 2, 3]],
    });
  });

  it("validates malformed audio-mod formats without rejecting the surrounding chain", () => {
    const loaded = reducer(initialState, {
      type: "LOAD_STATE",
      data: {
        v: 2,
        chain: [
          { n: "Invert", m: { c: [{ k: null, o: "amount", w: 1 }] } },
          { n: "Invert", m: { m: [{ k: "beat", o: null, w: 1 }] } },
          { n: "Invert", m: { k: "beat", t: [{ o: null, w: 1 }] } },
          { n: "Invert", m: null },
        ],
      },
    } as never);
    expect(loaded.chain).toHaveLength(4);
    expect(loaded.chain.every((item) => item.audioMod === null)).toBe(true);
  });

  it("uses state fallbacks for omitted v2 flags and unresolved palette references", () => {
    const prior = {
      ...initialState,
      convertGrayscale: true,
      linearize: false,
      wasmAcceleration: false,
    };
    const loaded = reducer(prior, {
      type: "LOAD_STATE",
      data: {
        v: 2,
        chain: [{ n: "Ordered", o: { palette: { name: "not-installed" } } }],
      },
    } as never);
    expect(loaded).toMatchObject({
      convertGrayscale: true,
      linearize: false,
      wasmAcceleration: false,
    });
    expect((loaded.chain[0].filter.options?.palette as { name: string }).name).toBe("nearest");
  });

  it("redraws a scaled canvas with the requested smoothing mode", () => {
    const drawImage = vi.fn();
    const context = { imageSmoothingEnabled: false, drawImage };
    const canvas = { getContext: vi.fn(() => context) } as unknown as HTMLCanvasElement;
    const image = { width: 20, height: 10 } as CanvasImageSource & {
      width: number;
      height: number;
    };
    const state = { ...initialState, inputCanvas: canvas, inputImage: image, scale: 0 };

    const auto = reducer(state, {
      type: "SET_SCALING_ALGORITHM",
      algorithm: SCALING_ALGORITHM.AUTO,
    });
    expect(context.imageSmoothingEnabled).toBe(true);
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 20, 10);
    expect(auto.scalingAlgorithm).toBe(SCALING_ALGORITHM.AUTO);

    context.imageSmoothingEnabled = true;
    reducer(state, { type: "SET_SCALING_ALGORITHM", algorithm: SCALING_ALGORITHM.PIXELATED });
    expect(context.imageSmoothingEnabled).toBe(false);
    expect(
      reducer(
        { ...state, inputCanvas: null },
        {
          type: "SET_SCALING_ALGORITHM",
          algorithm: SCALING_ALGORITHM.AUTO,
        },
      ).scalingAlgorithm,
    ).toBe(SCALING_ALGORITHM.AUTO);
  });

  it("updates live video controls and fully disposes a replaced object-URL video", () => {
    const pause = vi.fn();
    const removeAttribute = vi.fn();
    const load = vi.fn();
    const video = {
      volume: 1,
      muted: false,
      playbackRate: 1,
      pause,
      removeAttribute,
      load,
      srcObject: {} as MediaStream,
      __objectUrl: "blob:test",
      onplaying: vi.fn(),
      onpause: vi.fn(),
      onloadedmetadata: vi.fn(),
      onloadeddata: vi.fn(),
      onseeked: vi.fn(),
      onerror: vi.fn(),
    } as unknown as HTMLVideoElement & { __objectUrl?: string };
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    let state = { ...initialState, video };

    state = reducer(state, { type: "SET_INPUT_VOLUME", volume: 0 }) as typeof state;
    expect(video).toMatchObject({ volume: 0, muted: true });
    state = reducer(state, { type: "SET_INPUT_PLAYBACK_RATE", rate: 1.5 }) as typeof state;
    expect(video.playbackRate).toBe(1.5);

    const next = reducer(state, {
      type: "LOAD_IMAGE",
      image: { width: 2, height: 2 } as never,
      time: null,
      video: null,
      frameToken: 0,
    });
    expect(pause).toHaveBeenCalledOnce();
    expect(removeAttribute).toHaveBeenCalledWith("src");
    expect(video.srcObject).toBeNull();
    expect(load).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:test");
    expect(next).toMatchObject({ time: 0, inputFrameToken: 0, video: null });
  });

  it("preserves optional render telemetry and persists both acceleration states", () => {
    const output = document.createElement("canvas");
    const state = {
      ...initialState,
      outputFrameToken: 4,
      outputTime: 2,
      frameTime: 9,
      stepTimes: [],
    };
    const filtered = reducer(state, { type: "FILTER_IMAGE", image: output });
    expect(filtered).toMatchObject({
      outputFrameToken: 4,
      outputTime: 2,
      frameTime: 9,
      stepTimes: [],
    });

    expect(reducer(state, { type: "SET_WEBGL_ACCELERATION", value: false }).webglAcceleration).toBe(
      false,
    );
    expect(localStorage.getItem("ditherer-webgl-accel")).toBe("0");
    expect(reducer(state, { type: "SET_WEBGL_ACCELERATION", value: true }).webglAcceleration).toBe(
      true,
    );
    expect(localStorage.getItem("ditherer-webgl-accel")).toBe("1");
  });
});
