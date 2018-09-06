import { Echo } from "@src/components/Echo";
import { mount } from "enzyme";
import * as React from "react";

describe("Echo", () => {
  it("renders the text", () => {
    const wrapper = mount(<Echo text="Hello, world!" />);
    const p = wrapper.find("p");
    expect(p).toHaveLength(1);
    expect(p.text()).toEqual("Hello, world!");
  });
});
