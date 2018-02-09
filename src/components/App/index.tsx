import { ThemeProvider } from "emotion-theming";
import * as React from "react";
import styled, { keyframes } from "react-emotion";
import { Link, Route, Switch } from "react-router-dom";

import Echo from "@src/components/Echo";
import Counter from "@src/containers/Counter";

// emotion-theming theme to be passed to <ThemeProvider>
import theme from "@src/styles/theme";

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
  animation: ${spin} 60s ease-in-out infinite;
  border-radius: 50%;
  height: auto;
  width: 200px;
  margin-bottom: var(--m-l);
`;

// Can compose, or access theme using props
const ThemedDiv = styled("div")`
  ${theme.someCssStyle};
  border-radius: ${p => p.theme.someThemeStyle.borderRadius};
  margin: "10px 0";
  padding: "10px";
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
      <ThemeProvider theme={theme}>
        <div
          className="app"
          style={{
            display: "grid",
            gridGap: "var(--m-l)",
            gridTemplateColumns: "1fr 1fr 1fr",
            margin: "0 auto",
            maxWidth: "calc(var(--m) * 240)"
          }}
        >
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
            <ImgRobot src={hello} alt="Cute robot?" />
            <Echo text="Hello, world!" />
          </div>

          <ThemedDiv
            style={{
              border: "solid 1px grey"
            }}
          >
            This div is themed using <span className="sub">emotion</span>,{" "}
            <span className="sub">emotion-theming</span>, and{" "}
            <span className="sub">React's style prop</span>
          </ThemedDiv>
        </div>
      </ThemeProvider>
    );
  }
}

App.defaultProps = {
  match: { url: "unknown" }
};
