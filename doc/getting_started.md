# Getting started

1. This boilerplate depends on [node](https://nodejs.org/en/download/) and [yarn](https://yarnpkg.com/lang/en/docs/install/).

   It also uses [ESLint](http://eslint.org/), [stylelint](https://stylelint.io/), [Prettier](https://prettier.io), and [TypeScript](https://www.typescriptlang.org/). Linter plugins should be set up in your editor of choice before starting development work.

   Optionally, you will need [Docker](https://docs.docker.com/engine/installation/) and [Docker Compose](https://docs.docker.com/compose/install/) to run the provided docker image.

   You want to have an understanding of [React](https://facebook.github.io/react/tutorial/tutorial.html#what-is-react) and [Redux](http://redux.js.org/#the-gist) before you start.

2. Check out this repo and [change the remotes to your own repository](https://help.github.com/articles/changing-a-remote-s-url/)

   ```bash
   git clone git@github.com:gyng/jsapp-boilerplate.git <YOUR_PROJECT_NAME>
   cd <YOUR_PROJECT_NAME>
   git remote set-url origin <YOUR_ORIGIN> # Or rename origin to upstream
   ```

   You can rename `origin` to `upstream` if you want to cherry-pick commits from the boilerplate later on:

   ```bash
   git remote rename origin upstream
   ```

3. Install dependencies…

   ```
   yarn install
   ```

4. …and take a quick tour of the repository!

   The entrypoint is [`src/index.html`](/src/index.html). An index component [`src/index.tsx`](/src/index.tsx) is injected into the html file on build.

   The main component in the index component is [`App`](/src/components/App/index.tsx).

   Features are organised into `domains`, which are your domain objects (eg, books, users), and `features`, which are your app features (eg, book lists, user profiles). You will need to update `index.ts` in `src/features` and `src/domains`.

5. Check out the tests by searching for files that have `.test` in them. Tests can be run with `yarn t`. The full test suite, including linting can be run with `yarn ck`.

6. Try out some of the scripts defined in [`package.json`](/package.json)

   ```
   yarn run lint
   yarn run test
   ```

7. For development, the watchers can be run. `yarn d` starts a development webpack server with hot reload. `yarn d:nohot` runs a dev session without hot reload (does full page reloads on update).

   ```
   yarn run test:watch
   yarn run d
   ```

8. Check out the [webpack configuration](/webpack.config.js).

9. Check out the styling options [using PostCSS](/src/components/App/styles.pcss) and [CSS escape hatch](/src/styles/root.css). Use `require` to load styles. The escape hatch is available for legacy libraries and manual control. Legacy styles need to have a filename ending in `.css`.

10. Try running the [Docker image](/Dockerfile) with Docker Compose ([compose configuration](/docker-compose.yml))

    ```
    docker-compose up
    ```

11. Remove demo-related things from `doc` and `src`, and start developing! (Or just keep them for reference for now.)

12. Check out the app and build configuration settings in [`config/configValues.js`](/config/configValues.js)

13. Prepare a build for deployment by running `yarn build:prod`. The output files will be located in `dist/`.

14. Deployment to GitHub pages is done using the `gh-pages` package and can be run using `deploy:github`. This will create a production build with `APP_ENV` set to `github` and push it to the `gh-pages` branch of the repository on GitHub. Alternatively, there is a Github Actions workflow that does this for you.

15. Consult [doc: addons](./addons.md) for things you might want to add.
