import { ActionTypes, IncrementAction } from "@src/types";
import { Dispatch } from "redux";

export const increment = (value: number = 1) => ({
  type: ActionTypes.INCREMENT,
  value
});

export const decrement = (value: number = 1) => ({
  type: ActionTypes.DECREMENT,
  value
});

export const incrementAsync = (value: number = 1, delay: number = 1000) => (
  dispatch: Dispatch<IncrementAction>
) => setTimeout(() => dispatch(increment(value)), delay);
