const path = require("path");
const webpack = require("webpack");
const CircularDependencyPlugin = require("circular-dependency-plugin");
const CompressionPlugin = require("compression-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const PreloadWebpackPlugin = require("preload-webpack-plugin");
const ReactRefreshWebpackPlugin = require("@pmmmwh/react-refresh-webpack-plugin");
const ShellOnBuildEndPlugin = require("./webpack-util/shell-on-build-end-webpack-plugin");

const buildConfigPath =
  process.env.BUILD_CONFIG_FILE || "./config/configValues";
const { buildConfig } = require(buildConfigPath);

if (!process.env.HIDE_CONFIG) {
  console.log("BUILD CONFIG = ", buildConfig);
}

const DEV = process.env.NODE_ENV === "development";
const PROD = process.env.NODE_ENV === "production";

module.exports = {
  // Defaults to development, pass --mode production to override
  mode: "development",

  context: path.resolve(__dirname),

  target: "web",

  entry: {
    app: "./src/index.tsx",
  },

  output: {
    filename: "[name].[hash:7].js",
    path: path.resolve(__dirname, "dist"),
    publicPath: buildConfig.url_publicPath,
  },

  module: {
    rules: [
      // Vanilla CSS
      {
        test: /\.css$/,
        include: path.resolve(__dirname, "src"),
        loaders: ["style-loader", "css-loader"],
      },
      // PostCSS
      {
        test: /\.(p|s)css$/,
        include: path.resolve(__dirname, "src"),
        loaders: [
          "style-loader",
          {
            loader: "css-loader",
            options: {
              modules: {
                localIdentName: DEV
                  ? "[name]__[local]--[hash:base64:3]"
                  : "[hash:base64:16]",
              },
              importLoaders: 1,
            },
          },
          "postcss-loader",
        ],
      },
      {
        test: /\.(jpg|jpeg|png|gif|mp4|webm|mp3|ogg|svg)$/,
        loader: "file-loader",
        options: {
          name: "./f/[hash:16].[ext]",
        },
      },
      {
        test: /\.(j|t)sx?$/,
        exclude: /\/node_modules\//,
        loader: "babel-loader",
        options: {
          cacheDirectory: true,
        },
      },
    ],
  },

  plugins: [
    new webpack.DefinePlugin({
      __WEBPACKDEFINE_APP_CONFIG_PATH__: JSON.stringify(
        buildConfig.url_configPath
      ),
    }),
    new webpack.NamedModulesPlugin(),
    new CircularDependencyPlugin({
      allowAsyncCycles: false,
      cwd: process.cwd(),
      exclude: /node_modules/,
      failOnError: true,
    }),
    new HtmlWebpackPlugin({
      template: "./src/index.html",
      favicon: "./src/static/favicon.ico",
    }),
    // Add resource hints to reduce loadtime
    // Ignore chunks at top level: if wanted, use the commented config instead
    // new PreloadWebpackPlugin({
    //   rel: "preload",
    //   include: "allChunks"
    // }),
    new PreloadWebpackPlugin({
      rel: "preload",
      include: "allAssets",
      fileWhitelist: [/\.(woff|woff2|ttf|svg|eot|otf|json|js)/],
    }),
    // Generate .gz for production builds
    // Consider adding brotli-webpack-plugin if your server supports .br
    ...(PROD
      ? [
          new CompressionPlugin({
            include: /\.(js|html|svg)$/,
          }),
        ]
      : []),
    ...(DEV
      ? [
          new ShellOnBuildEndPlugin({
            command: "yarn config:generate:dev",
            once: true,
          }),
        ]
      : []),
    ...(DEV ? [new ReactRefreshWebpackPlugin()] : []),
  ],

  // Using inline-source-map for detailed line numbers
  // Switch to cheap-eval-source-map if build times are too long
  devtool: PROD ? false : "inline-source-map",

  devServer: {
    allowedHosts: ["localhost"],
    clientLogLevel: "warning",
    historyApiFallback: true,
    host: "localhost",
    publicPath: buildConfig.url_publicPath,
    stats: "minimal",
  },

  externals: {
    cheerio: "window",
    "react/addons": true,
    "react/lib/ExecutionEnvironment": true,
    "react/lib/ReactContext": true,
  },

  resolve: {
    extensions: [".js", ".jsx", ".ts", ".tsx"],
    modules: ["node_modules", path.resolve(__dirname, "src")],
    alias: {
      "@cfg": path.resolve(__dirname, "config"),
      "@src": path.resolve(__dirname, "src"),
      "@test": path.resolve(__dirname, "test"),
    },
  },
};
