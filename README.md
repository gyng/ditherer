# jsapp-boilerplate

[![Build Status](https://travis-ci.org/gyng/jsapp-boilerplate.svg?branch=master)](https://travis-ci.org/gyng/jsapp-boilerplate)

A personal JavaScript boilerplate for frontend applications for near-production use.

This boilerplate contains:

| **Presentation, state**                                                   |                         |
|---------------------------------------------------------------------------|-------------------------|
| [react](https://facebook.github.io/react/docs/hello-world.html)           | ui framework            |
| [redux](http://redux.js.org/)                                             | state management        |
| [react-redux](http://redux.js.org/docs/basics/UsageWithReact.html)        | react-redux integration |
| [css modules](https://github.com/css-modules/css-modules)                 | modular css             |
| **Testing, linting**                                                      |                         |
| [mocha](https://mochajs.org/#getting-started)                             | test framework          |
| [chai](http://chaijs.com/guide/styles/)                                   | test assertions         |
| [enzyme](http://airbnb.io/enzyme/index.html)                              | react test library      |
| [flow](https://flowtype.org/docs/getting-started.html)                    | type checking           |
| [eslint](http://eslint.org/docs/rules/)                                   | javascript linting      |
| [stylelint](https://stylelint.io/user-guide/)                             | css linting             |
| [karma](http://karma-runner.github.io/1.0/config/configuration-file.html) | test runner             |
| **Building, CI, deploying**                                               |                         |
| [webpack](https://webpack.js.org/concepts/)                               | javascript bundler      |
| [docker](https://docs.docker.com/engine/reference/builder/)               | container               |
| [docker-compose](https://docs.docker.com/compose/compose-file/)           | multi-container         |
| [travis](https://docs.travis-ci.com/user/customizing-the-build)           | ci                      |

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

    docker-compose up    # runs http-server at port 8080 on a production build in a container

### Removing bits and pieces

#### Flow

* Remove `src/types`, `.flowconfig`, `flow`
* Remove scripts from `package.json`
* Remove type imports from components and modules

#### Redux

* Remove `src/actions`, `src/constants`, `src/containers`, `src/reducers` and any other Redux-related modules
* Remove Redux-related imports from `src/index.jsx`
* Remove packages `react-redux`, `redux`: `yarn remove redux react-redux`
* Unwrap `App` from `<Provider>` in `src/index.jsx`

#### Travis

* Remove `.travis.yml` and badge from `README.md`

#### Docker

* Remove `Dockerfile`, `docker-compose.yml`

#### CSS Modules

* Remove `modules` from `css-loader` in `webpack.config.js`

