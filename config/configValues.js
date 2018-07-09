// @ts-check

// For your own safety, please do not add logic to this file

// Import for typechecking
// eslint-disable-next-line
const config = require("./index");

// `basePath` is used for routing, needed if hosted in a subdirectory
// This only needs to be set to the subdirectory name if using browser history and not hash history

// `publicPath` is used for serving files, needed if hosted in a subdirectory
// On GitHub Pages, set it to "./"

// `historyType` is used to determine whether to use URL hashes or the HTML history API for routing
// On GitHub Pages, set it to hash history. this is required because GitHub does not fallback to root when
// visiting mypage/counters.

// These settings are baked into the source using Webpack's DefinePlugin
// Do a search in the project for `__WEBPACK_DEFINE_APP_ENV__` to see how it's linked up

/**
 * @typedef {"browser" | "hash"} HistoryTypes
 * @typedef {{ basePath: string, publicPath: string, historyType: HistoryTypes }} IUrlConfig
 * @type {{ [k in config.Environment]: { url: IUrlConfig } }}
 * */
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
  }
};

module.exports = {
  values
};
