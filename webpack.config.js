const HtmlWebpackPlugin = require("html-webpack-plugin");
const CompressionPlugin = require("compression-webpack-plugin");
const path = require("path");

const PROD = process.env.NODE_ENV === "production";

module.exports = {
  // Defaults to development, pass --mode production to override
  mode: "development",

  context: path.resolve(__dirname, "src"),

  target: "web",

  entry: {
    app: "./index.jsx",
  },

  output: {
    filename: "[name].[hash:7].js",
    path: path.resolve(__dirname, "build"),
    publicPath: PROD ? "./" : "/",
  },

  module: {
    rules: [
      {
        test: /\.(css|scss)$/,
        use: [
          "style-loader",
          {
            loader: "css-loader",
            options: { modules: true, importLoaders: 1 },
          },
          { loader: "postcss-loader", options: { sourceMap: "inline" } },
        ],
      },
      // Escape hatch for CSS module classname mangling
      {
        test: /\.legacy\.(css|scss)$/,
        include: path.resolve(__dirname, "src"),
        use: [
          "style-loader",
          { loader: "css-loader", options: { importLoaders: 1 } },
        ],
      },
      {
        test: /\.(jpg|png|gif|mp4|webm|mp3|ogg)$/,
        loader: "file-loader",
        options: {
          name: "./f/[path][name].[hash].[ext]",
        },
      },
      {
        test: /\.jsx?$/,
        exclude: /\/node_modules\//,
        loader: "babel-loader",
        options: {
          plugins: [
            "@babel/plugin-syntax-dynamic-import",
            "@babel/plugin-syntax-import-meta",
            ["@babel/plugin-proposal-class-properties", { loose: false }],
            "@babel/plugin-proposal-json-strings",
          ],
          presets: ["@babel/preset-react", "@babel/preset-flow"],
        },
      },
      // {
      //   test: /\.tsx?$/,
      //   exclude: /\/node_modules\//,
      //   loader: "babel-loader",
      //   options: {
      //     plugins: ["@babel/proposal-object-rest-spread"], // Needed for jsx interop
      //     presets: ["@babel/react", "@babel/preset-typescript"]
      //   }
      // }
    ],
  },

  plugins: [
    new HtmlWebpackPlugin({
      files: {
        css: [],
        js: ["[name].js", "commons.js"],
      },
      template: "./index.html",
    }),
    ...(PROD ? [new CompressionPlugin()] : []),
  ],

  // optimization: {
  //   splitChunks: {
  //     cacheGroups: {
  //       commons: {
  //         test: /[\\/]node_modules[\\/]/,
  //         filename: "commons.js",
  //         name: "commons",
  //         chunks: "all"
  //       }
  //     }
  //   }
  // },

  devtool: "source-map",

  devServer: {
    historyApiFallback: true,
  },

  externals: {
    cheerio: "window",
    "react/addons": true,
    "react/lib/ExecutionEnvironment": true,
    "react/lib/ReactContext": true,
    fs: "commonjs fs", // required for rustc generated JS-WASM loader
  },

  resolve: {
    extensions: [".js", ".jsx", ".ts", ".tsx", ".wasm"],
    modules: ["node_modules", path.resolve(__dirname, "src")],
    alias: {
      "@src": path.resolve(__dirname, "src"),
    },
  },

  experiments: {
    syncWebAssembly: true,
  },
};
