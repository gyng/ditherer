import { hot } from "react-hot-loader";

import * as React from "react";
import { Link, Route, Switch } from "react-router-dom";

import { config } from "@cfg";
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

// Example inline functional React component
const Box: React.SFC<any> = props => (
  <div className={styles.box} {...props}>
    {props.children}
  </div>
);

class App extends React.Component<IAppProps, {}> {
  public static defaultProps: {
    match: { url: string };
  };

  public render() {
    return (
      // Example usage of legacy CSS class name mixed with CSS modules
      <div className={`app ${styles.grid}`}>
        <div className={styles.row}>
          <h1>jsapp-boilerplate</h1>
          <div>
            <a href="https://github.com/gyng/jsapp-boilerplate">GitHub</a>&nbsp;&middot;&nbsp;
            <span>
              Find me in{" "}
              <a href="https://github.com/gyng/jsapp-boilerplate/blob/master/src/components/App/index.tsx">
                <code>src/components/App/index.tsx</code>
              </a>
            </span>
          </div>
        </div>

        {/* React style prop is still available */}
        <Box className={styles.box} style={{ alignSelf: "flex-start" }}>
          {/* Example usage of switch for routing */}
          <Switch>
            <Route path="/counter" component={Counter} />
            <Route
              path="/"
              render={() => (
                <Link to="/counter">
                  Link to /counter. Click to show counter. Back/Forward buttons
                  and page refresh work.
                </Link>
              )}
            />
          </Switch>
        </Box>

        <Box>
          <div>
            {/* Styling with CSS modules */}
            <img className={styles.robot} src={hello} alt="Cute robot?" />

            {/* Using other components */}
            <Echo text="Hello, world!" />
          </div>
        </Box>

        {/* Example DOM for nested CSS */}
        <Box>
          <div
            className={styles.themedDiv}
            style={{
              border: "solid 1px grey"
            }}
          >
            This div is themed using <span className={styles.sub}>PostCSS</span>{" "}
            and
            <span className={styles.sub}>React's style prop</span>
          </div>
        </Box>

        <Box>
          <div style={{ alignItems: "flex-start" }}>
            <div style={{ marginBottom: "var(--m-m)" }}>
              Current configuration
            </div>
            <pre>{JSON.stringify(config, null, 2)}</pre>
            <p>
              Configure in{" "}
              <a href="https://github.com/gyng/jsapp-boilerplate/blob/master/config/configValues.js">
                <code>config/configValues.js</code>
              </a>
            </p>
          </div>
        </Box>
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
