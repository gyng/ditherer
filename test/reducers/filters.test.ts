import { describe, it, expect, vi } from "vitest";
import reducer, { initialState } from "reducers/filters";

describe("filters reducer", () => {
  it("should return the initial state", () => {
    const nextState = reducer(undefined, { type: "__UNKNOWN__" } as never);
    expect(nextState).toEqual(initialState);
  });

  it("should handle LOAD_IMAGE", () => {
    const prevState = { otherStuff: "foo" };
    const nextState = reducer(prevState, {
      type: "LOAD_IMAGE",
      image: "testImage",
      time: 0,
      video: null,
      dispatch: () => {},
    });
    expect(nextState.otherStuff).toEqual("foo");
    expect(nextState.inputImage).toEqual("testImage");
    expect(nextState.time).toEqual(0);
    expect(nextState.video).toEqual(null);
  });

  it("should handle SET_GRAYSCALE", () => {
    const prevState = { otherStuff: "foo" };
    const nextState = reducer(prevState, { type: "SET_GRAYSCALE", value: false });
    expect(nextState).toEqual({ otherStuff: "foo", convertGrayscale: false });
  });

  it("should handle SET_REAL_TIME_FILTERING", () => {
    const prevState = { otherStuff: "foo" };
    const nextState = reducer(prevState, { type: "SET_REAL_TIME_FILTERING", enabled: true });
    expect(nextState).toEqual({ otherStuff: "foo", realtimeFiltering: true });
  });

  it("should handle SET_INPUT_VOLUME", () => {
    const prevState = { otherStuff: "foo" };
    const nextState = reducer(prevState, { type: "SET_INPUT_VOLUME", volume: 0.5 });
    expect(nextState).toEqual({ otherStuff: "foo", videoVolume: 0.5 });
  });

  it("should handle SET_SCALE", () => {
    const prevState = { otherStuff: "foo" };
    const nextState = reducer(prevState, { type: "SET_SCALE", scale: 1234 });
    expect(nextState).toEqual({ otherStuff: "foo", scale: 1234 });
  });

  it("should handle SELECT_FILTER", () => {
    const prevState = { otherStuff: "foo", chain: [], activeIndex: 0 };
    const nextState = reducer(prevState, {
      type: "SELECT_FILTER",
      name: "name",
      filter: { filter: "someFilterFunc" },
    });
    expect(nextState.selected).toEqual({
      displayName: "name",
      name: "name",
      filter: "someFilterFunc",
    });
    expect(nextState.chain).toHaveLength(1);
    expect(nextState.chain[0].displayName).toEqual("name");
    expect(nextState.chain[0].filter).toEqual("someFilterFunc");
  });

  it("should handle SET_FILTER_OPTION", () => {
    const prevState = {
      otherStuff: "foo",
      chain: [{ id: "test", displayName: "Test", filter: { options: { foo: "bar" } }, enabled: true }],
      activeIndex: 0,
    };
    const nextState = reducer(prevState, {
      type: "SET_FILTER_OPTION",
      optionName: "optionName",
      value: "someValue",
    });
    expect(nextState.selected.filter.options).toEqual({ foo: "bar", optionName: "someValue" });
    expect(nextState.chain[0].filter.options).toEqual({ foo: "bar", optionName: "someValue" });
  });

  it("should handle SET_FILTER_PALETTE_OPTION", () => {
    const prevState = {
      otherStuff: "foo",
      chain: [{ id: "test", displayName: "Test", filter: { options: { palette: { name: "nearest", options: { foo: "bar" } } } }, enabled: true }],
      activeIndex: 0,
    };
    const nextState = reducer(prevState, {
      type: "SET_FILTER_PALETTE_OPTION",
      optionName: "optionName",
      value: "someValue",
    });
    expect(nextState.selected.filter.options.palette.options).toEqual({ foo: "bar", optionName: "someValue" });
  });

  it("should handle ADD_PALETTE_COLOR", () => {
    const prevState = {
      otherStuff: "foo",
      chain: [{ id: "test", displayName: "Test", filter: { options: { palette: { name: "nearest", options: { colors: ["bar"] } } } }, enabled: true }],
      activeIndex: 0,
    };
    const nextState = reducer(prevState, { type: "ADD_PALETTE_COLOR", color: "someColour" });
    expect(nextState.selected.filter.options.palette.options.colors).toEqual(["bar", "someColour"]);
  });

  it("ignores palette mutations when palette state is missing a name", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const prevState = {
      ...initialState,
      chain: [{ id: "test", displayName: "Test", filter: { options: { palette: { options: { foo: "bar" } } } }, enabled: true }],
      activeIndex: 0,
      selected: {
        displayName: "Test",
        name: "Test",
        filter: { options: { palette: { options: { foo: "bar" } } } },
      },
    };

    const nextState = reducer(prevState, {
      type: "SET_FILTER_PALETTE_OPTION",
      optionName: "optionName",
      value: "someValue",
    });

    expect(nextState).toBe(prevState);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("should handle FILTER_IMAGE", () => {
    const prevState = { otherStuff: "foo" };
    const nextState = reducer(prevState, { type: "FILTER_IMAGE", image: "someImage" });
    expect(nextState).toMatchObject({ otherStuff: "foo", outputImage: "someImage" });
  });

  it("should keep selected in sync when reordering the active chain entry", () => {
    const prevState = {
      ...initialState,
      chain: [
        { id: "first", displayName: "First", filter: { name: "first" }, enabled: true },
        { id: "second", displayName: "Second", filter: { name: "second" }, enabled: true },
      ],
      activeIndex: 0,
      selected: {
        displayName: "First",
        name: "First",
        filter: { name: "first" },
      },
    };

    const nextState = reducer(prevState, {
      type: "CHAIN_REORDER",
      fromIndex: 0,
      toIndex: 1,
    });

    expect(nextState.activeIndex).toBe(1);
    expect(nextState.chain.map(entry => entry.id)).toEqual(["second", "first"]);
    expect(nextState.selected.displayName).toBe("First");
    expect(nextState.selected.filter).toEqual({ name: "first" });
  });

  it("should duplicate the selected chain entry and focus the clone", () => {
    const originalFilter = { name: "original", options: { strength: 3 } };
    const prevState = {
      ...initialState,
      chain: [
        { id: "original-id", displayName: "Original", filter: originalFilter, enabled: true },
      ],
      activeIndex: 0,
      selected: {
        displayName: "Original",
        name: "Original",
        filter: originalFilter,
      },
    };

    const nextState = reducer(prevState, {
      type: "CHAIN_DUPLICATE",
      id: "original-id",
    });

    expect(nextState.chain).toHaveLength(2);
    expect(nextState.activeIndex).toBe(1);
    expect(nextState.selected.displayName).toBe("Original");
    expect(nextState.chain[1].id).not.toBe("original-id");
    expect(nextState.chain[1].filter.options).toEqual({ strength: 3 });
    expect(nextState.chain[1].filter.options).not.toBe(nextState.chain[0].filter.options);
  });

  it("CHAIN_REMOVE refuses to drop the last entry and clamps activeIndex otherwise", () => {
    const singleton = {
      ...initialState,
      chain: [{ id: "only", displayName: "Only", filter: { name: "only" }, enabled: true }],
      activeIndex: 0,
    };
    expect(reducer(singleton, { type: "CHAIN_REMOVE", id: "only" })).toBe(singleton);

    const pair = {
      ...initialState,
      chain: [
        { id: "a", displayName: "A", filter: { name: "a" }, enabled: true },
        { id: "b", displayName: "B", filter: { name: "b" }, enabled: true },
      ],
      activeIndex: 1,
    };
    const removed = reducer(pair, { type: "CHAIN_REMOVE", id: "b" });
    expect(removed.chain.map((e: { id: string }) => e.id)).toEqual(["a"]);
    expect(removed.activeIndex).toBe(0);
  });

  it("CHAIN_REMOVE ignores unknown ids", () => {
    const state = {
      ...initialState,
      chain: [
        { id: "a", displayName: "A", filter: { name: "a" }, enabled: true },
        { id: "b", displayName: "B", filter: { name: "b" }, enabled: true },
      ],
      activeIndex: 0,
    };
    expect(reducer(state, { type: "CHAIN_REMOVE", id: "nope" })).toBe(state);
  });

  it("CHAIN_REORDER is a no-op for out-of-range or identical indices", () => {
    const state = {
      ...initialState,
      chain: [
        { id: "a", displayName: "A", filter: { name: "a" }, enabled: true },
        { id: "b", displayName: "B", filter: { name: "b" }, enabled: true },
      ],
      activeIndex: 0,
    };
    expect(reducer(state, { type: "CHAIN_REORDER", fromIndex: 0, toIndex: 0 })).toBe(state);
    expect(reducer(state, { type: "CHAIN_REORDER", fromIndex: -1, toIndex: 0 })).toBe(state);
    expect(reducer(state, { type: "CHAIN_REORDER", fromIndex: 0, toIndex: 99 })).toBe(state);
  });

  it("CHAIN_SET_ACTIVE clamps index into chain bounds", () => {
    const state = {
      ...initialState,
      chain: [
        { id: "a", displayName: "A", filter: { name: "a" }, enabled: true },
        { id: "b", displayName: "B", filter: { name: "b" }, enabled: true },
      ],
      activeIndex: 0,
    };
    expect(reducer(state, { type: "CHAIN_SET_ACTIVE", index: 5 }).activeIndex).toBe(1);
    expect(reducer(state, { type: "CHAIN_SET_ACTIVE", index: -3 }).activeIndex).toBe(0);
  });

  it("CHAIN_TOGGLE flips the enabled flag on the matching entry only", () => {
    const state = {
      ...initialState,
      chain: [
        { id: "a", displayName: "A", filter: { name: "a" }, enabled: true },
        { id: "b", displayName: "B", filter: { name: "b" }, enabled: true },
      ],
      activeIndex: 0,
    };
    const next = reducer(state, { type: "CHAIN_TOGGLE", id: "b" });
    expect(next.chain[0].enabled).toBe(true);
    expect(next.chain[1].enabled).toBe(false);
  });

  it("CHAIN_REPLACE swaps filter + displayName in place", () => {
    const state = {
      ...initialState,
      chain: [
        { id: "a", displayName: "A", filter: { name: "a" }, enabled: true },
      ],
      activeIndex: 0,
    };
    const next = reducer(state, {
      type: "CHAIN_REPLACE",
      id: "a",
      displayName: "Replaced",
      filter: { name: "replaced" },
    });
    expect(next.chain[0].displayName).toBe("Replaced");
    expect(next.chain[0].filter.name).toBe("replaced");
  });

  it("CHAIN_REPLACE on an unknown id is a no-op", () => {
    const state = {
      ...initialState,
      chain: [{ id: "a", displayName: "A", filter: { name: "a" }, enabled: true }],
      activeIndex: 0,
    };
    expect(reducer(state, {
      type: "CHAIN_REPLACE",
      id: "nope",
      displayName: "x",
      filter: { name: "x" },
    })).toBe(state);
  });

  it("SET_CHAIN_AUDIO_MODULATION writes the modulation onto the matching entry", () => {
    const state = {
      ...initialState,
      chain: [
        { id: "a", displayName: "A", filter: { name: "a" }, enabled: true, audioMod: null },
      ],
      activeIndex: 0,
    };
    const modulation = { connections: [{ metric: "beat", target: "amount", weight: 0.5 }], normalizedMetrics: [] };
    const next = reducer(state, {
      type: "SET_CHAIN_AUDIO_MODULATION",
      id: "a",
      modulation,
    });
    expect(next.chain[0].audioMod).toEqual(modulation);
  });

  it("SET_LINEARIZE / SET_WASM_ACCELERATION / SET_SCALE / SET_OUTPUT_SCALE / SET_RANDOM_CYCLE_SECONDS are plain setters", () => {
    let state = reducer({ ...initialState }, { type: "SET_LINEARIZE", value: true });
    expect(state.linearize).toBe(true);
    state = reducer(state, { type: "SET_WASM_ACCELERATION", value: false });
    expect(state.wasmAcceleration).toBe(false);
    state = reducer(state, { type: "SET_SCALE", scale: 2.5 });
    expect(state.scale).toBe(2.5);
    state = reducer(state, { type: "SET_OUTPUT_SCALE", scale: 3 });
    expect(state.outputScale).toBe(3);
    state = reducer(state, { type: "SET_RANDOM_CYCLE_SECONDS", seconds: 12 });
    expect(state.randomCycleSeconds).toBe(12);
  });
});
