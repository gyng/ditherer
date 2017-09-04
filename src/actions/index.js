// @flow
/* eslint-disable import/prefer-default-export */

import * as types from "constants/actionTypes";
import { paletteList } from "palettes";

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
  const output = filter(input, options);
  if (!output) return { type: types.ERROR, message: "Error filtering" };

  const outputImage = new Image();
  outputImage.src = output.toDataURL("image/png");

  outputImage.onload = () => {
    dispatch(filterImage(outputImage));
  };

  return null;
};

export const addPaletteColor = (color: ColorRGBA) => ({
  type: types.ADD_PALETTE_COLOR,
  color
});

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
