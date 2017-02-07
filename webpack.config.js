const HtmlWebpackPlugin = require('html-webpack-plugin');
const path = require('path');
const webpack = require('webpack');

module.exports = {
  context: path.resolve(__dirname, './src'),

  target: 'web',

  entry: {
    app: './index.jsx',
  },

  output: {
    filename: '[name].bundle.js',
    path: path.resolve(__dirname, './build'),
  },

  module: {
    rules: [
      {
        test: /\.(css|scss)$/,
        use: [
          'style-loader',
          'css-loader?modules&importLoaders=1',
          'postcss-loader?sourceMap=inline',
        ],
      },
      {
        test: /\.(jpg|png|gif|mp4|webm|mp3|ogg)$/,
        loader: 'file-loader',
        options: {
          name: './f/[path][name].[hash].[ext]',
        },
      },
      {
        exclude: /\/node_modules\//,
        loader: 'babel-loader',
        query: { presets: ['airbnb'] },
        test: /\.(js|jsx)$/,
      },
    ],
  },

  plugins: [
    new webpack.EnvironmentPlugin({
      NODE_ENV: 'development', // defaults to development
    }),

    new webpack.LoaderOptionsPlugin({
      minimize: process.env.NODE_ENV === 'production',
      debug: process.env.NODE_ENV !== 'production',
    }),

    new webpack.optimize.CommonsChunkPlugin({
      filename: 'commons.js',
      minChunks: 2,
      name: 'commons',
    }),

    new HtmlWebpackPlugin({
      files: {
        css: ['style.css'],
        js: ['[name].bundle.js', 'commons.js'],
      },
      template: './index.html',
    }),

    (process.env.NODE_ENV === 'production'
      ? new webpack.optimize.UglifyJsPlugin()
      : new webpack.BannerPlugin({ banner: 'run with NODE_ENV=production to minify' })),
  ],

  devtool: 'cheap-eval-source-map',

  externals: {
    cheerio: 'window',
    'react/addons': true,
    'react/lib/ExecutionEnvironment': true,
    'react/lib/ReactContext': true,
  },

  resolve: {
    extensions: ['.js', '.jsx'],
  },
};
