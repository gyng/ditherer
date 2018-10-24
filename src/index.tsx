/* eslint-disable no-underscore-dangle */

import * as React from "react";
import * as ReactDOM from "react-dom";
import { Provider } from "react-redux";
import { applyMiddleware, combineReducers, compose, createStore } from "redux";
import thunkMiddleware from "redux-thunk";

import {
  ConnectedRouter,
  connectRouter,
  routerMiddleware
} from "connected-react-router";
import createBrowserHistory from "history/createBrowserHistory";
import createHashHistory from "history/createHashHistory";
import { Route, RouteProps } from "react-router-dom";

import { config } from "@cfg";
import { App } from "@src/components/App";
import { rootReducer } from "@src/reducers";
import { ErrorPage } from "./components/ErrorPage";

const start = () => {
  // TypeScript definitions for devtools in /my-globals/index.d.ts
  // Redux devtools are still enabled in production!
  const composeEnhancers = window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__
    ? window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__({
        actionsBlacklist: []
      })
    : compose;

  // Choose whether to use hash history (app/#counter) or browser history (app/counter)
  // This can be safely set to browser history if not hosting in a subdirectory (GitHub Pages)
  const historyFactories: { [k: string]: (options?: any) => any } = {
    browser: createBrowserHistory,
    hash: createHashHistory
  };

  const historyFactory = historyFactories[config.url.historyType];

  const appHistory = historyFactory({
    basename: config.url.basePath
  });

  // Add additional reducers as needed here
  const appReducer = combineReducers({
    ...rootReducer
  });

  // Add router to the state
  const routedAppReducer = connectRouter(appHistory)(appReducer);

  const middleware = [thunkMiddleware, routerMiddleware(appHistory)];

  const store = createStore(
    routedAppReducer,
    composeEnhancers(applyMiddleware(...middleware))
  );

  ReactDOM.render(
    <Provider store={store}>
      <ConnectedRouter history={appHistory}>
        <>
          <Route path="/counter" component={App} />
          <Route path="/" exact component={App} />
          <Route
            path="/"
            render={() => <ErrorPage code="404" message="Page not found" />}
          />
        </>
      </ConnectedRouter>
    </Provider>,
    document.getElementById("root")
  );
};

start();
