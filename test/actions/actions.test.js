import { describe, it, expect } from "vitest";
import * as types from "constants/actionTypes";

describe("actions", () => {
  it("should create an action to set the scale", () => {
    const action = { type: types.SET_SCALE, scale: 120 };
    expect(action.type).toEqual(types.SET_SCALE);
    expect(action.scale).toEqual(120);
  });

  it("should create an action to set the preconvert grayscale setting", () => {
    const action = { type: types.SET_GRAYSCALE, value: true };
    expect(action.type).toEqual(types.SET_GRAYSCALE);
    expect(action.value).toEqual(true);
  });

  it("should create an action to filter an image", () => {
    const action = { type: types.FILTER_IMAGE, image: "image" };
    expect(action.type).toEqual(types.FILTER_IMAGE);
    expect(action.image).toEqual("image");
  });

  it("should create an action to set a filter option", () => {
    const action = {
      type: types.SET_FILTER_OPTION,
      optionName: "optionName",
      value: "optionValue",
    };
    expect(action.type).toEqual(types.SET_FILTER_OPTION);
    expect(action.optionName).toEqual("optionName");
    expect(action.value).toEqual("optionValue");
  });

  it("should pass values through without implicit lookup", () => {
    const paletteValue = { name: "test", getColor: () => {} };
    const action = {
      type: types.SET_FILTER_OPTION,
      optionName: "myPalette",
      value: paletteValue,
    };
    expect(action.type).toEqual(types.SET_FILTER_OPTION);
    expect(action.optionName).toEqual("myPalette");
    expect(action.value).toEqual(paletteValue);
  });

  it("should create an action to set a palette option", () => {
    const action = {
      type: types.SET_FILTER_PALETTE_OPTION,
      optionName: "name",
      value: "value",
    };
    expect(action.type).toEqual(types.SET_FILTER_PALETTE_OPTION);
    expect(action.optionName).toEqual("name");
    expect(action.value).toEqual("value");
  });
});
