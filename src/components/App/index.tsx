import * as React from "react";
import styled, { keyframes } from "react-emotion";
import { Link, Route } from "react-router-dom";

import Echo from "@src/components/Echo";
import Counter from "@src/containers/Counter";

// Let webpack instead of ts handle these imports
const hello = require("./hello.jpg");

// Legacy CSS are supported
const legacyCss = require("./styles.legacy.css");

const spin = keyframes`
  100% {
    transform: rotateX(360deg) rotateY(360deg) rotateZ(360deg);
  }
`;

const ImgRobot = styled("img")`
  align-self: center;
  animation: ${spin} 60s linear infinite;
  border-radius: 50%;
  height: auto;
  width: 200px;
`;

export interface AppProps {
  match: { url: string };
}

export default class App extends React.Component<AppProps, {}> {
  public static defaultProps: {
    match: { url: string };
  };

  public render() {
    return (
      <div className="app">
        <ImgRobot src={hello} alt="Cute robot?" />
        <Echo text="Hello, world! Find me in src/components/App/index.jsx!" />

        {/* React style prop is still available */}
        <div style={{ border: "solid 1px grey" }}>
          <Route
            exact
            path={this.props.match.url}
            render={() => (
              <Link to="/counter">
                Link to /counter. Click to show counter. Back/Forward buttons
                work.
              </Link>
            )}
          />
          <Route path="/counter" component={Counter} />
        </div>
      </div>
    );
  }
}

App.defaultProps = {
  match: { url: "unknown" }
};
