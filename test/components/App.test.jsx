import React from "react";
import { shallow } from "enzyme";
import App from "components/App";

import s from "components/App/styles.scss";

describe("App", () => {
  it("renders the chrome", () => {
    const wrapper = shallow(<App />);
    const chrome = wrapper.find(`.${s.chrome}`);
    expect(chrome).to.have.length(1);
  });

  it("renders a filter button", () => {
    const wrapper = shallow(<App />);
    const filterButton = wrapper.find(`.${s.filterButton}`);
    expect(filterButton).to.have.length(1);
  });

  it("renders a filter options", () => {
    const wrapper = shallow(<App />);
    const filterOptions = wrapper.find(".filterOptions");
    expect(filterOptions).to.have.length(1);
  });

  it("renders two canvases", () => {
    const wrapper = shallow(<App />);
    const canvases = wrapper.find("canvas");
    expect(canvases).to.have.length(2);
  });
});
