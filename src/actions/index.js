// @flow
/* eslint-disable import/prefer-default-export */

import * as types from "constants/actionTypes";

import type { Filter } from "types";

export const increment = (value: number = 1) => ({
  type: types.INCREMENT,
  value
});

export const decrement = (value: number = 1) => ({
  type: types.DECREMENT,
  value
});

export const incrementAsync = (value: number = 1, delay: number = 1000) => (
  dispatch: Dispatch
) => setTimeout(() => dispatch(increment(value)), delay);

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
  filter: Filter,
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
