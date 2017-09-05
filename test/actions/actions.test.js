import * as actions from "actions";
import * as types from "constants/actionTypes";

import { paletteList } from "palettes";

describe("actions", () => {
  it("should create an action to load an Image", () => {
    const action = actions.loadImage("image");
    expect(action.type).to.equal(types.LOAD_IMAGE);
    expect(action.image).to.equal("image");
  });

  it("should create an action to set the preconvert grayscale setting", () => {
    const action = actions.setConvertGrayscale(true);
    expect(action.type).to.equal(types.SET_GRAYSCALE);
    expect(action.value).to.equal(true);
  });

  it("should create an action to select a filter", () => {
    const action = actions.selectFilter("name", "someFilter");
    expect(action.type).to.equal(types.SELECT_FILTER);
    expect(action.filter).to.equal("someFilter");
  });

  it("should create an action to filter an image", () => {
    const action = actions.filterImage("image");
    expect(action.type).to.equal(types.FILTER_IMAGE);
    expect(action.image).to.equal("image");
  });

  it("should create an action to add a colour to the palette", () => {
    const action = actions.addPaletteColor("pink");
    expect(action.type).to.equal(types.ADD_PALETTE_COLOR);
    expect(action.color).to.equal("pink");
  });

  it("should create an action to set a filter option", () => {
    const action = actions.setFilterOption("optionName", "optionValue");
    expect(action.type).to.equal(types.SET_FILTER_OPTION);
    expect(action.optionName).to.equal("optionName");
    expect(action.value).to.equal("optionValue");
  });

  // This action is fishy: why is it finding by name? Potential to unintentionally
  // overwrite legit values here.
  xit("should create an action to set a palette for a filter", () => {
    const action = actions.setFilterOption("myPalette", paletteList[0].palette);
    expect(action.type).to.equal(types.SET_FILTER_OPTION);
    expect(action.optionName).to.equal("myPalette");
    expect(action.value).to.equal(paletteList[0].palette);
  });

  it("should create an action to set a palette option", () => {
    const action = actions.setFilterPaletteOption("name", "value");
    expect(action.type).to.equal(types.SET_FILTER_PALETTE_OPTION);
    expect(action.optionName).to.equal("name");
    expect(action.value).to.equal("value");
  });

  it("should create an action to set the scale", () => {
    const action = actions.setScale(120);
    expect(action.type).to.equal(types.SET_SCALE);
    expect(action.scale).to.equal(120);
  });
});
