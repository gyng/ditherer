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

const buildConfig = {
  url_publicPath: "/",
};

module.exports = {
  appConfig,
  buildConfig,
};
