const baseConfig = require("./webpack.config.js");

const testConfig = {
  devtool: baseConfig.devtool,
  externals: baseConfig.externals,
  module: baseConfig.module,
  resolve: baseConfig.resolve
};

module.exports = config => {
  config.set({
    browsers: ["Nightmare"],

    frameworks: ["mocha", "chai"],

    reporters: ["mocha"],

    plugins: [
      "karma-chai",
      "karma-mocha",
      "karma-mocha-reporter",
      "karma-nightmare",
      "karma-sourcemap-loader",
      "karma-webpack"
    ],

    files: ["test/**/*.test.js", "test/**/*.test.jsx"],

    preprocessors: {
      "test/**/*.test.js": ["webpack", "sourcemap"],
      "test/**/*.test.jsx": ["webpack", "sourcemap"]
    },

    webpack: testConfig,

    webpackMiddleware: {
      stats: "errors-only"
    },

    nightmareOptions: {
      show: false
    },

    mochaReporter: {
      output: "minimal"
      // showDiff: true
    }
  });
};
