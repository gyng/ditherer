// @flow
/* eslint-disable import/prefer-default-export */

import * as types from "constants/actionTypes";

export const increment = (value: number = 1) => ({
  type: types.INCREMENT,
  value
});

export const decrement = (value: number = 1) => ({
  type: types.DECREMENT,
  value
});

export const incrementAsync = (value: number = 1, delay: number = 1000) => (
  dispatch: Dispatch
) => setTimeout(() => dispatch(increment(value)), delay);
