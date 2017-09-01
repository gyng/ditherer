// @flow

import {
  LOAD_IMAGE,
  FILTER_IMAGE,
  SELECT_FILTER,
  SET_GRAYSCALE
} from "constants/actionTypes";

import type { Action, AppState } from "types";

const initialState = {
  selectedFilter: "Floyd-Steinberg",
  convertGrayscale: false,
  inputImage: null,
  outputImage: null
};

export default (state: AppState = initialState, action: Action) => {
  switch (action.type) {
    case LOAD_IMAGE:
      return {
        ...state,
        inputImage: action.image
      };
    case SET_GRAYSCALE:
      return {
        ...state,
        convertGrayscale: action.value
      };
    case SELECT_FILTER:
      return {
        ...state,
        selectedFilter: action.name
      };
    case FILTER_IMAGE:
      return {
        ...state,
        outputImage: action.image
      };
    default:
      return state;
  }
};
