# Using typed CSS

In a large team or project, you might want to add checking of your CSS modules. This will require the generation of `.d.ts` definitions, so it will be more unwieldy.

1. Add typed-css-modules

    ```
    yarn add --dev typed-css-modules
    ```

2. Add scripts

    Add this to `package.json` under `scripts`

    ```
    "tcm:scss": "tcm -p **/src/**/*.pcss"
    ```

    Update the `tsc:check` script in `package.json` to generate typings before checking

    ```
    "tsc:check": yarn tcm:scss && ...
    ```

3. Optionally, add the generated typings to `.gitignore`

    ```
    *.pcss.d.ts
    ```

4. Update CSS `requires` to `imports` to enable the typechecking

    ```diff
    - const styles = require("./counter.pcss");
    + import styles from "./counter.pcss";
    ```

5. Generate the new definitions when needed with `yarn tcm:scss`. You can look into enabling watch mode for tcm, or add a webpack typed-css-modules loader to the build process.
