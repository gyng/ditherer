const history = require("connect-history-api-fallback");
const convert = require("koa-connect");

// https://github.com/bripkens/connect-history-api-fallback#options
const defaultOptions = {};

module.exports = (options = defaultOptions) => convert(history(options));
