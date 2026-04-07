import { describe, it, expect } from "vitest";
import reducer, { initialState } from "reducers/filters";

describe("filters reducer", () => {
  it("should return the initial state", () => {
    const nextState = reducer(undefined, {});
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
    const prevState = { otherStuff: "foo" };
    const nextState = reducer(prevState, {
      type: "SELECT_FILTER",
      name: "name",
      filter: { filter: "someFilterFunc" },
    });
    expect(nextState).toEqual({
      otherStuff: "foo",
      selected: { name: "name", filter: "someFilterFunc" },
    });
  });

  it("should handle SET_FILTER_OPTION", () => {
    const prevState = {
      otherStuff: "foo",
      selected: { filter: { options: { foo: "bar" } } },
    };
    const nextState = reducer(prevState, {
      type: "SET_FILTER_OPTION",
      optionName: "optionName",
      value: "someValue",
    });
    expect(nextState).toEqual({
      otherStuff: "foo",
      selected: { filter: { options: { foo: "bar", optionName: "someValue" } } },
    });
  });

  it("should handle SET_FILTER_PALETTE_OPTION", () => {
    const prevState = {
      otherStuff: "foo",
      selected: { filter: { options: { palette: { options: { foo: "bar" } } } } },
    };
    const nextState = reducer(prevState, {
      type: "SET_FILTER_PALETTE_OPTION",
      optionName: "optionName",
      value: "someValue",
    });
    expect(nextState).toEqual({
      otherStuff: "foo",
      selected: {
        filter: { options: { palette: { options: { foo: "bar", optionName: "someValue" } } } },
      },
    });
  });

  it("should handle ADD_PALETTE_COLOR", () => {
    const prevState = {
      otherStuff: "foo",
      selected: { filter: { options: { palette: { options: { colors: ["bar"] } } } } },
    };
    const nextState = reducer(prevState, { type: "ADD_PALETTE_COLOR", color: "someColour" });
    expect(nextState).toEqual({
      otherStuff: "foo",
      selected: {
        filter: { options: { palette: { options: { colors: ["bar", "someColour"] } } } },
      },
    });
  });

  it("should handle FILTER_IMAGE", () => {
    const prevState = { otherStuff: "foo" };
    const nextState = reducer(prevState, { type: "FILTER_IMAGE", image: "someImage" });
    expect(nextState).toEqual({ otherStuff: "foo", outputImage: "someImage" });
  });
});
