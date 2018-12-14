// Re-export in typescript for application development and Jest
// see configValues.js, jest.config.js > moduleNameMapper for details

import configDef from "./index.d";
export { IConfiguration } from "./index.d";

const { appConfig } = require("./configValues.js");

export const config: configDef.IConfiguration = appConfig;
