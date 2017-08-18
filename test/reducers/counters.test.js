import reducer from "reducers/counters";
import { increment, decrement } from "actions";

describe("counter reducer", () => {
  it("should return the initial state", () => {
    const prevState = {};
    const nextState = reducer(undefined, prevState);
    const expected = { value: 0 };
    expect(nextState).to.eql(expected);
  });

  it("should handle INCREMENT", () => {
    const prevState = { value: 0 };
    const nextState = reducer(prevState, increment());
    const expected = { value: 1 };
    expect(nextState).to.eql(expected);
  });

  it("should handle DECREMENT", () => {
    const prevState = { value: 0 };
    const nextState = reducer(prevState, decrement());
    const expected = { value: -1 };
    expect(nextState).to.eql(expected);
  });
});
