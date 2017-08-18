import React from "react";
import { shallow } from "enzyme";
import App from "components/App";
import Echo from "components/Echo";

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
