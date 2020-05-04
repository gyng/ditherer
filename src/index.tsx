// react-hot-loader has to be imported before react
// in webpack's entrypoint
import "react-hot-loader";
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
import { config as appConfig } from "@cfg";
import { Configuration } from "@cfg/index.d";
import { store } from "@src/types";
import { AppRoutes } from "@src/routes";

// Dynamically import App for code splitting, remove this if unwanted
// import { App } from "@src/components/App";
const App = React.lazy(() => import("@src/components/App"));

const configureRouter = (config: Configuration) => {
  const routers: Record<string, typeof Router> = {
    browser: BrowserRouter,
    hash: HashRouter,
  };

  return {
    basename: config.url.basePath,
    Component: routers[config.url.historyType],
  };
};

export const AppConfigContext = React.createContext<Configuration | undefined>(
  undefined
);

// Dynamic import: remove if unwanted
const SuspenseApp = () => (
  <React.Suspense fallback={<div>Dynamically loading App in index.tsx</div>}>
    <App />
  </React.Suspense>
);

const start = (config: Configuration) => {
  const _store = store;

  const routerConfig = configureRouter(config);

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
            <Route path={AppRoutes.root()} component={SuspenseApp} />
          </Switch>
        </AppConfigContext.Provider>
      </routerConfig.Component>
    </Provider>,
    document.getElementById("root")
  );
};

start(appConfig);
