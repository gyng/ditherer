import { mount } from "enzyme";
import * as React from "react";
import { Echo } from "@src/components/Echo";

describe("Echo", () => {
  it("renders the text", () => {
    const wrapper = mount(<Echo text="Hello, world!" />);
    const p = wrapper.find("p");
    expect(p).toHaveLength(1);
    expect(p.text()).toEqual("Hello, world!");
  });

  it("can do snapshot tests", () => {
    // You can perform snapshot testing if you so prefer
    const wrapper = mount(<Echo text="Hello, world!" />);
    expect(wrapper).toMatchSnapshot();
  });
});
