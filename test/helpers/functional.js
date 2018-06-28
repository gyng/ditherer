/* eslint-disable no-console */

const serve = require("webpack-serve");
const config = require("../../webpack.config.js");

let server;
const host = "localhost";
const port = 49999;
const url = `http://${host}:${port}`;

// Serve the app on webpack-serve
const setup = () => {
  serve({
    config: {
      ...config,
      serve: {
        ...config.serve,
        host,
        port,
        on: {
          listening: appServer => {
            console.info(`Started webpack-serve at ${url}`);
            server = appServer;
          }
        }
      }
    }
  });
};

const teardown = () => {
  setTimeout(() => {
    console.warn("Forced abort after 5000ms");
    process.exit();
  }, 5000);

  server.server.kill();
  console.info("Closed webpack-serve");
  process.exit();
};

module.exports = {
  setup,
  teardown,
  url
};
