module.exports = {
  plugins: {
    "postcss-import": { addModulesDirectories: ["src"] },
    "postcss-preset-env": { stage: 0 },
    cssnano: {},
    "postcss-reporter": {}
  }
};
