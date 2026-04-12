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
});
