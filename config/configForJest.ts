// This is to reexport for jest as we use webpack to inject
// the config into the built bundle, and jest does not know

export const { config } = require("./build.js");
