# Removing bits and pieces

## Redux

* Remove `src/actions`, `src/constants`, `src/containers`, `src/reducers` and any other Redux-related modules
* Remove Redux-related imports from `src/index.jsx`
* Remove packages `react-redux`, `redux`: `yarn remove redux react-redux redux-thunk`
* Unwrap `App` from `<Provider>` in `src/index.jsx`
* Replace `react-router-redux` with vanilla `react-router`

## Travis

* Remove `.travis.yml` and badge from `README.md`

## Docker

* Remove `Dockerfile`, `docker-compose.yml`

## Emotion

* Remove `yarn remove emotion react-emotion emotion-theming`
* Remove usages of emotion in example components
* Use `.legacy.css` for all styling
* Change `.legacy.css` to `.css` in `webpack.config.js`
* Install `sass-loader` and `node-sass`, add to `webpack.config.js` if you want SCSS/SASS

## Functional tests

* `yarn remove nightmare`
* Remove `tests/functional`
* Remove references to `test:functional` and `test:full`
