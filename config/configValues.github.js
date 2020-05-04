/* eslint-disable @typescript-eslint/camelcase */
// @ts-check

/**
 * @type {import('./index.d').Configuration}
 */
const appConfig = {
  url_basePath: "/",
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
