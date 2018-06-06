# Getting started

1. This boilerplate depends on [node](https://nodejs.org/en/download/) and [yarn](https://yarnpkg.com/lang/en/docs/install/).

   It also uses [ESLint](http://eslint.org/), [TSLint](https://palantir.github.io/tslint/), [stylelint](https://stylelint.io/), [Prettier](https://prettier.io), and [TypeScript](https://www.typescriptlang.org/). Linter plugins should be set up in your editor of choice before starting development work.

   Optionally, you will need [Docker](https://docs.docker.com/engine/installation/) and [Docker Compose](https://docs.docker.com/compose/install/) to run the provided docker image.

   You want to have an understanding of [React](https://facebook.github.io/react/tutorial/tutorial.html#what-is-react) and [Redux](http://redux.js.org/#the-gist) before you start.

2. Check out this repo and [change the remotes to your own repository](https://help.github.com/articles/changing-a-remote-s-url/)
    ```
    git clone git@github.com:gyng/jsapp-boilerplate.git <YOUR_PROJECT_NAME>
    cd <YOUR_PROJECT_NAME>
    git remote set-url origin <YOUR_ORIGIN>
    ```

3. Install dependencies…
    ```
    yarn install
    ```

4. …and take a quick tour of the repository!

   The entrypoint is [`src/index.html`](/src/index.html). An index component [`src/index.tsx`](/src/index.tsx) is injected into the html file on build.

   The main component in the index component is [`App`](/src/components/App/index.tsx).

5. Check out the tests in [`test`](/test). Note that test files are not TypeScript. Functional tests are in [`test/functional`](/test/functional).

6. Try out some of the scripts defined in [`package.json`](/package.json)
    ```
    yarn run lint
    yarn run test
    yarn run test:functional
    ```

    If tests do not run (eg. Nightmare fails to start locally on Windows), you need to run `xfvb` locally to get the tests running. (Improve me: this is clunky)

    ```
    export DISPLAY=':99.0'
    Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 & yarn test:full
    ```

    Alternatively, there is a `Dockerfile.test.dockerfile` that runs tests in a Docker image and can be run using `docker-compose -f docker-compose.test.yml up --build`.

7. For development, the watchers can be run. `yarn d` starts a development webpack server. `yarn d:hot` runs a dev session with hot reload.
    ```
    yarn run test:watch
    yarn run d
    ```

8. Check out the [webpack configuration](/webpack.config.js).

9. Check out the styling options [emotion JS-in-CSS](/src/components/App/index.tsx) and [CSS escape hatch](/src/styles/root.css). Styling is intended to be done through emotion, but the escape hatch is available for   legacy libraries and manual control. Legacy styles need to have a filename ending in `.css`, and are included using `require` instead of `import`.

10. Try running the [Docker image](/Dockerfile) with Docker Compose ([compose configuration](/docker-compose.yml))
    ```
    docker-compose up
    ```

11. Remove demo-related things from `doc`, `src`, `test` (and `test/functional`), and start developing! (Or just keep them for reference for now.)

12. Prepare a build for deployment by running `yarn build:prod`. The output files will be located in `dist/`.

13. Deployment to GitHub pages is done using the `gh-pages` package and can be run using `deploy:github`. This will create a production build and push it to the `gh-pages` branch of the repository on GitHub.
