module.exports = {
  plugins: {
    // stylelint: {}, // enable this if you want live checking while developing
    "postcss-mixins": {
      mixinsDir: "src/styles/postcss/mixins",
    },
    "postcss-preset-env": {
      stage: 0,
    },
    cssnano: {},
    "postcss-reporter": { clearReportedMessages: true },
  },
};
