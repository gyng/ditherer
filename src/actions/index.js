// @flow
/* eslint-disable import/prefer-default-export */

import * as types from "constants/actionTypes";
import * as optionTypes from "constants/optionTypes";
import { paletteList } from "palettes";
import { THEMES } from "palettes/user";

import type { ColorRGBA, Filter, FilterFunc } from "types";

export const loadImage = (image: HTMLImageElement) => ({
  type: types.LOAD_IMAGE,
  image
});

export const loadImageAsync = (file: Blob) => (dispatch: Dispatch) => {
  const reader = new FileReader();
  const image = new Image();

  reader.onload = event => {
    image.onload = () => {
      dispatch(loadImage(image));
    };
    image.src = event.target.result;
  };

  reader.readAsDataURL(file);
};

export const loadImageURLAsync = (url: string) => (dispatch: Dispatch) => {
  try {
    const image = new Image();
    image.onload = () => {
      dispatch(loadImage(image));
    };
    image.src = url;
  } catch (e) {
    console.error(e);
  }
};

export const setConvertGrayscale = (value: boolean) => ({
  type: types.SET_GRAYSCALE,
  value
});

export const selectFilter = (name: string, filter: Filter) => ({
  type: types.SELECT_FILTER,
  name,
  filter
});

export const filterImage = (image: HTMLImageElement) => ({
  type: types.FILTER_IMAGE,
  image
});

export const filterImageAsync = (
  input: HTMLCanvasElement,
  filter: FilterFunc,
  options: ?any
) => (dispatch: Dispatch) => {
  const output = filter(input, options, dispatch);
  if (!output) return { type: types.ERROR, message: "Error filtering" };

  if (output instanceof HTMLCanvasElement) {
    const outputImage = new Image();
    outputImage.src = output.toDataURL("image/png");

    outputImage.onload = () => {
      dispatch(filterImage(outputImage));
    };
  }

  return null;
};

export const addPaletteColor = (color: ColorRGBA) => ({
  type: types.ADD_PALETTE_COLOR,
  color
});

// FIXME: Why is it finding by name here? Fishy, potential problem when value is a valid palette name
export const setFilterOption = (optionName: string, value: any) => {
  const paletteObject = paletteList.find(p => p.name === value);

  return {
    type: types.SET_FILTER_OPTION,
    optionName,
    value: paletteObject ? paletteObject.palette : value
  };
};

export const setFilterPaletteOption = (optionName: string, value: any) => ({
  type: types.SET_FILTER_PALETTE_OPTION,
  optionName,
  value
});

export const setScale = (scale: number) => ({
  type: types.SET_SCALE,
  scale
});

export const saveCurrentColorPalette = (
  name: string,
  colors: Array<ColorRGBA>
) => {
  window.localStorage.setItem(
    `_palette_${name.replace(" ", "")}`,
    JSON.stringify({ type: optionTypes.PALETTE, name, colors })
  );

  THEMES[name] = colors;

  return {
    type: types.SAVE_CURRENT_COLOR_PALETTE,
    name
  };
};

export const deleteCurrentColorPalette = (name: string) => {
  window.localStorage.removeItem(`_palette_${name.replace(" ", "")}`);
  delete THEMES[name];

  return {
    type: types.DELETE_CURRENT_COLOR_PALETTE,
    name
  };
};
