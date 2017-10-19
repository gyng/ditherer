import * as React from "react";
import { Link, Route } from "react-router-dom";

import Echo from "@src/components/Echo";
import Counter from "@src/containers/Counter";

// Let webpack instead of ts handle these imports
const hello = require("./hello.jpg");
const s = require("./styles.scss");

export interface AppProps {
  className: string;
  match: { url: string };
}

export default class App extends React.Component<AppProps, {}> {
  public static defaultProps: {
    className: string;
    match: { url: string };
  };

  public render() {
    return (
      <div className={this.props.className}>
        <img className={s.robot} src={hello} alt="Cute robot?" />
        <Echo text="Hello, world! Find me in src/components/App/index.jsx!" />

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
  className: s.app,
  match: { url: "unknown" }
};
