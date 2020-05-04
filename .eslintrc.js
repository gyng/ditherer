module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint", "jest", "jsx-a11y"],
  env: {
    browser: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "plugin:jsx-a11y/recommended",
    "plugin:jest/recommended",
    "plugin:prettier/recommended",
  ],
  rules: {
    // PostCSS requires require
    "@typescript-eslint/no-var-requires": 0,
    // Libraries sometimes have bad typings
    "@typescript-eslint/ban-ts-ignore": 0,
    // Sometimes, it really is any
    "@typescript-eslint/no-explicit-any": 0,
    // Library code return types can change
    "@typescript-eslint/explicit-function-return-type": 0,
    // Prefer build-time TS typechecking
    "react/prop-types": 0,
    // Emoji aren't too bad?
    "jsx-a11y/accessible-emoji": 0,
    // Used in Redux reducers a lot
    "no-case-declarations": 0,
    // Ignore unused variables with leading underscore
    "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
  },
  settings: {
    react: {
      version: "detect",
    },
  },
};
