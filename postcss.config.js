module.exports = {
  plugins: {
    "postcss-mixins": {
      mixinsDir: "src/styles/postcss/mixins"
    },
    "postcss-preset-env": {
      stage: 0,
      importFrom: ["src/styles/postcss/customMedia.scss"]
    },
    cssnano: {},
    "postcss-reporter": {}
  }
};
