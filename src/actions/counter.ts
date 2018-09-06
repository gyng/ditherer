import { createAction } from "typesafe-actions";

import { Dispatch } from "redux";

export const increment = createAction(
  "INCREMENT",
  resolve => (value: number = 1) => resolve({ value })
);

export const decrement = createAction(
  "DECREMENT",
  resolve => (value: number = 1) => resolve({ value })
);

export const incrementAsync = (
  value: number = 1,
  delay: number = 1000
): any => (dispatch: Dispatch<ReturnType<typeof increment>>) => {
  setTimeout(() => dispatch(increment(value)), delay);
};
