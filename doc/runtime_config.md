# Converting build-time to runtime configuration

To convert this to a runtime configuration (if needed)

* Generate `config.json` from `configValues.js` using a script
* Use a loader in `src/util` that fetches and parses the config
* Pass the parsed config to the app init function
* Remove the config export
* Also remove all usages of the directly-imported `config` module

## 1. Update configuration definitions

```bash
rm config/index.ts config/index.d.ts
cp config/runtimeExamples/index.ts config/index.ts
cp config/runtimeExamples/index.d.ts config/index.d.ts
```

## 2. Generate `config.json` on build for development

`configValues.js` will now be used to generate a development `config.json` on build.

Add this under `plugins` in `webpack.config.js`:

```js
new webpack.NamedModulesPlugin(),
  ...(DEV
  ? [new ShellOnBuildEndPlugin("yarn config:generate:dev")]
  : []),
```

## 3. Update `webpack.config.js` to load build-time config from updated configuration files

Import `buildConfig` in `webpack.config.js`, updating usages of `publicPath`

```diff
+ const { buildConfig } = require("./config/configValues");
+ console.log("BUILD CONFIG = ", buildConfig); // eslint-disable-line

  ...

  output: {
-   publicPath: config.url.publicPath,
+   publicPath: buildConfig.url_publicPath

  ...

  devMiddleware: {
-   publicPath: config.url.publicPath,
+   publicPath: buildConfig.url_publicPath
```

## 4. Add the configuration loader

An example loader is in `config/runtimeExamples/configLoader.ts`. This will do
the actual network request to grab the configuration file in the browser.

```bash
mkdir src/util
cp config/runtimeExamples/configLoader.ts src/util/configLoader.ts
```

## 5. Load and initialise the config at runtime

And then use the generated `config.json` in `src/index.tsx`:

```diff
- start(config);
+ import { loadConfig } from "@src/util/config";
+
+ loadConfig("/config.json")
+   .then(config => {
+     start(config);
+   })
+   .catch(error => {
+     // tslint:disable-next-line:no-console
+     console.error("Failed to load config file.", error);
+     ReactDOM.render(<ErrorPage code="500" />, document.getElementById("root"))+ ;
+ });
```


## 6. Update jest.config.js to resolve to a JSON config file

`jest.config.js`

```diff
moduleNameMapper: {
- "@cfg": "<rootDir>/config/configForJest.ts",
+ "@cfg/(.*)": "<rootDir>/config/$1",
```

```bash
rm config/configForJest.ts
```

## Bonus: Consul

If you happen to be using Consul, you can use `generateConsulTemplate.js` to generate the template for configuration. This helper will add rudimentary type-checking on your stored values.

1. Add this to `package.json`

    ```
    "config:generate:template": "node config/generateConsulTemplate.js",
    ```

2. Change `ENV_VAR`, `ROOT_PATH` or replace `makePath` in `generateConsulTemplate.js`.

3. You will need to fix `require("../configValues");` if you are going to move the script around.

4. Run `config:generate:template > my-template.json`.
