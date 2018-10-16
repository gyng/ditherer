module.exports = {
  plugins: {
    "postcss-preset-env": {
      stage: 0,
      importFrom: ["src/styles/postcss/customMedia.css"]
    },
    cssnano: {},
    "postcss-reporter": {}
  }
};
