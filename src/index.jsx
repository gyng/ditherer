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

import App from "containers/App";
import reducers from "reducers";

import { THEMES } from "palettes/user";
import { PALETTE } from "constants/optionTypes";

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

// Load localStorage
Object.values(localStorage).forEach(json => {
  try {
    if (typeof json !== "string") return;
    const option = JSON.parse(json);
    if (!option || !option.type) return;

    if (option.type === PALETTE) {
      THEMES[option.name] = option.colors;
    }
  } catch (e) {
    // console.log("Not an option", json); // eslint-disable-line
  }
});

// Check for params
import { filterList } from "filters";
import { selectFilter, loadImageURLAsync } from "actions";
import type { Filter } from "types";

if (URLSearchParams && window.location.search) {
  const params = new URLSearchParams(window.location.search);

  // Algorithm
  const alg = params.get("alg");
  let filters = filterList;
  const selectedFilterOption = filters.find(
    f => f && f.displayName && f.displayName === alg
  );
  const selectedFilter = selectedFilterOption;
  if (alg && selectedFilter != null) {
    // $FlowFixMe
    store.dispatch(selectFilter(alg, selectedFilterOption));
  }

  // Image from URL
  const src = params.get("src");
  try {
    if (src != null) {
      new URL(src);
      loadImageURLAsync(src)(store.dispatch);
    }
  } catch (e) {
    console.error(e);
  }
}

const root = document.getElementById("root");
if (root != null) {
  ReactDOM.render(
    <Provider store={store}>
      <ConnectedRouter history={history}>
        <div style={{ height: "100%" }}>
          <Route path="/" component={App} className={s.app} />
        </div>
      </ConnectedRouter>
    </Provider>,
    root
  );
}
