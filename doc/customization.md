# Removing bits and pieces

## Flow

* Remove `src/types`, `.flowconfig`, `flow`
* Remove scripts from `package.json`
* Remove type imports from components and modules

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

## CSS Modules

* Remove `modules` from `css-loader` in `webpack.config.js`
