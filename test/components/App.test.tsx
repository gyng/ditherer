import { App } from "@src/components/App";
import { shallow } from "enzyme";
import * as React from "react";

describe("App", () => {
  it("is a horrible tooling ecosystem", () => {
    const wrapper = shallow(<App />);
    const title = wrapper.find("h1");
    expect(title).toHaveLength(1);
    expect(title.text()).toEqual("jsapp-boilerplate");
  });
});
