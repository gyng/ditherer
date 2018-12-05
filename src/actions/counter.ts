import { createAction } from "typesafe-actions";

import { RootThunk, RootThunkPromise } from "@src/types";

export const increment = createAction(
  "INCREMENT",
  resolve => (value: number = 1) => resolve({ value })
);

export const decrement = createAction(
  "DECREMENT",
  resolve => (value: number = 1) => resolve({ value })
);

// This is an async action that does *not* return a Promise
// ie. this action is not chainable.
// Use RootThunk for these types of actions.
export const incrementAsync = (
  value: number = 1,
  delay: number = 1000
): RootThunk => dispatch => {
  setTimeout(() => dispatch(increment(value)), delay);
};

// This is an async action that returns a Promise.
// Increase by HTTP status, and return the status in a Promise
// for downstream consumers of this Promise.
// Note that in this example we dispatch *and* then return a Promise.
//
// Define the return type of the Promise in RootThunkPromise.
// See the JSDoc for RootThunkPromise for more details.
export const incrementAsyncPromise = (
  url: string
): RootThunkPromise<number> => dispatch => {
  return fetch(url).then(res => {
    dispatch(increment(res.status));
    return res.status;
  });
};
