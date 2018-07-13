import App from "@src/components/App";
import { expect } from "chai";
import { shallow } from "enzyme";
import * as React from "react";
require("@test/helpers/enzyme");

describe("App", () => {
  it("is a horrible tooling ecosystem", () => {
    const wrapper = shallow(<App />);
    const title = wrapper.find("h1");
    expect(title).to.have.length(1);
    expect(title.text()).to.equal("jsapp-boilerplate");
  });
});
