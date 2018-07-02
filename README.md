# jsapp-boilerplate

[![Build Status](https://travis-ci.org/gyng/jsapp-boilerplate.svg?branch=master)](https://travis-ci.org/gyng/jsapp-boilerplate)

A personal JavaScript boilerplate for frontend applications for near-production use. Production deployment will require additional work depending on where and how you plan to deploy your application as this boilerplate only provides deployment to GitHub pages.

This boilerplate contains:

| **Presentation, state**                                                   |                              |
|---------------------------------------------------------------------------|------------------------------|
| [react](https://facebook.github.io/react/docs/hello-world.html)           | ui framework                 |
| [redux](http://redux.js.org/)                                             | state management             |
| [react-redux](http://redux.js.org/docs/basics/UsageWithReact.html)        | react-redux integration      |
| [react-router-redux](https://github.com/reactjs/react-router-redux)       | routing                      |
| [redux-thunk](https://github.com/gaearon/redux-thunk)                     | async actions                |
| [postcss](https://github.com/postcss/postcss)                          | css preprocessing, styling   |
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

[Ditherer](https://github.com/gyng/ditherer) is a project built using an older version of this boilerplate.

## Usage

Also see: [Getting started](doc/getting_started.md), [Running tests in a Docker Container](doc/docker_tests.md)

### Build

    yarn install
    yarn build                      # test build, builds in /dist
    yarn build:prod                 # production build, builds in /dist

Set the environment variable `DEPLOY_TARGET=github` if preparing a prebuilt bundle for GitHub Pages. This sets the basename of react-router for hosting in a subdirectory (GitHub Pages does this). Configure the `basePaths` in [`webpack.config.js`](/webpack.config.js) to point to your repository name. `yarn deploy:github` will set this environment variable for you.

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
    docker-compose -f docker-compose.test.yml up --build

### Develop

    yarn d                          # runs webpack-serve (yarn dev) or use
    yarn d:hot                      # runs webpack-serve in hot reload mode (yarn dev:hot)
    yarn test:watch                 # runs unit tests using karma in watch mode

### Deploy

    yarn deploy:github              # deploys a production build to GitHub pages
    docker-compose up               # runs http-server at port 8080 on a production build in a container
    docker-compose up --build
