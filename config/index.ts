// If in build/test process, __WEBPACK_DEFINE_CONFIG_JS_OBJ__ is unset
// If in bundle, it is set by Webpack's DefinePlugin in webpack.config.js
//
// This is needed because `process.env.APP_ENV` is undefined in a bundle, and to
// avoid leakage of configuration values outside of the current bundled environment
// we do not bundle the actual configuration object by referencing it at runtime
//
// Therefore, we inject the selected configuration at build time and isolate the
// full configuration from prying eyes.
//
// See `runtimeExamples/runtime_config.md` for details on how to use a runtime configuration instead

import configDef from "./index.d";

declare let __WEBPACK_DEFINE_CONFIG_JS_OBJ__: configDef.Configuration;

export const config = __WEBPACK_DEFINE_CONFIG_JS_OBJ__;
