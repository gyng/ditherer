# `@gyng/ditherer-filters`

Browser-native image filters extracted from Ditherer. The package is
React-independent and operates on `HTMLCanvasElement` or `OffscreenCanvas`.

## Install from GitHub Packages

GitHub's npm registry requires authentication for installs. Create a classic
personal access token with `read:packages`, expose it as
`GITHUB_PACKAGES_TOKEN`, and add this to the consuming project's `.npmrc`:

```ini
@gyng:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```

Then install the package:

```sh
npm install @gyng/ditherer-filters
```

```ts
import { createFilterSession } from "@gyng/ditherer-filters";

const session = createFilterSession([
  { id: "mono", filter: "Grayscale" },
  { id: "dither", filter: "Floyd-Steinberg" },
]);

const { canvas } = await session.process(inputCanvas);
outputContext.drawImage(canvas, 0, 0);

session.dispose();
```

Use a session for video or temporal filters: it owns the previous-frame and
moving-average state associated with each chain-entry ID. For a one-off chain,
`runFilterChain(input, chain)` is also available.

For a small application that only needs one filter, import its stable subpath
without loading the complete registry:

```ts
import grayscale from "@gyng/ditherer-filters/filters/grayscale";

const output = await grayscale.func(inputCanvas, grayscale.defaults);
```

The serializable metadata catalog and lazy loader are separate entries:

```ts
import { filterCatalog } from "@gyng/ditherer-filters/catalog";
import { loadFilter } from "@gyng/ditherer-filters/lazy";

const definition = await loadFilter("Floyd-Steinberg");
```

`filterCatalog` contains picker metadata but no executable definitions. The
lazy entry emits one chunk per public filter module in modern bundlers. See
[`examples/filter-library`](../../examples/filter-library) for direct, lazy,
session, worker, WASM-readiness, and cleanup usage against a packed artifact.

The package is the source owner for the complete engine: the filter catalog,
palettes, Canvas2D/WebGL implementations, worker executor and client, and the
optional RGB-to-Lab WASM module all live under this package's `src/` tree.

Public entries:

- `@gyng/ditherer-filters` — catalog, palettes, utilities, and chain/session runtime
- `@gyng/ditherer-filters/client` — browser worker RPC client and wire types
- `@gyng/ditherer-filters/worker` — worker request executor for custom worker hosts
- `@gyng/ditherer-filters/wasm-bindings` — low-level generated WASM bindings
- `@gyng/ditherer-filters/catalog` — implementation-free picker metadata
- `@gyng/ditherer-filters/lazy` — on-demand canonical filter loading
- `@gyng/ditherer-filters/filters/*` — direct per-filter module imports

The client entry owns its module-worker URL, so bundlers copy and resolve the
worker asset with the installed package. Applications that only execute on the
main thread do not need to import it.

The first release target is a modern browser bundler. WebGL-only filters report
`requiresGL` in their definition; `glAvailable()` can be used for capability
checks. `wasmReady` resolves after the optional acceleration module initializes.

See [CHANGELOG.md](./CHANGELOG.md) for release notes and [RELEASING.md](./RELEASING.md)
for the verified GitHub Packages release procedure.
