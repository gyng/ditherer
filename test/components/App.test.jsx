import React from "react";
import { shallow } from "enzyme";
import App from "components/App";

describe("App", () => {
  it("renders two canvases", () => {
    const wrapper = shallow(<App />);
    const canvases = wrapper.find("canvas");
    expect(canvases).to.have.length(2);
  });
});
