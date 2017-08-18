const HtmlWebpackPlugin = require("html-webpack-plugin");
const path = require("path");
const webpack = require("webpack");

module.exports = {
  context: path.resolve(__dirname, "src"),

  target: "web",

  entry: {
    app: "./index.jsx"
  },

  output: {
    filename: "[name].[hash:7].js",
    path: path.resolve(__dirname, "build"),
    publicPath: "/"
  },

  module: {
    rules: [
      {
        test: /\.(css|scss)$/,
        loaders: [
          "style-loader",
          {
            loader: "css-loader",
            options: { modules: true, importLoaders: 1 }
          },
          { loader: "postcss-loader", options: { sourceMap: "inline" } }
        ]
      },
      // Escape hatch for CSS module classname mangling
      {
        test: /\.legacy\.(css|scss)$/,
        include: path.resolve(__dirname, "src"),
        loaders: [
          "style-loader",
          { loader: "css-loader", options: { importLoaders: 1 } }
        ]
      },
      {
        test: /\.(jpg|png|gif|mp4|webm|mp3|ogg)$/,
        loader: "file-loader",
        options: {
          name: "./f/[path][name].[hash].[ext]"
        }
      },
      {
        test: /\.(js|jsx)$/,
        exclude: /\/node_modules\//,
        loader: "babel-loader",
        options: {
          presets: ["airbnb"]
        }
      }
    ]
  },

  plugins: [
    new webpack.EnvironmentPlugin({
      NODE_ENV: "development" // defaults to development
    }),

    new webpack.LoaderOptionsPlugin({
      minimize: process.env.NODE_ENV === "production",
      debug: process.env.NODE_ENV !== "production"
    }),

    new webpack.optimize.CommonsChunkPlugin({
      filename: "commons.js",
      minChunks: 2,
      name: "commons"
    }),

    new HtmlWebpackPlugin({
      files: {
        css: [],
        js: ["[name].js", "commons.js"]
      },
      template: "./index.html"
    }),

    process.env.NODE_ENV === "production"
      ? new webpack.optimize.UglifyJsPlugin()
      : new webpack.BannerPlugin({
          banner: "run with NODE_ENV=production to minify"
        })
  ],

  devtool: "cheap-eval-source-map",

  devServer: {
    contentBase: "app/ui/www",
    historyApiFallback: true,
    stats: "minimal"
  },

  externals: {
    cheerio: "window",
    "react/addons": true,
    "react/lib/ExecutionEnvironment": true,
    "react/lib/ReactContext": true
  },

  resolve: {
    extensions: [".js", ".jsx"],
    modules: ["node_modules", path.resolve(__dirname, "src")]
  }
};
