import {
  createAction,
  createReducer,
  createAsyncThunk,
} from "@reduxjs/toolkit";
import { RootDispatch } from "@src/types";

export const actions = {
  increment: createAction<number>("counter/increment"),
  // custom payload
  decrement: createAction("counter/decrement", (value = 1): {
    payload: { value: number };
  } => ({
    payload: { value },
  })),
  fetchCode: createAsyncThunk("counter/fetchCode", async (url: string) => {
    const response = await fetch(url);
    const status = await response.status;
    if (status < 400) {
      return status;
    } else {
      throw status;
    }
  }),
  // This is a *CUSTOM* async action that does *not* return a Promise
  // ie. this action is not thenable (cannot be chained).
  incrementAsync: (value = 1, delay = 1000) => (dispatch: RootDispatch) => {
    setTimeout(() => {
      dispatch(actions.increment(value));
    }, delay);
  },
};

export interface CountersState {
  value: number;
}

export const reducer = createReducer({ value: 0 }, (builder) =>
  builder
    .addCase(actions.increment, (state, action) => {
      return { value: state.value + action.payload };
    })
    .addCase(actions.decrement, (state, action) => {
      return { value: state.value - action.payload.value };
    })
);

export const selectors = {
  count: (state: CountersState): number => state.value,
};

export const counterDuck = {
  key: "counter",
  actions,
  reducer,
  selectors,
};
