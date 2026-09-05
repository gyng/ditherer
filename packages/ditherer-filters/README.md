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

Await each `session.process()` before submitting another frame; overlapping calls
reject instead of racing the session's history. `reset()`, `dispose()`, and
`setChain()` invalidate pending processing at its next cancellation checkpoint,
so stale work cannot write history into the changed session. As with
`shouldAbort`, the pending call returns the steps completed before cancellation.

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

### Temporal history allocation

Built-in filters declare the previous-frame buffers they consume through
`history: { prevInput: true, prevOutput: true, ema: true }`, selecting only the
needed fields. Built-ins without a declaration need no injected history; their
animation clock and internal simulation state continue to work normally.
Worker step previews are retained separately from temporal history.

Custom filter definitions without `history` retain all three buffers for
compatibility. Set `history: {}` for a stateless custom filter, or enable only the
buffers it reads. This avoids unnecessary pixel readbacks, allocations, and EMA
updates. `getFilterHistory(filter)` resolves the effective requirements.

Idle canvases are cached up to 64 MiB of estimated RGBA storage and 64 canvases
across all dimensions. `clearCanvasPool()` releases only idle backing stores;
`disposeSharedFilterResources()` also clears this cache. Checked-out canvases
remain owned by their callers.
