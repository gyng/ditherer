// Example, empty custom typing for untyped libraries

declare module "my-globals" {
  global {
    // tslint:disable-next-line interface-name
    interface Window {
      __REDUX_DEVTOOLS_EXTENSION_COMPOSE__: any;
    }
  }
}
