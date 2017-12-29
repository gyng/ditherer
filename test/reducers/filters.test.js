import reducer, { initialState } from "reducers/filters";
import * as actions from "actions";

describe("filters reducer", () => {
  it("should return the initial state", () => {
    const prevState = {};
    const nextState = reducer(undefined, prevState);
    expect(nextState).to.eql(initialState);
  });

  it("should handle LOAD_IMAGE", () => {
    const prevState = { otherStuff: "foo" };
    const nextState = reducer(prevState, actions.loadImage("testImage"));
    const expected = {
      otherStuff: "foo",
      inputImage: "testImage",
      realtimeFiltering: undefined,
      time: 0,
      video: null
    };
    expect(nextState).to.eql(expected);
  });

  it("should handle SET_GRAYSCALE", () => {
    const prevState = { otherStuff: "foo" };
    const nextState = reducer(prevState, actions.setConvertGrayscale(false));
    const expected = { otherStuff: "foo", convertGrayscale: false };
    expect(nextState).to.eql(expected);
  });

  it("should handle SET_REAL_TIME_FILTERING", () => {
    const prevState = { otherStuff: "foo" };
    const nextState = reducer(prevState, actions.setRealtimeFiltering(true));
    const expected = { otherStuff: "foo", realtimeFiltering: true };
    expect(nextState).to.eql(expected);
  });

  it("should handle SET_INPUT_VOLUME", () => {
    const prevState = { otherStuff: "foo" };
    const nextState = reducer(prevState, actions.setInputVolume(0.5));
    const expected = { otherStuff: "foo", videoVolume: 0.5 };
    expect(nextState).to.eql(expected);
  });

  it("should handle SET_SCALE", () => {
    const prevState = { otherStuff: "foo" };
    const nextState = reducer(prevState, actions.setScale(1234));
    const expected = { otherStuff: "foo", scale: 1234 };
    expect(nextState).to.eql(expected);
  });

  it("should handle SELECT_FILTER", () => {
    const prevState = { otherStuff: "foo" };
    const nextState = reducer(
      prevState,
      actions.selectFilter("name", { filter: "someFilterFunc" })
    );
    const expected = {
      otherStuff: "foo",
      selected: { name: "name", filter: "someFilterFunc" }
    };
    expect(nextState).to.eql(expected);
  });

  it("should handle SET_FILTER_OPTION", () => {
    const prevState = {
      otherStuff: "foo",
      selected: { filter: { options: { foo: "bar" } } }
    };
    const nextState = reducer(
      prevState,
      actions.setFilterOption("optionName", "someValue")
    );
    const expected = {
      otherStuff: "foo",
      selected: { filter: { options: { foo: "bar", optionName: "someValue" } } }
    };
    expect(nextState).to.eql(expected);
  });

  it("should handle SET_FILTER_PALETTE_OPTION", () => {
    const prevState = {
      otherStuff: "foo",
      selected: {
        filter: { options: { palette: { options: { foo: "bar" } } } }
      }
    };
    const nextState = reducer(
      prevState,
      actions.setFilterPaletteOption("optionName", "someValue")
    );
    const expected = {
      otherStuff: "foo",
      selected: {
        filter: {
          options: {
            palette: { options: { foo: "bar", optionName: "someValue" } }
          }
        }
      }
    };
    expect(nextState).to.eql(expected);
  });

  it("should handle ADD_PALETTE_COLOR", () => {
    const prevState = {
      otherStuff: "foo",
      selected: {
        filter: { options: { palette: { options: { colors: ["bar"] } } } }
      }
    };
    const nextState = reducer(prevState, actions.addPaletteColor("someColour"));
    const expected = {
      otherStuff: "foo",
      selected: {
        filter: {
          options: { palette: { options: { colors: ["bar", "someColour"] } } }
        }
      }
    };
    expect(nextState).to.eql(expected);
  });

  it("should handle FILTER_IMAGE", () => {
    const prevState = { otherStuff: "foo" };
    const nextState = reducer(prevState, actions.filterImage("someImage"));
    const expected = {
      otherStuff: "foo",
      outputImage: "someImage"
    };
    expect(nextState).to.eql(expected);
  });
});
