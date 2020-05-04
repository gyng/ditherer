/* eslint-disable @typescript-eslint/camelcase */
// @ts-check

/**
 * @type {import('./index.d').Configuration}
 */
const appConfig = {
  // Change this to your repo name
  url_basePath: "/jsapp-boilerplate/",
  // On GitHub Pages, we need to use hash routing
  url_historyType: "hash",
};

/**
 * @type {import('./index.d').BuildConfig}
 */
const buildConfig = {
  url_publicPath: "/jsapp-boilerplate/",
  url_configPath: "/jsapp-boilerplate/config.json",
};

module.exports = {
  appConfig,
  buildConfig,
};
