/* eslint-disable @typescript-eslint/camelcase */
// @ts-check

// This dummy config is used for three purposes:
// 1. Generating `config.json` for local development (re-exported as TS in index.ts)
//    Using an interface allows the app to typecheck and autocomplete configuraiton variables
// 2. Generating the Consul template for deployment on Nomad
// 3. Build-time configuration
//
// Doing so allows for type checking via TypeScript, which is *very* nice!
// We can only do a best-effort runtime check (= lose enum information)
// for the templates and that is handled in `generateConsulTemplate.js`.

// Do not do nesting! Avoid nesting so we don't kill ourselves when generating the template, and configuring on Consul

/**
 * @type {import('./index.d').Configuration}
 */
const appConfig = {
  url_basePath: "/",
  url_historyType: "browser",
};

/**
 * Configuration options used by Webpack during build-time.
 * This is very basic and has no support for per-environment build configurations.
 * If you find that you need multiple environments, please change the shape of buildConfig
 * and update IBuildConfig. Typing this gives us typechecking in `webpack.config.js`.
 * @type {import('./index.d').BuildConfig}
 */
const buildConfig = {
  url_publicPath: "/",
};

module.exports = {
  appConfig,
  buildConfig,
};
