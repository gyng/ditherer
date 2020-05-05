import "@babel/polyfill";

import * as React from "react";
import * as ReactDOM from "react-dom";
import { Provider } from "react-redux";
import {
  BrowserRouter as Router,
  Route,
  Switch,
  BrowserRouter,
  HashRouter,
} from "react-router-dom";
import { ErrorPage } from "./components/ErrorPage";
import { PALETTE } from "./constants/optionTypes";
import { THEMES } from "./palettes/user";
import { selectFilter, importState } from "./actions";
import { Configuration } from "@cfg/index.d";
import { store } from "@src/types";
import { Routes } from "@src/routes";
import { loadConfig } from "@src/util/configLoader";
import { filterList } from "@src/filters";

// Dynamically import App for code splitting, remove this if unwanted
const App = React.lazy(() => import("@src/containers/App"));
// import { App } from "@src/components/App";

const configureRouter = (config: Configuration) => {
  const routers: Record<string, typeof Router> = {
    browser: BrowserRouter,
    hash: HashRouter,
  };

  return {
    basename: config.url_basePath,
    Component: routers[config.url_historyType],
  };
};

export const AppConfigContext = React.createContext<Configuration | undefined>(
  undefined
);

// Dynamic import: remove if unwanted
const SuspenseApp = () => (
  <React.Suspense fallback={<div></div>}>
    <App />
  </React.Suspense>
);

const start = (config: Configuration) => {
  const _store = store;

  const routerConfig = configureRouter(config);

  // Load localStorage
  Object.values(localStorage).forEach((json) => {
    try {
      if (typeof json !== "string") return;
      const option = JSON.parse(json);
      if (!option || !option.type) return;

      if (option.type === PALETTE) {
        // @ts-ignore
        THEMES[option.name] = option.colors;
      }
    } catch (e) {
      // console.log("Not an option", json); // eslint-disable-line
    }
  });

  // Check for params
  if (window.URLSearchParams && window.location.search) {
    const params = new URLSearchParams(window.location.search);

    // Algorithm
    const alg = params.get("alg");
    const filters = filterList;
    const selectedFilterOption = filters.find(
      (f) => f && f.displayName && f.displayName === alg
    );
    const selectedFilter = selectedFilterOption;
    if (alg && selectedFilter != null) {
      // @ts-ignore
      store.dispatch(selectFilter(alg, selectedFilterOption));
    }

    const state = params.get("state");
    try {
      const decoded = state ? window.atob(state) : null;
      if (state && decoded) {
        store.dispatch(importState(decoded));
      }
    } catch (e) {
      console.warn("Invalid state:", e); // eslint-disable-line
    }
  }

  ReactDOM.render(
    <Provider store={_store}>
      <routerConfig.Component basename={routerConfig.basename}>
        <AppConfigContext.Provider value={config}>
          {/* This is an outer routing switch */}
          {/* You probably want to define your routes on the Switch in App.tsx and not here */}
          {/* This outer Switch is useful for partially loading large apps, and special routes */}
          {/* Such as authentication callback routes */}
          {/* You will know it when you need this. */}
          <Switch>
            <Route path={Routes.root()} component={SuspenseApp} />
          </Switch>
        </AppConfigContext.Provider>
      </routerConfig.Component>
    </Provider>,
    document.getElementById("root")
  );
};

// @ts-ignore
loadConfig(__WEBPACKDEFINE_APP_CONFIG_PATH__)
  .then((config) => {
    start(config);
  })
  .catch((error) => {
    console.error("Failed to load config file.", error);
    ReactDOM.render(<ErrorPage code="500" />, document.getElementById("root"));
  });
