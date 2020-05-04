import { shallow } from "enzyme";
import * as React from "react";
import { ErrorPage } from "@src/components/ErrorPage";

describe("ErrorPage", () => {
  it("renders", () => {
    const wrapper = shallow(<ErrorPage code="418" message="I'm a teapot" />);
    const code = wrapper.find("h1");
    expect(code).toHaveLength(1);
    expect(code.text()).toEqual("418");

    const message = wrapper.find("strong");
    expect(message).toHaveLength(1);
    expect(message.text()).toEqual("I'm a teapot");
  });
});
