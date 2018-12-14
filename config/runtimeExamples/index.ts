// Re-export in typescript for application development and Jest
// see configValues.js, jest.config.js > moduleNameMapper for details

import { IConfig } from "./index.d";

const { appConfig } = require("./configValues.js");

export const config: IConfig = appConfig;
