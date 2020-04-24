import * as actions from "@src/actions";
import { RootAction } from "@src/types";
import { getType } from "typesafe-actions";

export interface CountersState {
  value: number;
}

export const counterReducer = (
  state: CountersState = { value: 0 },
  action: RootAction
): CountersState => {
  switch (action.type) {
    case getType(actions.increment):
      return {
        ...state,
        value: state.value + action.payload.value,
      };
    case getType(actions.decrement):
      return {
        ...state,
        value: state.value - action.payload.value,
      };
    default:
      return state;
  }
};
