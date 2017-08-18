# Getting started

1. This boilerplate depends on [node](https://nodejs.org/en/download/) and [yarn](https://yarnpkg.com/lang/en/docs/install/).

   It also uses [ESLint](http://eslint.org/), [stylelint](https://stylelint.io/), and [flow](https://flowtype.org/). Linter plugins should be set up in your editor of choice before starting development work.

   Optionally, you will need [Docker](https://docs.docker.com/engine/installation/) and [Docker Compose](https://docs.docker.com/compose/install/) to run the provided docker image.

   You want to have an understanding of [React](https://facebook.github.io/react/tutorial/tutorial.html#what-is-react) and [Redux](http://redux.js.org/#the-gist) before you start.

2. Check out this repo and [change the remotes to your own repository](https://help.github.com/articles/changing-a-remote-s-url/)
    ```
    git clone git@github.com:gyng/jsapp-boilerplate.git
    cd jsapp-boilerplate
    git remote set-url origin <YOUR_ORIGIN>
    ```

3. Install dependencies…
    ```
    yarn install
    ```

4. …and take a quick tour of the repository!

   The entrypoint is [`src/index.html`](/src/index.html). An index component [`src/index.jsx`](/src/index.jsx) is injected into the html file on build.

   The main component in `index.jsx` is [`App`](/src/components/App/index.jsx).

5. Shared flow type definitions are in [`src/types/index.js`](/src/types/index.js) and [`flow/*.js.flow`](/flow) (for webpack)

   Installed (via `yarn run flow-typed install`) type definitions are in `/flow-typed`.  Add `// @flow` to all files which need checking.

6. Check out the tests in [`test`](/test). Note that test files are not checked by flow.

7. Try out some of the scripts defined in [`package.json`](/package.json)
    ```
    yarn run lint
    yarn run test
    ```

8. For development, the watchers can be run. `yarn run d` starts a development webpack server.
    ```
    yarn run test:watch
    yarn run d
    ```

9. [Remove the bits you do not want](customization.md#removing-bits-and-pieces), if you wish

10. Check out the [webpack configuration](/webpack.config.js). `src` is added as a module directory under `resolve.modules` to eliminate clunky imports.

11. Check out the [postcss configuration](/postcss.config.js). Installed PostCSS plugins are listed here.

12. Try running the [Docker image](/Dockerfile) with Docker Compose ([compose configuration](/docker-compose.yml))
    ```
    docker-compose up
    ```

13. Remove demo-related things from `doc`, `src` and `test`, and start developing! (Or just keep them for reference for now.)
