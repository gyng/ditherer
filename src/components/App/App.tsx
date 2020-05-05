import React from "react";
import { Route, Switch } from "react-router-dom";
import { ErrorPage } from "@src/components/ErrorPage";
import { Routes } from "@src/routes";
import { Workspace } from "@src/features/workspace";

// Include global CSS and variables once
require("@src/styles/root.pcss");

// Legacy CSS is supported
require("./legacy.css");

// This is a nice way to define your custom presentational components
// that just pass down props.
export type IBoxProps = React.HTMLAttributes<HTMLDivElement>;

export class App extends React.Component<{}, {}> {
  public render() {
    return (
      <div>
        <Switch>
          <Route exact path={Routes.root()} render={() => <Workspace />} />
          <Route
            path="/"
            render={() => <ErrorPage code="404" message="Page not found" />}
          />
        </Switch>
      </div>
    );
  }
}
