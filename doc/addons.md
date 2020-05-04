# Addons

A semi-curated list of potential addons to this boilerplate you might want. This list is based off a few years of experience working on this.

## Things you might want that will probably be helpful

* In a big team, you might want to add typechecking to your CSS modules. See [doc: using typed CSS](./using_typed_css.md)
* A runtime configuration for more complex deployment environments. See [doc: runtime config](./runtime_config.md)
* A UI library right from the start if you're working on a big project. Trust me, this will save you and your team members effort in the long run.
* [date-fns](https://date-fns.org/) for date manipulation over moment. Smaller bundle, functional API vs mutations, better TypeScript support.
* [lodash-es](https://www.npmjs.com/package/lodash-es) and not plain `lodash` for better tree-shaking. Alternatively, use [Ramda](https://ramdajs.com/) if that floats your boat.
* [brotli-webpack-plugin](https://github.com/mynameiswhm/brotli-webpack-plugin) for better compression over .gz if your web server supports brotli files.
* [immer](https://github.com/mweststrate/immer) for redux + immutable state. Has a nicer API over immutable.js.
* A form helper in [formik](https://github.com/jaredpalmer/formik) or [redux-form](https://redux-form.com/8.0.4/). I have no real preference for this, but it helps a lot to have one integrated early when dealing with lots of forms.
* Some sort of SVG loader for icons and the like. Can be done in PostCSS or webpack, depending on how your icons are coded.
* For fun, WASM! WASM is easy to integrate into this boilerplate. Check out [synthrs-wasm-ts](https://github.com/gyng/synthrs-wasm-ts) for an example on how to do so.
