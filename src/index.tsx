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

// CSS escape hatch: name files with myfile.legacy.css
const legacyCss = require("./styles/style.legacy.css");

// https://github.com/emotion-js/emotion/pull/419
// import { ThemeProvider } from "emotion-theming";
import styled from "react-emotion";

// Extend window for TypeScript
declare global {
  interface Window {
    __REDUX_DEVTOOLS_EXTENSION_COMPOSE__: any;
  }
}

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
interface MyRouteProps extends RouteProps {
  unusedProp: string;
}
class MyRoute extends Route<MyRouteProps> {}

ReactDOM.render(
  <Provider store={store}>
    <ConnectedRouter history={history}>
      <div>
        <MyRoute path="/" component={App} unusedProp="unused" />
      </div>
    </ConnectedRouter>
  </Provider>,
  document.getElementById("root")
);
