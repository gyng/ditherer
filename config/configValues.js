// @ts-check

// For your own safety, please do not add logic to this file

// `basePath` is used for routing, needed if hosted in a subdirectory
// This only needs to be set to the subdirectory name if using browser history and not hash history

// `publicPath` is used for serving files, needed if hosted in a subdirectory
// On GitHub Pages, set it to "./"

// `historyType` is used to determine whether to use URL hashes or the HTML history API for routing
// On GitHub Pages, set it to hash history. this is required because GitHub does not fallback to root when
// visiting mypage/counters.

// These settings are baked into the source using Webpack's DefinePlugin
// See ./index.ts for details

/**
 * @typedef {import('./index.d').IAppConfig} IAppConfig
 * @type {import('./index.d').IConfig<IAppConfig>}
 */
const values = {
  development: {
    url: {
      basePath: "/",
      publicPath: "/",
      historyType: "browser"
    }
  },
  github: {
    url: {
      basePath: "/",
      publicPath: "./",
      historyType: "hash"
    }
  },
  production: {
    url: {
      basePath: "/",
      publicPath: "./",
      historyType: "browser"
    }
  },
  test: {
    url: {
      basePath: "/",
      publicPath: "./",
      historyType: "hash"
    }
  }
};

module.exports = {
  values
};
