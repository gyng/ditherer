// @flow

import { LOAD_IMAGE, FILTER_IMAGE } from "constants/actionTypes";
import type { Action, CountersState } from "types";

export default (state: CountersState = { value: 0 }, action: Action) => {
  switch (action.type) {
    case LOAD_IMAGE:
      return {
        ...state,
        inputImage: action.image
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
