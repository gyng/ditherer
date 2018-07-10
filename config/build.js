// @ts-check

// Please update the typedefs when you add keys in

const configValues = require("./configValues");

/**
 * @type {import('./index.d').EnvironmentEnum}
 */
const ENVIRONMENT = {
  development: "development",
  production: "production",
  github: "github"
};

/**
 * @type {import('./index.d').getEnvironment}
 */
const getEnvironment = (env = "") => {
  if (Object.keys(ENVIRONMENT).includes(env)) {
    return ENVIRONMENT[env];
  }
  return ENVIRONMENT.development;
};

const environment = getEnvironment(process.env.APP_ENV);

/**
 * @type {import('./index.d').Configuration}
 */
const config = {
  environment,
  ...configValues.values[environment]
};

module.exports = {
  ENVIRONMENT,
  config
};