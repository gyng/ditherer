import { Action, ActionTypes, ICountersState } from "@src/types";

export default (state: ICountersState = { value: 0 }, action: Action) => {
  switch (action.type) {
    case ActionTypes.INCREMENT:
      return {
        ...state,
        value: state.value + action.value
      };
    case ActionTypes.DECREMENT:
      return {
        ...state,
        value: state.value - action.value
      };
    default:
      return state;
  }
};
