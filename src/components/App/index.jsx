// @flow
/* eslint-disable react/prefer-stateless-function, react/forbid-prop-types */

import React from "react";
import PropTypes from "prop-types";
import { Route, Link } from "react-router-dom";

import Counter from "containers/Counter";
import Echo from "components/Echo";

import hello from "./hello.jpg";
import s from "./styles.scss";

export default class App extends React.Component {
  static defaultProps: {
    className: string
  };

  render() {
    return (
      <div className={this.props.className}>
        <img className={s.robot} src={hello} alt="Cute robot?" />
        <Echo text="Hello, world! Find me in src/components/App/index.jsx!" />

        <div style={{ border: "solid 1px grey" }}>
          <Route
            exact
            path={this.props.match.url}
            render={() =>
              <Link to="/counter">
                Link to /counter. Click to show counter. Back/Forward buttons
                work.
              </Link>}
          />
          <Route path="/counter" component={Counter} />
        </div>
      </div>
    );
  }
}

App.propTypes = {
  className: PropTypes.string,
  match: PropTypes.object
};

App.defaultProps = {
  children: null,
  className: s.app,
  match: { url: "unknown" }
};
