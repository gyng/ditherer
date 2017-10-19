import { Action, ActionTypes, CountersState } from "@src/types";

export default (state: CountersState = { value: 0 }, action: Action) => {
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
