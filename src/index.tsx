// @flow
/* eslint-disable no-underscore-dangle */

import * as React from "react";
import * as ReactDOM from "react-dom";
import { Provider } from "react-redux";
import { applyMiddleware, combineReducers, compose, createStore } from "redux";
import thunkMiddleware from "redux-thunk";

import createHistory from "history/createBrowserHistory";
import { Route, RouteProps } from "react-router-dom";
import {
  ConnectedRouter,
  routerMiddleware,
  routerReducer
} from "react-router-redux";

import App from "@src/components/App";
import reducers from "@src/reducers";

// Include vanila CSS
const rootCss = require("./styles/root.css");

// https://github.com/emotion-js/emotion/pull/419
// import { ThemeProvider } from "emotion-theming";
import styled from "react-emotion";

// TypeScript definitions for devtools in /my-globals/index.d.ts
// Redux devtools are still enabled in production!
const composeEnhancers = window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__
  ? window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__({
      actionsBlacklist: []
    })
  : compose;

const appReducer = combineReducers({
  ...reducers,
  router: routerReducer
});

const history = createHistory();
const middleware = [thunkMiddleware, routerMiddleware(history)];

const store = createStore(
  appReducer,
  composeEnhancers(applyMiddleware(...middleware))
);

// Example of extending extra props on library components
interface IMyRouteProps extends RouteProps {
  unusedProp: string;
}
class MyRoute extends Route<IMyRouteProps> {}

ReactDOM.render(
  <Provider store={store}>
    <ConnectedRouter history={history}>
      <div>
        <MyRoute path="/counter" component={App} unusedProp="unused" />
        <MyRoute
          path="/jsapp-boilerplate"
          exact
          component={App}
          unusedProp="unused"
        />
        <MyRoute path="/" exact component={App} unusedProp="unused" />
      </div>
    </ConnectedRouter>
  </Provider>,
  document.getElementById("root")
);

if (module.hot) {
  module.hot.accept();
}
