// @ts-check

// Please update the typedefs when you add keys in

const configValues = require("./configValues");

/**
 * @type {import('./index').EnvironmentEnum}
 */
const ENVIRONMENT = {
  development: "development",
  production: "production",
  github: "github"
};

/**
 * @type {import('./index').getEnvironment}
 */
const getEnvironment = (env = "") => {
  if (Object.keys(ENVIRONMENT).includes(env)) {
    return ENVIRONMENT[env];
  }
  return ENVIRONMENT.development;
};

const environment = getEnvironment(process.env.APP_ENV);

/**
 * @typedef {import('./index').ExportedConfiguration} Config
 * @type Config
 */
const config = {
  environment,
  ...configValues.values[environment]
};

module.exports = {
  ENVIRONMENT,
  getEnvironment,
  config
};
