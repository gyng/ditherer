// @flow
/* eslint-disable import/prefer-default-export */

import { INCREMENT, DECREMENT } from '../constants/actionTypes';

export const increment = (value: number = 1) => ({
  type: INCREMENT,
  value,
});

export const decrement = (value: number = 1) => ({
  type: DECREMENT,
  value,
});
