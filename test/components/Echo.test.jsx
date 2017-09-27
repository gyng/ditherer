import React from "react";
import Enzyme, { shallow } from "enzyme";
import Adapter from 'enzyme-adapter-react-16';
import Echo from "components/Echo";

Enzyme.configure({ adapter: new Adapter() });

describe("Echo", () => {
  it("renders the text", () => {
    const wrapper = shallow(<Echo text="Hello, world!" />);
    const p = wrapper.find("p");
    expect(p).to.have.length(1);
    expect(p.text()).to.equal("Hello, world!");
  });
});
