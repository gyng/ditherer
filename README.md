# jsapp-boilerplate

[![Build Status](https://travis-ci.org/gyng/jsapp-boilerplate.svg?branch=master)](https://travis-ci.org/gyng/jsapp-boilerplate)

A personal JavaScript boilerplate for frontend applications.

This boilerplate contains:

|              |                                                |
|--------------|------------------------------------------------|
| Presentation | React, CSS Modules                             |
| Store        | Redux                                          |
| Test         | Karma, Enzyme, Chai, ESLint, Travis, Stylelint |
| Build        | Webpack, Babel, Yarn, Flow                     |
| Deploy       | Docker?*                                       |

*to be implemented

## Usage

### Build

    yarn install
    NODE_ENV=production yarn run build  # minifies in production

### Test

    yarn run test
    yarn run lint       # runs flow, eslint, stylelint
    yarn run eslint
    yarn run stylelint
    yarn run flow


### Develop

    yarn run test:watch  # runs tests using karma in watch mode
    yarn run d           # runs webpack-dev-server

### Deploy

    not implemented

## Removing bits and pieces

### Flow

* Remove `src/types`, `.flowconfig`, `flow`
* Remove scripts from `package.json`
* Remove type imports from components and modules

### Redux

* Remove `src/actions`, `src/constants`, `src/containers`, `src/reducers` and any other Redux-related modules
* Remove Redux-related imports from `src/index.jsx`
* Remove packages `react-redux`, `redux`: `yarn remove redux react-redux`
* Unwrap `App` from `<Provider>` in `src/index.jsx`

### Travis

* Remove `.travis.yml` and badge from `README.md`
