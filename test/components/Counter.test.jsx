import React from "react";
import Enzyme, { shallow } from "enzyme";
import Adapter from "enzyme-adapter-react-16";
import Counter from "components/Counter";

Enzyme.configure({ adapter: new Adapter() });

describe("Counter", () => {
  let render;

  before(() => {
    render = shallow(
      <Counter
        value={0}
        onIncrementClick={() => {}}
        onIncrementClickAsync={() => {}}
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
