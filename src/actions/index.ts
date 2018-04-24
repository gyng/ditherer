import {
  ActionTypes,
  DecrementAction,
  IncrementAction,
  State
} from "@src/types";
import { Dispatch } from "redux";

export const increment = (value: number = 1): IncrementAction => ({
  type: ActionTypes.INCREMENT,
  value
});

export const decrement = (value: number = 1): DecrementAction => ({
  type: ActionTypes.DECREMENT,
  value
});

export const incrementAsync = (value: number = 1, delay: number = 1000) => (
  dispatch: Dispatch<IncrementAction, State>
) => setTimeout(() => dispatch(increment(value)), delay);
