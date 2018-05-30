/* tslint:disable:no-empty */

import Counter from "@src/components/Counter";
import { expect } from "chai";
import * as Enzyme from "enzyme";
import * as React from "react";
require("@test/helpers/enzyme");

describe("Counter", () => {
  let render: Enzyme.ShallowWrapper;

  before(() => {
    render = Enzyme.shallow(
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
