import Echo from "@src/components/Echo";
import { expect } from "chai";
import { mount } from "enzyme";
import * as React from "react";
require("@test/helpers/enzyme");

describe("Echo", () => {
  it("renders the text", () => {
    const wrapper = mount(<Echo text="Hello, world!" />);
    const p = wrapper.find("p");
    expect(p).to.have.length(1);
    expect(p.text()).to.equal("Hello, world!");
  });
});
