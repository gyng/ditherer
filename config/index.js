// @ts-check

// Please update the typedefs when you add keys in

const configValues = require("./configValues");

/**
 * @typedef {"development"|"production"|"github"} Environment
 * @type { { [k in Environment]: Environment} }
 */
const ENVIRONMENT = {
  development: "development",
  production: "production",
  github: "github"
};

/**
 * @param {string} [env]
 * @returns {Environment}
 */
const getEnvironment = (env = "") => {
  if (Object.keys(ENVIRONMENT).includes(env)) {
    // eslint-disable-next-line
    console.log(`APP_ENV = ${env}`);
    return ENVIRONMENT[env];
  }
  // eslint-disable-next-line
  console.log(`APP_ENV = ${ENVIRONMENT.development} (default fallback)`);
  return ENVIRONMENT.development;
};

const environment = getEnvironment(process.env.APP_ENV);

/** @type { { environment: Environment, url: configValues.IUrlConfig } } */
const config = {
  environment,
  ...configValues.values[environment]
};

module.exports = {
  ENVIRONMENT,
  getEnvironment,
  config
};
