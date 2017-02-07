# jsapp-boilerplate

[![Build Status](https://travis-ci.org/gyng/jsapp-boilerplate.svg?branch=master)](https://travis-ci.org/gyng/jsapp-boilerplate)

A personal JavaScript boilerplate for frontend applications.

This boilerplate contains:

|              |                                         |
|--------------|-----------------------------------------|
| Presentation | React, CSS Modules                      |
| Store        | Redux*                                  |
| Test         | Karma, Enzyme, Chai, ESLint, Travis     |
| Build        | Webpack, Babel, Yarn, Flow              |
| Deploy       | Docker?*                                |

*to be implemented

## Usage

### Build

    yarn install
    NODE_ENV=production yarn run build  # minifies in production

### Test

    yarn run test
    yarn run lint

### Develop

    yarn run t  # runs tests using karma in watch mode
    yarn run d  # runs webpack-dev-server

### Deploy

    not implemented
