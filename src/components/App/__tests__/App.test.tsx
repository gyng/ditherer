import { mount } from "enzyme";
import * as React from "react";
import { MemoryRouter } from "react-router";
import App from "@src/components/App";

describe("App", () => {
  it("is a horrible tooling ecosystem", () => {
    // For testing connected components, you need to wrap in in a router
    const wrapper = mount(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );
    const title = wrapper.find("h1");
    expect(title).toHaveLength(1);
    expect(title.text()).toEqual("jsapp-boilerplate");
  });
});
