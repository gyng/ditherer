import React from "react";
import { shallow } from "enzyme";
import Counter from "components/Counter";

describe("Counter", () => {
  let render;

  before(() => {
    render = shallow(
      <Counter
        value={0}
        onIncrementClick={() => {}}
        onDecrementClick={() => {}}
      />
    );
  });

  it("renders the value", () => {
    const valueEl = render.find("div .value");
    expect(valueEl.text()).to.equal("0");
  });

  it("renders the increment buttons", () => {
    const incrementEl = render.find("button .increment");
    expect(incrementEl).to.have.length(2);
  });

  it("renders the decrement button", () => {
    const decrementEl = render.find("button .decrement");
    expect(decrementEl).to.have.length(1);
  });
});
