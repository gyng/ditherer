import { hot } from "react-hot-loader";

// Import config to test importing configuration in a .ts file
import { config } from "@cfg";

import * as React from "react";
import { Link, Route, Switch } from "react-router-dom";

import Echo from "@src/components/Echo";
import Counter from "@src/containers/Counter";

// Let webpack instead of ts handle these imports
const hello = require("./hello.jpg");
const styles = require("./styles.scss");

// Include global CSS and variables
const rootCss = require("../../styles/root.css");

// Legacy CSS are supported
const legacyCss = require("./styles.legacy.css");

export interface IAppProps {
  match: { url: string };
}

class App extends React.Component<IAppProps, {}> {
  public static defaultProps: {
    match: { url: string };
  };

  public render() {
    return (
      <div className="app">
        <div className={styles.grid}>
          <div style={{ gridColumn: "1 / 4", marginBottom: "72px" }}>
            <h1>jsapp-boilerplate</h1>
            <div>
              Find me in{" "}
              <span style={{ fontFamily: "monospace" }}>
                src/components/App/index.tsx
              </span>
            </div>
          </div>

          {/* React style prop is still available */}
          <div
            style={{
              alignSelf: "center",
              border: "solid 1px grey",
              borderRadius: "var(--curve)",
              margin: "var(--m-m) 0",
              padding: "var(--m-m)"
            }}
          >
            <Switch>
              <Route path="/counter" component={Counter} />
              <Route
                path="/"
                render={() => (
                  <Link to="/counter">
                    Link to /counter. Click to show counter. Back/Forward
                    buttons work.
                  </Link>
                )}
              />
            </Switch>
          </div>

          <div style={{ alignSelf: "center" }}>
            <img className={styles.robot} src={hello} alt="Cute robot?" />
            <Echo text="Hello, world!" />
            <div>Configuration: {JSON.stringify(config)}</div>
          </div>

          <div
            className={styles.themedDiv}
            style={{
              border: "solid 1px grey",
              gridColumn: "3 / 4"
            }}
          >
            This div is themed using <span className={styles.sub}>PostCSS</span>{" "}
            and
            <span className={styles.sub}>React's style prop</span>
          </div>
        </div>
      </div>
    );
  }
}

App.defaultProps = {
  match: { url: "unknown" }
};

export default (process.env.NODE_ENV === "development"
  ? hot(module)(App)
  : App);
