import { decrement, increment } from "@src/actions";
import reducer from "@src/reducers/counters";
import { expect } from "chai";

describe("counter reducer", () => {
  it("should handle INCREMENT", () => {
    const prevState = { value: 0 };
    const nextState = reducer(prevState, increment(2));
    const expected = { value: 2 };
    expect(nextState).to.eql(expected);
  });

  it("should handle DECREMENT", () => {
    const prevState = { value: 0 };
    const nextState = reducer(prevState, decrement(2));
    const expected = { value: -2 };
    expect(nextState).to.eql(expected);
  });
});
