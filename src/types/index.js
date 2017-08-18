// @flow

export type CountersState = { value: number };

export type State = { counters: CountersState };

export type Action =
  | { type: "INCREMENT", value: number }
  | { type: "DECREMENT", value: number };
