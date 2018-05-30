/* eslint-disable no-console */

const WebpackDevServer = require("webpack-dev-server");
const webpack = require("webpack");
const config = require("../../webpack.config.js");

let server;
const url = "http://localhost:49999";

// Serve the app on webpack-dev-server
const setup = () => {
  const compiler = webpack(config);
  server = new WebpackDevServer(
    compiler,
    Object.assign(config.devServer, {
      quiet: true,
      headers: { Connection: null } // Disable Connection: Keep-Alive
    })
  );
  server.listen(49999, "localhost");
  console.log(`Started webpack-dev-server at ${url}`);
};

const teardown = () => {
  server.close(() => {
    process.exit();
  });
  console.log("Closed webpack-dev-server");
  setTimeout(() => {
    console.log("Forced abort after 5000ms");
    process.exit();
  }, 5000);
};

module.exports = {
  setup,
  teardown,
  url
};
