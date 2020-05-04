import { reducer, actions } from "../counter.duck";

describe("counter reducer", () => {
  it("should handle INCREMENT", () => {
    const prevState = { value: 0 };
    const nextState = reducer(prevState, actions.increment(2));
    const expected = { value: 2 };
    expect(nextState).toEqual(expected);
  });

  it("should handle DECREMENT", () => {
    const prevState = { value: 0 };
    const nextState = reducer(prevState, actions.decrement(2));
    const expected = { value: -2 };
    expect(nextState).toEqual(expected);
  });
});
