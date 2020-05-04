// Example, empty custom typing for untyped libraries

declare module "my-globals" {
  global {
    interface Window {
      // Defined in webpack.config.js
      __WEBPACKDEFINE_APP_CONFIG_PATH__: string;
    }
  }
}
