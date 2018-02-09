import React from "react";
import Enzyme, { shallow } from "enzyme";
import Adapter from "enzyme-adapter-react-16";
import App from "@src/components/App";

Enzyme.configure({ adapter: new Adapter() });

describe("App", () => {
  it("is a horrible tooling ecosystem", () => {
    const wrapper = shallow(<App />);
    const title = wrapper.find("h1");
    expect(title).to.have.length(1);
    expect(title.text()).to.equal("jsapp-boilerplate");
  });
});
