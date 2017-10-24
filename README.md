# jsapp-boilerplate

[![Build Status](https://travis-ci.org/gyng/jsapp-boilerplate.svg?branch=master)](https://travis-ci.org/gyng/jsapp-boilerplate)

A personal JavaScript boilerplate for frontend applications for near-production use. Production deployment will require additional work depending on where and how you plan to deploy your application.

The stack is somewhat similar to [generator-react-webpack-redux](https://github.com/stylesuxx/generator-react-webpack-redux), but adds linting, TypeScript, testing, and some basic deployment niceties.
Code uses TypeScript for bug-catching, but tests use vanilla JavaScript for easier test-writing.

This boilerplate contains:

| **Presentation, state**                                                   |                              |
|---------------------------------------------------------------------------|------------------------------|
| [react](https://facebook.github.io/react/docs/hello-world.html)           | ui framework                 |
| [redux](http://redux.js.org/)                                             | state management             |
| [react-redux](http://redux.js.org/docs/basics/UsageWithReact.html)        | react-redux integration      |
| [react-router-redux](https://github.com/reactjs/react-router-redux)       | routing                      |
| [redux-thunk](https://github.com/gaearon/redux-thunk)                     | async actions                |
| [emotion](https://github.com/emotion-js/emotion)                          | css-in-javascript, styling   |
| [plain css](https://developer.mozilla.org/en-US/docs/Web/CSS)             | legacy css escape hatch      |
| **Testing, linting**                                                      |                              |
| [mocha](https://mochajs.org/#getting-started)                             | test framework               |
| [chai](http://chaijs.com/guide/styles/)                                   | test assertions              |
| [enzyme](http://airbnb.io/enzyme/index.html)                              | react test library           |
| [nightmare](https://github.com/segmentio/nightmare)                       | browser automation test lib  |
| [typescript](https://www.typescriptlang.org/docs/home.html)               | type checking                |
| [eslint](http://eslint.org/docs/rules/)                                   | javascript linting           |
| [tslint](https://palantir.github.io/tslint/rules/)                        | typescript linting           |
| [prettier](https://github.com/prettier/prettier/)                         | (type/java)script formatting |
| [stylelint](https://stylelint.io/user-guide/)                             | legacy css linting           |
| [karma](http://karma-runner.github.io/1.0/config/configuration-file.html) | test runner (with electron)  |
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
    NODE_ENV=production yarn build  # minifies in production

### Test

    yarn test                       # runs unit tests once
    yarn test:functional            # runs functional tests (nightmare browser tests)
    yarn test:full                  # runs unit tests and functional tests
    yarn test:watch                 # runs unit tests using karma in watch mode
    yarn lint                       # runs tslint, eslint, stylelint
    yarn tslint
    yarn tslint:fix
    yarn eslint
    yarn eslint:fix
    yarn prettier                   # prettier style enforced by eslint/tslint
    yarn prettier:fix
    yarn stylelint

### Develop

    yarn test:watch                 # runs unit tests using karma in watch mode
    yarn d                          # runs webpack-dev-server

### Deploy

    docker-compose up               # runs http-server at port 8080 on a production build in a container

### Future

* Combine TSLint and ESLint to use just ESLint once ESLint support for TypeScript is mature enough
* Add stylelint for emotion (once available)
* Remove custom emotion-theming .ts module def when they fix the definitions
