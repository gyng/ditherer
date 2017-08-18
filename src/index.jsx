// @flow
/* eslint-disable no-underscore-dangle */

import React from "react";
import ReactDOM from "react-dom";
import { createStore, combineReducers, applyMiddleware, compose } from "redux";
import { Provider } from "react-redux";
import thunkMiddleware from "redux-thunk";

import createHistory from "history/createBrowserHistory";
import { Route } from "react-router-dom";
import {
  ConnectedRouter,
  routerReducer,
  routerMiddleware
} from "react-router-redux";

import App from "components/App";
import reducers from "reducers";

import s from "styles/style.scss";

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

ReactDOM.render(
  <Provider store={store}>
    <ConnectedRouter history={history}>
      <div>
        <Route path="/" component={App} className={s.app} />
      </div>
    </ConnectedRouter>
  </Provider>,
  document.getElementById("root")
);
