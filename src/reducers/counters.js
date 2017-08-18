// @flow

import { INCREMENT, DECREMENT } from "constants/actionTypes";
import type { Action, CountersState } from "types";

export default (state: CountersState = { value: 0 }, action: Action) => {
  switch (action.type) {
    case INCREMENT:
      return {
        ...state,
        value: state.value + action.value
      };
    case DECREMENT:
      return {
        ...state,
        value: state.value - action.value
      };
    default:
      return state;
  }
};
