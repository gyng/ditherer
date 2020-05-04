// Example, empty custom typing for untyped libraries

declare module "my-globals" {
  global {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface Window {}
  }
}
