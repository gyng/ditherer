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

    files: ["test/**/*.test.ts", "test/**/*.test.tsx"],

    preprocessors: {
      "test/**/*.test.ts": ["webpack", "sourcemap"],
      "test/**/*.test.tsx": ["webpack", "sourcemap"]
    },

    webpack: testConfig,

    webpackMiddleware: {
      stats: "errors-only",
      noInfo: true
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
