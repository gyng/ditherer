# Ditherer Modernization & Bug Fix Plan

## Project Summary

Ditherer is a browser-based image/video processing tool with dithering algorithms, pixel sorting, glitching, CRT emulation, convolution filters, and palette extraction. Built with React + Redux + Webpack, with a Rust/WASM module for color space conversions.

**Current state:** Core JS dependencies are 5-7 years behind. Multiple confirmed bugs in image processing logic. Build tooling uses deprecated/beta packages. Still functional but increasingly fragile.

---

## Phase 1: Bug Fixes

Logic errors that produce incorrect output. Fix before any dependency upgrades.

### 1.1 Luminance operator precedence (HIGH)

**File:** `src/utils/index.js:33-38`

```javascript
// BROKEN — alpha only multiplies blue channel due to operator precedence
export const luminanceItuBt709 = (c: ColorRGBA) =>
  0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] * (c[3] / 255);

export const luminance = (c: ColorRGBA) =>
  0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] * (c[3] / 255);
```

**Fix:** Parenthesize so alpha scales the entire result:

```javascript
export const luminanceItuBt709 = (c: ColorRGBA) =>
  (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) * (c[3] / 255);

export const luminance = (c: ColorRGBA) =>
  (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) * (c[3] / 255);
```

### 1.2 Luminance assumes linear RGB (HIGH)

Both luminance functions operate on raw sRGB values without gamma linearization. The BT.709/BT.601 coefficients assume linear-light RGB. For correct results, inputs should be linearized first (inverse sRGB companding: `c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`). Note: the existing `gamma` utility (`src/utils/index.js:551`) is a simple power-curve function, not sRGB linearization — a dedicated `linearize` function is needed.

**Fix:** Default to gamma-correct (linearized) luminance, but add a toggle so users can switch to the perceptual/sRGB version. The perceptual version is sometimes preferred for artistic dithering effects.

### 1.3 Equalize min/max uses loop index instead of value (HIGH)

**File:** `src/utils/index.js:63-66`

```javascript
// BROKEN — compares loop counter `i` instead of pixel value `val`
for (let i = 1; i < input.length; i += 1) {
  const val = input[i];
  if (i < min) min = val;   // should be: if (val < min)
  if (i > max) max = val;   // should be: if (val > max)
}
```

**Impact:** Histogram equalization produces incorrect results for all images.

### 1.4 Palette lookup in setFilterOption (MEDIUM)

**File:** `src/actions/index.js:175-184`

`setFilterOption` implicitly looks up palette names, so any string value matching a palette name gets replaced with a palette object. The test for this is skipped (`xit`). Fix by removing the implicit lookup and using the dedicated `setFilterPaletteOption` action instead.

### 1.5 Halftone edge handling missing (MEDIUM)

**File:** `src/filters/halftone.js:70`

Grid sampling doesn't handle image edges when width/height isn't divisible by grid size. Clamp sample coordinates to image bounds.

### 1.6 Duplicate HSVA sort key in pixel sort (LOW)

**File:** `src/filters/pixelsort.js:102-119`

Two entries use `[COMPARATOR.HSVA]` as the key with identical bodies. The second overwrites the first (no-op). `SVHA` and `VSHA` already exist with distinct implementations. **Fix:** Delete the duplicate entry (lines 111-119).

### 1.7 Halftone palette quantization order (LOW)

**File:** `src/filters/halftone.js:86`

FIXME: `"this is wrong(?), should apply nearest here and palette later in colors"`. Current code calls `palette.getColor(meanColor)` to quantize the mean grid color. **Action:** Investigate by testing with different palettes. If behavior is correct, replace the FIXME with a clarifying comment. If not, split into separate nearest-match and palette-quantization steps.

### 1.8 Pixel sort spiral termination (LOW)

**File:** `src/filters/pixelsort.js:295`

Spiral traversal hardcodes termination at `(0, 0)` instead of the correct corner. May miss edge pixels.

---

## Phase 2: Migrate Webpack to Vite

### 2.1 Replace Webpack + Babel with Vite

**Current:** Webpack 5 + Babel 7 beta + css-loader + style-loader + postcss-loader + file-loader + html-webpack-plugin + compression-webpack-plugin

**Target:** Vite (handles CSS Modules, PostCSS, asset imports, HTML, and dev server natively)

- Create `vite.config.js` (plain JS — TypeScript not yet available until Phase 4):
  - `@vitejs/plugin-react` (replaces Babel loader + preset-react)
  - `vite-plugin-wasm` + `vite-plugin-top-level-await` for WASM support
  - CSS Modules enabled by default (`.module.css` convention)
  - `build.outDir: 'build'` to match current output
  - `base: './'` for production (relative paths, matches current `publicPath`)
  - `resolve.alias: { '@src': '/src' }` to preserve existing alias
- Move `src/index.html` to project root, add `<script type="module" src="/src/index.jsx">`
- Delete `webpack.config.js`
- Switch yarn → npm:
  - Delete `yarn.lock`, run `npm install` to generate `package-lock.json`
  - Replace `yarn run` → `npm run` in package.json scripts (3 references)
- Update `package.json` scripts:
  - `"dev": "vite"`, `"build": "vite build"`, `"preview": "vite preview"`
  - Remove `deploy`/`deploy:prebuilt` scripts (replaced by GitHub Actions, see 2.3)
- WASM: current import `import("wasm/rgba2laba/wasm/rgba2laba")` resolves via webpack's module resolution to `src/wasm/rgba2laba/wasm/rgba2laba.js`. Verify this path works under Vite's resolver or adjust to a relative import
- Remove dependencies:
  - Build: `webpack`, `webpack-cli`, `webpack-dev-server`
  - Babel: `@babel/core`, all `@babel/plugin-*` (6), all `@babel/preset-*` (4), `babel-loader`
  - CSS: `css-loader`, `style-loader`, `postcss-loader`
  - Other: `file-loader`, `html-webpack-plugin`, `compression-webpack-plugin`

### 2.2 Migrate SCSS → plain CSS, drop PostCSS plugins

SCSS usage is minimal (5 variables, nesting) — both are native CSS now. Convert instead of keeping `sass` as a dep.

4 files to convert:
- `src/styles/style.scss` → `src/styles/style.module.css`
- `src/styles/example.scss` → `src/styles/example.module.css`
- `src/components/App/styles.scss` → `src/components/App/styles.module.css`
- `src/components/controls/styles.scss` → `src/components/controls/styles.module.css`

All 4 are imported as named imports (`import s from "./styles.scss"`) — they are CSS Modules. Rename to `.module.css` for Vite's convention.

Steps:
- Convert 5 SCSS variables → CSS custom properties (`$light-gray` → `--light-gray`, etc.) defined in a `:root` block
- Nesting works in native CSS (baseline 2023)
- `composes` works in plain CSS Modules — no change needed
- Update import paths in components (`import s from "./styles.module.css"`)
- Delete `postcss.config.js` — no PostCSS plugins needed
- Delete `.stylelintrc` — recreate with updated config if keeping stylelint
- Remove all PostCSS/CSS deps: `postcss-cssnext`, `precss`, `postcss-browser-reporter`, `postcss-import`, `postcss-reporter`, `autoprefixer`
- **Do not refactor CSS selectors, layout, or structure** — only variable syntax and file extensions change

### 2.3 Deploy via GitHub Actions instead of `gh-pages`

- Add `.github/workflows/deploy.yml`: build with Vite, deploy to GitHub Pages via `actions/deploy-pages`
- Remove `gh-pages` npm package
- Deployments triggered by push to `master` instead of manual npm script

---

## Phase 3: React Modernization + Drop Redux

Scope: 3 class components, 3 container files, 1 reducer, 1 route.

### 3.1 Upgrade React 16.2 → 18 + convert to hooks

3 class components to convert:
- `src/components/App/index.jsx` — `App` (uses `componentWillUpdate`)
- `src/components/App/Exporter.jsx` — `Exporter`
- `src/components/controls/ColorArray.jsx` — `ColorArray`

Steps:
- Replace `ReactDOM.render()` with `createRoot()` (`src/index.jsx:93`)
- Convert class components → function components with hooks
- Remove `react-addons-test-utils` (removed since React 16)
- Remove `prop-types` (redundant once TypeScript arrives in Phase 4)
- Add `<React.StrictMode>` wrapper

### 3.2 Replace Redux with React Context + `useReducer`

Redux is overkill for this project: 1 reducer slice, 13 state properties, 3 connected components all near the top level. Replace with zero-dependency React primitives.

- Create a `FilterContext` provider with `useReducer` using the existing reducer logic from `src/reducers/filters.js`
- Delete container files (`src/containers/App.js`, `Controls.js`, `Exporter.js`) — components consume context directly via `useContext`
- Convert 4 async thunks (`loadImageAsync`, `loadVideoAsync`, `loadMediaAsync`, `filterImageAsync`) to plain `useCallback` functions that call `dispatch` directly
- Delete `src/constants/actionTypes.js` — use the reducer's action types inline or as a simple enum
- Remove Redux DevTools wiring (`src/index.jsx:29-34`)
- Replace `lodash.memoize` with a simple inline `Map`-based memoizer (single usage at `src/utils/index.js:221`, memoizes `wasmRgba2laba`)
- Remove dependencies: `redux`, `react-redux`, `redux-thunk`, `lodash.memoize`
- Remove unused `router` reducer state (never read by any component)

### 3.3 Upgrade React Router 4.2 → 6

Current usage is minimal (single root route), but keeping the router to preserve architecture.

- Replace `ConnectedRouter` (from `react-router-redux`) with `<BrowserRouter>` from `react-router-dom`
- Replace `<Route path="/" component={App} />` with `<Route path="/" element={<App />} />`
- Remove `react-router-redux`, `react-router` (peer dep of v6, auto-installed), and `history` deps

---

## Phase 4: Migrate Flow → TypeScript

- Rename `.js/.jsx` → `.ts/.tsx` (including `vite.config.js` → `vite.config.ts`)
- Replace Flow annotations with TypeScript equivalents
- Add `tsconfig.json`
- Remove Flow dependencies: `flow-bin`, `flow-typed`
- Remove `.flowconfig`
- Vite handles TypeScript natively via esbuild (no separate loader needed)
- Define proper types for `ColorRGBA`, `SortDirection`, filter options, context state

### 4.1 ESLint modernization (paired with TS migration)

- Upgrade `eslint@4` → `eslint@9` (flat config)
- Replace `babel-eslint` with `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin`
- Replace `eslint-config-airbnb` with `typescript-eslint` recommended config + `eslint-plugin-react`
- Remove: `eslint-config-airbnb`, `eslint-plugin-import`, `eslint-plugin-jsx-a11y`, `eslint-import-resolver-webpack`, `eslint-plugin-flowtype`, `eslint-plugin-mocha`
- Upgrade: `eslint-config-prettier`, `eslint-plugin-prettier`, `eslint-plugin-react`

---

## Phase 5: Testing Infrastructure

### Current stack (all outdated):
- Karma 2.0 (test runner) — deprecated
- Mocha 5.0 (test framework)
- Chai (assertions)
- Nightmare (headless browser, via karma-nightmare) — abandoned
- Enzyme (React testing) — abandoned
- `sinon`, `redux-mock-store` — installed but unused in any test file

### Target stack:
- **Vitest** (test runner + framework + assertions — shares Vite config)
- **React Testing Library** (component testing)
- **Playwright** (E2E if needed)

### Migration steps:
1. Install Vitest + React Testing Library
2. Configure Vitest (shares Vite config)
3. Migrate 3 existing test files (`test/actions/`, `test/reducers/`, `test/utils/`). Note: actions and reducers tests need rewriting to match Phase 3's Context + useReducer structure
4. Un-skip the `xit` test for `setFilterOption` after bug 1.4 is fixed
5. Remove: `karma`, `karma-chai`, `karma-mocha`, `karma-mocha-reporter`, `karma-nightmare`, `karma-sourcemap-loader`, `karma-webpack`, `enzyme`, `enzyme-adapter-react-16`, `mocha`, `chai`, `sinon`, `redux-mock-store`, `react-addons-test-utils`, `react-test-renderer`

---

## Phase 6: Code Cleanup

### 6.1 Remove dead code
- Commented-out `debugger` statement (`src/filters/pixelsort.js:219`)
- Commented-out WASM function (`src/utils/index.js:182-185`)

### 6.2 Unify buffer function signatures

`fillBufferPixel` takes `(buf, i, r, g, b, a)` while `addBufferPixel` takes `(buf, i, colorArray)`. Unify to use the same pattern.

### 6.3 Replace console statements with proper error handling
- `src/index.jsx:87` — console.warn
- `src/reducers/filters.js:204, 232` — console.warn
- `src/utils/index.js:173, 178` — console.error (WASM load fallback)
- `src/filters/program.js:83` — console.error (user-provided program eval failure — may be intentional)

### 6.4 WASM error handling
- Add `.catch()` to WASM dynamic import (`src/utils/index.js:21-27`)
- Surface WASM load failures to the UI instead of silent console.error fallback

---

## Phase 7: WASM / Rust

- Rust `rgba2laba` crate uses `edition = "2018"` — update to `2021`
- Verify `wasm-bindgen` is current (migrated from `stdweb` in 2020)
- Document WASM MIME type requirement (`application/wasm`) for deployment
- Consider pre-building WASM and committing the artifact — simplifies GitHub Actions workflow (no Rust toolchain needed in CI)

---

## Dependency Summary

### Remove (60 packages)

| Package | Reason |
|---------|--------|
| `webpack`, `webpack-cli`, `webpack-dev-server` | → Vite |
| `@babel/core`, `@babel/plugin-*` (6), `@babel/preset-*` (4), `babel-loader` | → Vite (esbuild) |
| `babel-eslint` | → @typescript-eslint/parser |
| `css-loader`, `style-loader`, `postcss-loader`, `file-loader` | → Vite (native) |
| `html-webpack-plugin`, `compression-webpack-plugin` | → Vite (native) |
| `postcss-cssnext`, `precss`, `postcss-browser-reporter`, `postcss-import`, `postcss-reporter` | Deprecated / not needed |
| `autoprefixer` | → Vite Lightning CSS |
| `eslint-config-airbnb`, `eslint-plugin-import`, `eslint-plugin-jsx-a11y` | → typescript-eslint recommended |
| `eslint-import-resolver-webpack`, `eslint-plugin-flowtype`, `eslint-plugin-mocha` | No longer needed |
| `flow-bin`, `flow-typed` | → TypeScript |
| `redux`, `react-redux`, `redux-thunk` | → Context + useReducer |
| `lodash.memoize` | → inline Map-based memoizer (1 usage) |
| `react-router-redux`, `react-router`, `history` | Deprecated / peer dep |
| `gh-pages` | → GitHub Actions |
| `prop-types` | → TypeScript |
| `karma`, `karma-chai`, `karma-mocha`, `karma-mocha-reporter`, `karma-nightmare`, `karma-sourcemap-loader`, `karma-webpack` | → Vitest |
| `enzyme`, `enzyme-adapter-react-16`, `react-addons-test-utils`, `react-test-renderer` | → React Testing Library |
| `mocha`, `chai`, `sinon`, `redux-mock-store` | → Vitest (sinon/mock-store unused) |

### Upgrade (10 packages)

| Package | Current | Target |
|---------|---------|--------|
| react | 16.2.0 | 18.x |
| react-dom | 16.2.0 | 18.x |
| react-router-dom | 4.2.2 | 6.x |
| react-draggable | 3.0.5 | 4.x |
| eslint | 4.18.2 | 9.x |
| eslint-config-prettier | 2.9.0 | 10.x |
| eslint-plugin-prettier | 2.6.0 | 5.x |
| eslint-plugin-react | 7.7.0 | 7.37+ |
| stylelint | 9.1.3 | 16.x |
| stylelint-config-standard | 18.2.0 | 37.x |

### Add (9 packages)

| Package | Purpose |
|---------|---------|
| `vite` | Build tool / dev server |
| `@vitejs/plugin-react` | React JSX/TSX support |
| `vite-plugin-wasm` | WASM import support |
| `vite-plugin-top-level-await` | Top-level await for WASM |
| `vitest` | Test runner |
| `@testing-library/react` | Component testing |
| `typescript` | Type checking |
| `@typescript-eslint/parser` | ESLint TS parser |
| `@typescript-eslint/eslint-plugin` | ESLint TS rules |

### Keep (2 packages)

| Package | Why |
|---------|-----|
| `pako` | Used by glitchblob filter for PNG deflate/inflate |
| `prettier` | Code formatting (no config file — uses defaults) |

### Also delete (config files)

- `webpack.config.js`
- `postcss.config.js`
- `karma.conf.js`
- `.travis.yml` (dead — Node 8.4, Travis CI, replaced by GitHub Actions)
- `.flowconfig`
- `.eslintrc` + `.eslintignore` (replaced by ESLint 9 flat config)
- `.stylelintrc` + `.stylelintignore` (recreate as flat config)
- `.nvmrc` (replace with `engines` field in `package.json`)
- `yarn.lock` (replace with `package-lock.json` via `npm install`)
- `Dockerfile`, `docker-compose.yml`, `docker-compose.override.yml`, `.dockerignore` (Node 7.5.0, dead)
- `flow-typed/` (entire directory — 20+ Flow type stubs)

---

## Execution Order

```
Phase 1 (bugs)      ████░░░░░░  Fix logic errors first
Phase 2 (build)     ██████░░░░  Webpack → Vite, SCSS → CSS, GitHub Actions
Phase 3 (React)     ████████░░  React 18 + drop Redux + hooks
Phase 4 (types)     ██████░░░░  Flow → TypeScript + ESLint 9
Phase 5 (tests)     ████░░░░░░  Vitest + React Testing Library
Phase 6 (cleanup)   ███░░░░░░░  Dead code, console statements
Phase 7 (WASM)      ██░░░░░░░░  Rust edition + wasm-bindgen
```

Fix bugs first so they don't get lost in the noise of dependency upgrades. Migrate to Vite next — this is the biggest infrastructure change but gives you a fast dev server and validates that imports/CSS/WASM all work before touching application code. Then React — drop Redux entirely (→ Context + useReducer), convert 3 class components to hooks, delete 3 container files. ESLint is paired with the TS migration since the parser changes anyway. Vitest shares Vite's config, making Phase 5 straightforward once Phase 2 is done.

### Net result

- **Dependencies:** 72 → 21 (60 removed, 9 added, 10 upgraded, 2 kept)
- **Config/infra files deleted:** 15 (`webpack.config.js`, `postcss.config.js`, `karma.conf.js`, `.travis.yml`, `.flowconfig`, `.eslintrc`, `.eslintignore`, `.stylelintrc`, `.stylelintignore`, `.nvmrc`, `.dockerignore`, `yarn.lock`, `Dockerfile`, `docker-compose.yml`, `docker-compose.override.yml`)
- **Directories deleted:** 1 (`flow-typed/`)
- **Source files deleted:** 4 (`src/containers/App.js`, `Controls.js`, `Exporter.js`, `src/constants/actionTypes.js`)
