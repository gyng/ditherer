import React from "react";
import Enzyme, { mount } from "enzyme";
import Adapter from "enzyme-adapter-react-16";
import Echo from "components/Echo";

Enzyme.configure({ adapter: new Adapter() });

describe("Echo", () => {
  it("renders the text", () => {
    const wrapper = mount(<Echo text="Hello, world!" />);
    const p = wrapper.find("p");
    expect(p).to.have.length(1);
    expect(p.text()).to.equal("Hello, world!");
  });
});
