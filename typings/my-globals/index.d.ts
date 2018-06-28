// Example, empty custom typing for untyped libraries

declare module "my-globals" {
  global {
    interface Window {
      __REDUX_DEVTOOLS_EXTENSION_COMPOSE__: any;
    }
  }
}

declare var __WEBPACK_DEFINE_BASE_PATH__: string;
