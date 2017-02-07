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
    path: path.resolve(__dirname, './dist'),
  },

  module: {
    loaders: [
      {
        test: /\.(css|scss)$/,
        use: ['style-loader', 'css-loader?importLoaders=1', 'postcss-loader'],
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
  ],

  devtool: 'inline-source-map',

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
