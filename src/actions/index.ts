import {
  Action,
  ActionTypes,
  IDecrementAction,
  IIncrementAction,
  IState
} from "@src/types";
import { Dispatch } from "redux";
import { ThunkAction } from "redux-thunk";

export const increment = (value: number = 1): IIncrementAction => ({
  type: ActionTypes.INCREMENT,
  value
});

export const decrement = (value: number = 1): IDecrementAction => ({
  type: ActionTypes.DECREMENT,
  value
});

export const incrementAsync = (
  value: number = 1,
  delay: number = 1000
): any => (dispatch: Dispatch<IIncrementAction>) => {
  setTimeout(() => dispatch(increment(value)), delay);
};
