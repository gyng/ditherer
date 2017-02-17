/* eslint-disable global-require, import/no-extraneous-dependencies */

module.exports = {
  plugins: [
    require('stylelint'),
    require('postcss-smart-import'),
    require('postcss-cssnext'),
    require('precss'),
    require('postcss-browser-reporter'),
    require('postcss-reporter'),
  ],
};
