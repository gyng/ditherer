var path = require("path");

const baseConfig = require('./webpack.config.js');
const testConfig = {
  devtool: baseConfig.devtool,
  module: baseConfig.module,
  externals: baseConfig.externals
}

module.exports = function(config) {
  config.set({
    browsers: ['Nightmare'],

    frameworks: ['mocha', 'chai'],

    reporters: ['mocha'],

    plugins: [
      require('karma-chai'),
      require('karma-mocha'),
      require('karma-mocha-reporter'),
      require('karma-nightmare'),
      require('karma-sourcemap-loader'),
      require('karma-webpack'),
    ],

    files: [
      { pattern: 'test/**/*_test.js', watched: false }
    ],

    preprocessors: {
      'test/**/*_test.js': ['webpack', 'sourcemap']
    },

    webpack: testConfig,

    webpackMiddleware: {
      stats: 'errors-only'
    },

    nightmareOptions: {
      show: false
    },

    mochaReporter: {
      // output: 'minimal'
      // showDiff: true
    }
  });
};
