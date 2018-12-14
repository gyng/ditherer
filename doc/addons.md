# Addons

A semi-curated list of potential addons to this boilerplate you might want. This list is based off a few years of experience working on this.

## Things you might want that will probably be helpful

* A UI library right from the start if you're working on a big project. Trust me, this will save you and your team members effort in the long run.
* [date-fns](https://date-fns.org/) for date manipulation over moment. Smaller bundle, functional API vs mutations, better TypeScript support.
* [lodash-es](https://www.npmjs.com/package/lodash-es) and not plain `lodash` for better tree-shaking. Alternatively, use [Ramda](https://ramdajs.com/) if that floats your boat.
* [brotli-webpack-plugin](https://github.com/mynameiswhm/brotli-webpack-plugin) for better compression over .gz if your web server supports brotli files.
* [immer](https://github.com/mweststrate/immer) for redux + immutable state. Has a nicer API over immutable.js.
* A form helper in [formik](https://github.com/jaredpalmer/formik) or [redux-form](https://redux-form.com/8.0.4/). I have no real preference for this, but it helps a lot to have one integrated early when dealing with lots of forms.
* Some sort of SVG loader for icons and the like. Can be done in PostCSS or webpack, depending on how your icons are coded.

## Things you might want (which I have no strong opinions on or experience with)

* [redux-saga](https://github.com/redux-saga/redux-saga) over redux-thunk. It's a lot of extra complexity for what it offers. If your business logic is *that* complicated then you might want to consider this. redux-thunk works fine 90% of the time, though.
* [normalizr](https://github.com/paularmstrong/normalizr) if your business logic has an easily normalized state. Although, I haven't had to use this.
* CSS-in-JS library such as [emotion](https://github.com/emotion-js/emotion). This is mostly a matter of preference. I've found that in the teams I've been in CSS-looking things usually work out better.

## Things you might want that I personally dislike

* A selector library such as [reselect](https://github.com/reduxjs/reselect). I find that selectors are a detrimental abstraction over raw state access. They add boilerplate and hide complexity that can be better dealt with utility functions instead.
