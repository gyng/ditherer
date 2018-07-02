module.exports = {
  syntax: "postcss-scss",
  plugins: {
    stylelint: {},
    "postcss-import": { addModulesDirectories: ["src"] },
    "postcss-cssnext": {
      // This prints a warning when used with cssnano as both include
      // autoprefixer as dependencies
      warnForDuplicates: false,
      features: {
        // Preserves CSS variables
        // When this is set true, the variables are resolved at build-time
        customProperties: false
      }
    },
    precss: {},
    cssnano: { discardComments: { removeAll: true } },
    "postcss-reporter": {}
  }
};
