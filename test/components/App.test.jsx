import React from "react";
import Enzyme, { shallow } from "enzyme";
import Adapter from "enzyme-adapter-react-16";
import App from "@src/components/App";
import Echo from "@src/components/Echo";

Enzyme.configure({ adapter: new Adapter() });

describe("App", () => {
  it("is a horrible tooling ecosystem", () => {
    const wrapper = shallow(<App />);
    const echoes = wrapper.find(Echo);
    expect(echoes).to.have.length(1);
    expect(
      echoes.find({
        text: "Hello, world! Find me in src/components/App/index.jsx!"
      })
    ).to.have.length(1);
  });
});
