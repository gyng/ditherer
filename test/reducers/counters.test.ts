import { decrement, increment } from "@src/actions";
import { counterReducer as reducer } from "@src/reducers/counters";

describe("counter reducer", () => {
  it("should handle INCREMENT", () => {
    const prevState = { value: 0 };
    const nextState = reducer(prevState, increment(2));
    const expected = { value: 2 };
    expect(nextState).toEqual(expected);
  });

  it("should handle DECREMENT", () => {
    const prevState = { value: 0 };
    const nextState = reducer(prevState, decrement(2));
    const expected = { value: -2 };
    expect(nextState).toEqual(expected);
  });
});
