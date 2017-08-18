# jsapp-boilerplate

[![Build Status](https://travis-ci.org/gyng/jsapp-boilerplate.svg?branch=master)](https://travis-ci.org/gyng/jsapp-boilerplate)

A personal JavaScript boilerplate for frontend applications for near-production use. Production deployment will require additional work depending on where and how you plan to deploy your application.

The stack is somewhat similar to [generator-react-webpack-redux](https://github.com/stylesuxx/generator-react-webpack-redux), but adds linting, flow, enzyme, and some basic deployment niceties.

This boilerplate contains:

| **Presentation, state**                                                   |                              |
|---------------------------------------------------------------------------|------------------------------|
| [react](https://facebook.github.io/react/docs/hello-world.html)           | ui framework                 |
| [redux](http://redux.js.org/)                                             | state management             |
| [react-redux](http://redux.js.org/docs/basics/UsageWithReact.html)        | react-redux integration      |
| [react-router-redux](https://github.com/reactjs/react-router-redux)       | routing                      |
| [redux-thunk](https://github.com/gaearon/redux-thunk)                     | async actions                |
| [postcss](https://github.com/postcss/postcss)                             | css modules, cssnext, precss |
| **Testing, linting**                                                      |                              |
| [mocha](https://mochajs.org/#getting-started)                             | test framework               |
| [chai](http://chaijs.com/guide/styles/)                                   | test assertions              |
| [enzyme](http://airbnb.io/enzyme/index.html)                              | react test library           |
| [flow](https://flowtype.org/docs/getting-started.html)                    | type checking                |
| [eslint](http://eslint.org/docs/rules/)                                   | javascript linting           |
| [prettier](https://github.com/prettier/prettier/)                         | javascript formatting        |
| [stylelint](https://stylelint.io/user-guide/)                             | css linting                  |
| [karma](http://karma-runner.github.io/1.0/config/configuration-file.html) | test runner                  |
| **Building, CI, deploying**                                               |                              |
| [webpack](https://webpack.js.org/concepts/)                               | javascript bundler           |
| [docker](https://docs.docker.com/engine/reference/builder/)               | container                    |
| [docker-compose](https://docs.docker.com/compose/compose-file/)           | multi-container              |
| [travis](https://docs.travis-ci.com/user/customizing-the-build)           | ci                           |

## Usage

Also see: [Getting started](doc/getting_started.md), [Removing bits and pieces](doc/customization.md),
[Running tests in a Docker Container](doc/docker_tests.md)

### Build

    yarn install
    NODE_ENV=production yarn run build  # minifies in production

### Test

    yarn test
    yarn lint                       # runs flow, eslint, stylelint
    yarn eslint
    yarn eslint:fix
    yarn prettier                   # prettier style enforced by eslint
    yarn prettier:fix
    yarn stylelint
    yarn flow

### Develop

    yarn flow-typed install
    yarn test:watch                 # runs tests using karma in watch mode
    yarn d                          # runs webpack-dev-server

### Deploy

    docker-compose up               # runs http-server at port 8080 on a production build in a container

