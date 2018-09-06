/* tslint:disable:no-empty */

import { Counter } from "@src/components/Counter";
import * as Enzyme from "enzyme";
import * as React from "react";

describe("Counter", () => {
  let render: Enzyme.ShallowWrapper;

  beforeEach(() => {
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
    expect(valueEl.text()).toEqual("0");
  });

  it("renders the increment buttons", () => {
    const incrementEl = render.find("button.increment");
    expect(incrementEl).toHaveLength(2);
  });

  it("renders the decrement button", () => {
    const decrementEl = render.find("button.decrement");
    expect(decrementEl).toHaveLength(1);
  });
});
