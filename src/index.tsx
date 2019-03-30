/* eslint-disable no-underscore-dangle */

import * as React from "react";
import * as ReactDOM from "react-dom";
import { Provider } from "react-redux";
import { applyMiddleware, compose, createStore } from "redux";
import thunkMiddleware from "redux-thunk";

import { ConnectedRouter, routerMiddleware } from "connected-react-router";
import { createBrowserHistory, createHashHistory, History } from "history";
import { Route, Switch } from "react-router-dom";

import { config as appConfig } from "@cfg";
import { IConfiguration } from "@cfg/index.d";
import { rootReducer } from "@src/reducers";

// Dynamically import App for code splitting, remove this if unwanted
// import { App } from "@src/components/App";
const App = React.lazy(() => import("@src/components/App"));

const configureHistory = (config: IConfiguration) => {
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

export const AppConfigContext = React.createContext<IConfiguration | undefined>(
  undefined
);

// Dynamic import: remove if unwanted
const SuspenseApp = () => (
  <React.Suspense fallback={<div>Dynamically loading App in index.tsx</div>}>
    <App />
  </React.Suspense>
);

const start = (config: IConfiguration) => {
  const appHistory = configureHistory(config);
  const store = configureStore(appHistory);

  ReactDOM.render(
    <Provider store={store}>
      <ConnectedRouter history={appHistory}>
        <AppConfigContext.Provider value={config}>
          {/* This is an outer routing switch */}
          {/* You probably want to define your routes on the Switch in App.tsx and not here */}
          {/* This outer Switch is useful for partially loading large apps, and special routes */}
          {/* Such as authentication callback routes */}
          {/* You will know it when you need this. */}
          <Switch>
            <Route path="/" render={() => <SuspenseApp />} />
          </Switch>
        </AppConfigContext.Provider>
      </ConnectedRouter>
    </Provider>,
    document.getElementById("root")
  );
};

start(appConfig);
