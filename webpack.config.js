const HtmlWebpackPlugin = require("html-webpack-plugin");
const path = require("path");
const webpack = require("webpack");

module.exports = {
  context: path.resolve(__dirname, "src"),

  target: "web",

  entry: {
    app: "./index.tsx"
  },

  output: {
    filename: "[name].[hash:7].js",
    path: path.resolve(__dirname, "build"),
    publicPath: "/"
  },

  module: {
    rules: [
      // Escape hatch for CSS module classname mangling
      {
        test: /\.legacy\.css$/,
        include: path.resolve(__dirname, "src"),
        loaders: ["style-loader", "css-loader"]
      },
      {
        test: /\.(jpg|png|gif|mp4|webm|mp3|ogg)$/,
        loader: "file-loader",
        options: {
          name: "./f/[path][name].[hash].[ext]"
        }
      },
      // Mostly for tests, but legacy JS in source too
      {
        test: /\.(js|jsx)$/,
        exclude: /\/node_modules\//,
        loader: "babel-loader",
        options: {
          presets: ["airbnb"]
        }
      },
      {
        test: /\.tsx?$/,
        loader: "awesome-typescript-loader"
      },
      {
        enforce: "pre",
        test: /\.js$/,
        exclude: /\/node_modules\//,
        loader: "source-map-loader"
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
    extensions: [".js", ".jsx", ".ts", ".tsx"],
    modules: ["node_modules", path.resolve(__dirname, "src")],
    alias: {
      "@src": path.resolve(__dirname, "src")
    }
  }
};
