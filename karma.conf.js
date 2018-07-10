const webpack = require("webpack");
const baseConfig = require("./webpack.config.js");

const testConfig = {
  externals: baseConfig.externals,
  module: baseConfig.module,
  resolve: baseConfig.resolve,
  plugins: [
    ...baseConfig.plugins,
    // Add this to get karma-sourcemap-loader to pick it up
    // webpack.devtool seems to be ignored
    new webpack.SourceMapDevToolPlugin({
      test: /\.(tsx?|jsx?)($|\?)/i,
      filename: null, // inlined if null
      fileContext: "."
    })
  ]
};

module.exports = config => {
  config.set({
    // Chrome/Nightmare refuses to run ts files as it thinks they are video files
    mime: {
      "text/x-typescript": ["ts", "tsx"]
    },

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
