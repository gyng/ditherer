const DEV = process.env.NODE_ENV === "development";

const presets = ["@babel/env", "@babel/typescript", "@babel/react"];
const plugins = [
  "@babel/plugin-syntax-dynamic-import",
  "@babel/plugin-proposal-class-properties",
  "@babel/proposal-object-rest-spread",
  // These 2 will be included in babel/typescript presets soon
  // Ref: https://github.com/babel/babel/issues/10690
  "@babel/plugin-proposal-nullish-coalescing-operator",
  "@babel/plugin-proposal-optional-chaining",
  ...(DEV ? ["react-hot-loader/babel"] : [])
];

module.exports = { presets, plugins };
