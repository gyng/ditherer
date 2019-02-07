const DEV = process.env.NODE_ENV === "development";

const presets = ["@babel/env", "@babel/typescript", "@babel/react"];
const plugins = [
  "@babel/plugin-syntax-dynamic-import",
  "@babel/plugin-proposal-class-properties",
  "@babel/proposal-object-rest-spread",
  ...(DEV ? ["react-hot-loader/babel"] : [])
];

module.exports = { presets, plugins };
