import React from "react";
import { shallow } from "enzyme";
import Echo from "components/Echo";

describe("Echo", () => {
  it("renders the text", () => {
    const wrapper = shallow(<Echo text="Hello, world!" />);
    const p = wrapper.find("p");
    expect(p).to.have.length(1);
    expect(p.text()).to.equal("Hello, world!");
  });
});
