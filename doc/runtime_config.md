# Converting build-time to runtime configuration

To convert this to a runtime configuration (if needed)

* Create a new script to generate a `config.json` from `configValues.js`
* Create a config loader in `src/util` that fetches and parses the config
* Pass the parsed config to the app init function
* Remove the config export
* Also remove all usages of the directly-imported `config` module

## Generate `config.json` on build for development

`configValues.js` will now be used to generate a development `config.json` on build.

Add this to plugins in `webpack.config.js`:

```js
...(DEV
  ? new WebpackShellPlugin({
      onBuildStart: ["yarn config:generate:dev"],
      dev: true
    })
  : []),
```

## Config loader

An example loader is in `config/runtimeExamples/configLoader.ts`. This will do
the actual network request to grab the configuration file in the browser.

## Load and initialise the config at runtime

And then use that in `index.tsx`:

```ts
loadConfig("config.json").then(config => { start(config); });
```

## Remove the exported config

`config/index.ts`

```ts
import { IConfig } from "./index.d";

const { appConfig } = require("./configValues.js");

export const config: IConfig = appConfig;
```
