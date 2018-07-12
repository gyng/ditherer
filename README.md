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
| [typesafe-actions](https://github.com/piotrwitek/typesafe-actions)        | typesafe action creator      |
| [postcss](https://github.com/postcss/postcss)                             | css preprocessing, styling   |
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
| [configuration](config/configValues.js)                                   | configuration                |
| [webpack](https://webpack.js.org/concepts/)                               | javascript bundler           |
| [docker-compose](https://docs.docker.com/compose/compose-file/)           | multi-container              |
| [travis](https://docs.travis-ci.com/user/customizing-the-build)           | ci                           |
| [docker](https://docs.docker.com/engine/reference/builder/)               | ci, production server        |
| [github pages](https://pages.github.com/)                                 | deployment, online hosting   |

[Ditherer](https://github.com/gyng/ditherer) is a project built using an older version of this boilerplate.

## Usage

Also see: [Getting started](doc/getting_started.md), [Running tests in a Docker Container](doc/docker_tests.md)

### Build

    yarn install
    yarn build                      # development build, outputs in /dist
    yarn build:production           # builds for the Docker image in /dist
    yarn build:github               # builds for GitHub Pages in /dist

Set the environment variable `APP_ENV=github` if preparing a prebuilt bundle for GitHub Pages. `yarn deploy:github` will set this `APP_ENV` for you and deploy it straight to GitHub Pages.

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
    yarn test:docker                # runs the full test suite in Docker

### Develop

    yarn d                          # runs webpack-serve (yarn dev) or use
    yarn d:hot                      # runs webpack-serve in hot reload mode (yarn dev:hot)
    yarn test:watch                 # runs unit tests using karma in watch mode

### Deploy

    yarn deploy:github              # deploys a production build to GitHub pages
    yarn docker                     # runs superstatic at port 8080 on a production build in Docker

### Update

There isn't a nice solution to this problem. Creating something like create-react-app's eject mechanism is not good enough as it's difficult to both maintain and avoid ejection in any sufficiently complex app. A hackish strategy around this is to add the boilerplate repo as an upstream remote in git, and cherry-pick commits or tags into your application.

    git remote add upstream git@github.com:gyng/jsapp-boilerplate.git
    git fetch
    git cherry-pick $START_COMMIT~1..$END_COMMIT
