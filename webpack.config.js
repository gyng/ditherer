const path = require("path");
const webpack = require("webpack");

const CompressionPlugin = require("compression-webpack-plugin");
const HistoryApiFallback = require("./webpack-serve/historyApiFallback");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const WebpackShellPlugin = require("webpack-shell-plugin");

const { config } = require("./config/index");

console.log("CONFIG = ", config); // eslint-disable-line

const DEV = process.env.NODE_ENV === "development";
const PROD = process.env.NODE_ENV === "production";

const babelEnvPreset = [
  "@babel/env",
  {
    targets: {
      browsers: ["last 2 versions", "Firefox ESR", "not dead"]
    }
  }
];

module.exports = {
  // Defaults to development, pass --mode production to override
  mode: "development",

  context: path.resolve(__dirname),

  target: "web",

  entry: {
    app: "./src/index.tsx"
  },

  output: {
    filename: "[name].[hash:7].js",
    path: path.resolve(__dirname, "dist"),
    publicPath: config.url.publicPath
  },

  module: {
    rules: [
      // Vanilla CSS
      {
        test: /\.css$/,
        include: path.resolve(__dirname, "src"),
        loaders: ["style-loader", "css-loader"]
      },
      // PostCSS
      {
        test: /\.scss$/,
        include: path.resolve(__dirname, "src"),
        loaders: [
          "style-loader",
          {
            loader: "css-loader",
            options: { modules: true, importLoaders: 1 }
          },
          "postcss-loader"
        ]
      },
      {
        test: /\.(jpg|png|gif|mp4|webm|mp3|ogg|svg)$/,
        loader: "file-loader",
        options: {
          name: "./f/[hash:16].[ext]"
        }
      },
      // Mostly for tests, but legacy JS in source too
      {
        test: /\.jsx?$/,
        exclude: /\/node_modules\//,
        loader: "babel-loader",
        options: {
          plugins: [
            "@babel/proposal-class-properties",
            "@babel/proposal-object-rest-spread",
            ...(DEV ? ["react-hot-loader/babel"] : [])
          ],
          presets: [babelEnvPreset, "@babel/stage-3", "@babel/react"]
        }
      },
      {
        test: /\.tsx?$/,
        exclude: /\/node_modules\//,
        loader: "babel-loader",
        options: {
          plugins: [
            "@babel/proposal-class-properties",
            "@babel/proposal-object-rest-spread",
            ...(DEV ? ["react-hot-loader/babel"] : [])
          ],
          presets: [babelEnvPreset, "@babel/typescript", "@babel/react"]
        }
      }
    ]
  },

  plugins: [
    new webpack.DefinePlugin({
      __WEBPACK_DEFINE_APP_ENV__: JSON.stringify(config.environment),
      __WEBPACK_DEFINE_BASE_PATH__: JSON.stringify(config.url.basePath),
      __WEBPACK_DEFINE_HISTORY_TYPE__: JSON.stringify(config.url.historyType)
    }),
    new webpack.NamedModulesPlugin(),
    new WebpackShellPlugin({
      onBuildEnd: ["yarn --silent tsc:check:no-error"],
      dev: false
    }),
    new HtmlWebpackPlugin({
      template: "./src/index.html",
      favicon: "./src/static/favicon.ico"
    }),
    // Generate .gz for production builds
    // Consider adding brotli-webpack-plugin if your server supports .br
    ...(PROD
      ? [
          new CompressionPlugin({
            include: /\.(js|html|svg)$/
          })
        ]
      : [])
  ],

  optimization: {
    splitChunks: {
      cacheGroups: {
        vendors: {
          test: /\/node_modules\//,
          filename: "vendor.[hash:7].js",
          name: "vendor",
          chunks: "all"
        }
      }
    }
  },

  // Using cheap-eval-source-map for build times
  // switch to inline-source-map if detailed debugging needed
  devtool: PROD ? false : "cheap-eval-source-map",

  serve: {
    add: app => {
      // historyApiFallback: required for redux-router to work on page refresh
      // a refresh on localhost:8080/counter will go to the counter component defined in the route
      app.use(HistoryApiFallback());
    },
    clipboard: false,
    hot: {
      logLevel: "warn"
    },
    dev: {
      publicPath: config.url.publicPath,
      stats: "minimal"
    }
  },

  externals: {
    cheerio: "window",
    "react/addons": true,
    "react/lib/ExecutionEnvironment": true,
    "react/lib/ReactContext": true
  },

  resolve: {
    extensions: [".js", ".jsx", ".ts", ".tsx"],
    modules: ["node_modules", path.resolve(__dirname, "src")],
    alias: {
      "@cfg": path.resolve(__dirname, "config"),
      "@src": path.resolve(__dirname, "src"),
      "@test": path.resolve(__dirname, "test")
    }
  }
};
