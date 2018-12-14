/* eslint-disable no-underscore-dangle */

import * as React from "react";
import * as ReactDOM from "react-dom";
import { Provider } from "react-redux";
import { applyMiddleware, compose, createStore } from "redux";
import thunkMiddleware from "redux-thunk";

import { ConnectedRouter, routerMiddleware } from "connected-react-router";
import { History } from "history";
import createBrowserHistory from "history/createBrowserHistory";
import createHashHistory from "history/createHashHistory";
import { Route, Switch } from "react-router-dom";

import { config } from "@cfg";
import { rootReducer } from "@src/reducers";
import { ErrorPage } from "./components/ErrorPage";

// Dynamically import App for code splitting, remove this if unwanted
// import { App } from "@src/components/App";
const App = React.lazy(() => import("@src/components/App"));

const configureHistory = () => {
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

  return appHistory;
};

const configureStore = (appHistory: History) => {
  // TypeScript definitions for devtools in /my-globals/index.d.ts
  // Redux devtools are still enabled in production!
  const composeEnhancers = window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__
    ? window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__({
        actionsBlacklist: []
      })
    : compose;

  // Add router to the state
  const routedAppReducer = rootReducer(appHistory);

  const middleware = [thunkMiddleware, routerMiddleware(appHistory)];

  // Add reducers in src/reducers/index.ts
  const store = createStore(
    routedAppReducer,
    composeEnhancers(applyMiddleware(...middleware))
  );

  return store;
};

export const AppConfigContext = React.createContext<typeof config | undefined>(
  undefined
);

// Dynamic import: remove if unwanted
const SuspenseApp = () => (
  <React.Suspense fallback={<div>Dynamically loading App in index.tsx</div>}>
    <App />
  </React.Suspense>
);

const start = (cfg: typeof config) => {
  const appHistory = configureHistory();
  const store = configureStore(appHistory);

  ReactDOM.render(
    <Provider store={store}>
      <ConnectedRouter history={appHistory}>
        <AppConfigContext.Provider value={cfg}>
          <Switch>
            <Route path="/counter" render={() => <SuspenseApp />} />
            <Route path="/" exact render={() => <SuspenseApp />} />
            <Route
              path="/"
              render={() => <ErrorPage code="404" message="Page not found" />}
            />
          </Switch>
        </AppConfigContext.Provider>
      </ConnectedRouter>
    </Provider>,
    document.getElementById("root")
  );
};

start(config);
