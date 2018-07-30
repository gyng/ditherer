import * as actions from "@src/actions";
import { RootAction } from "@src/types";
import { getType } from "typesafe-actions";

export interface ICountersState {
  value: number;
}

export default (
  state: ICountersState = { value: 0 },
  action: RootAction
): ICountersState => {
  switch (action.type) {
    case getType(actions.increment):
      return {
        ...state,
        value: state.value + action.payload.value
      };
    case getType(actions.decrement):
      return {
        ...state,
        value: state.value - action.payload.value
      };
    default:
      return state;
  }
};
