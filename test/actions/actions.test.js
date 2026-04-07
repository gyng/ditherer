import { describe, it, expect } from "vitest";

describe("action types", () => {
  it("should create a SET_SCALE action", () => {
    const action = { type: "SET_SCALE", scale: 120 };
    expect(action.type).toEqual("SET_SCALE");
    expect(action.scale).toEqual(120);
  });

  it("should create a SET_GRAYSCALE action", () => {
    const action = { type: "SET_GRAYSCALE", value: true };
    expect(action.type).toEqual("SET_GRAYSCALE");
    expect(action.value).toEqual(true);
  });

  it("should create a FILTER_IMAGE action", () => {
    const action = { type: "FILTER_IMAGE", image: "image" };
    expect(action.type).toEqual("FILTER_IMAGE");
    expect(action.image).toEqual("image");
  });

  it("should create a SET_FILTER_OPTION action", () => {
    const action = {
      type: "SET_FILTER_OPTION",
      optionName: "optionName",
      value: "optionValue",
    };
    expect(action.type).toEqual("SET_FILTER_OPTION");
    expect(action.optionName).toEqual("optionName");
    expect(action.value).toEqual("optionValue");
  });

  it("should pass values through without implicit lookup", () => {
    const paletteValue = { name: "test", getColor: () => {} };
    const action = {
      type: "SET_FILTER_OPTION",
      optionName: "myPalette",
      value: paletteValue,
    };
    expect(action.value).toEqual(paletteValue);
  });

  it("should create a SET_FILTER_PALETTE_OPTION action", () => {
    const action = {
      type: "SET_FILTER_PALETTE_OPTION",
      optionName: "name",
      value: "value",
    };
    expect(action.type).toEqual("SET_FILTER_PALETTE_OPTION");
    expect(action.optionName).toEqual("name");
    expect(action.value).toEqual("value");
  });
});
