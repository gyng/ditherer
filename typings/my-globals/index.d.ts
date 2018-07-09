// Example, empty custom typing for untyped libraries

declare module "my-globals" {
  global {
    interface Window {
      __REDUX_DEVTOOLS_EXTENSION_COMPOSE__: any;
    }
  }
}

declare var __WEBPACK_DEFINE_APP_ENV__: string;
declare var __WEBPACK_DEFINE_BASE_PATH__: string;
declare var __WEBPACK_DEFINE_HISTORY_TYPE__: string;
