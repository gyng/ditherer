# 052 — Browser Filter Library Extraction

## Goal

Ship Ditherer's filter engine as a consumable, React-independent browser
library and make the Ditherer application use that same public runtime. The
first package target is modern browser bundlers with Canvas2D, OffscreenCanvas,
WebGL2, Web Workers, and optional WASM acceleration.

## Public boundary

The library owns:

- filter definitions, option metadata, palettes, and the canonical catalog;
- Canvas2D, WebGL2, and WASM filter implementations;
- ordered chain execution and per-entry temporal state;
- runtime capability reporting, reset, and disposal;
- direct stateless-filter convenience calls.

The application continues to own React context and controls, media loading,
animation scheduling, URL/local-storage state, audio modulation, previews, and
file export.

The library API must not expose the filters' private `_prevInput`,
`_prevOutput`, `_ema`, or backend-injection options. A `FilterSession` owns and
injects those values for each processed frame.

## Package shape

Create `packages/ditherer-filters` as the publishable package with:

- a root catalog/runtime entry point;
- a worker entry point;
- explicit type declarations and ESM package exports;
- a Vite library build from package-owned engine source which emits the WASM
  and module-worker assets;
- no React runtime dependency.

The package artifact must be self-contained and installable without
repository-relative imports. Application production code consumes the package
entry points rather than reaching into the engine source tree.

## Runtime contract

```ts
const session = createFilterSession([
  { id: "mono", filter: "Grayscale" },
  { id: "dither", filter: "Floyd-Steinberg", options: {/* overrides */} },
]);

const result = await session.process(inputCanvas, {
  frameIndex: 0,
  isAnimating: false,
});

session.reset();
session.dispose();
```

Requirements:

- accept canonical filter names or filter definitions;
- clone default option state so sessions cannot mutate the global catalog;
- preserve output dimensions, async filters, and chain ordering;
- provide WebGL-unavailable behavior consistent with the application;
- retain previous input/output and EMA state by stable chain-entry ID;
- surface per-step backend/timing information;
- allow acceleration and linear-light defaults at session creation;
- release pooled canvases/textures and temporal buffers on reset/disposal.

## Migration

1. Add the package manifest, build config, source entry points, and runtime.
2. Add durable unit tests for stateless execution, option merging, temporal
   frame state, unknown filters, reset, and ownership of catalog defaults.
3. Replace the duplicated main-thread loop in `FilterContext` with the library
   session runtime while retaining the app's scheduling, caching, audio option
   modulation, and worker selection.
4. Keep the current worker RPC wire format for compatibility, but export its
   request types and executor from the package worker entry point.
5. Pack/install the built tarball in a small fixture outside the package source
   tree and prove that it imports and processes a canvas.

## Release gates

- `npm run typecheck`
- targeted runtime, worker, registry, and app-context tests
- library package build and packed-package consumer test
- application production build
- `npm run test:gl`, because the package includes the complete shader registry

## True source ownership completion

The package must become the physical owner of the engine rather than building
through aliases into application source. Move this exact dependency closure
below `packages/ditherer-filters/src/`:

- `filters/`, `gl/`, `palettes/`, and `wasm/`;
- `constants/` because filter metadata and palette controls use those tokens;
- the worker executor, wire types, and browser RPC client;
- the core `utils/index.ts`, `utils/edges.ts`, `utils/glSinglePass.ts`,
  `utils/motionVectors.ts`, `utils/sampling.ts`, and `utils/workerFrames.ts`
  modules.

Audio-viz bridges, URL/share helpers, media helpers, random cycling, slow-filter
policy, and UI utilities remain application-owned. Application production
source must not import the old `filters`, `gl`, `palettes`, root `utils`,
`wasm`, or `workers` aliases after the migration; it consumes package exports.

Generate declarations with `tsc --emitDeclarationOnly` from the package source
on every package build. Remove handwritten declarations so the published API
cannot drift from implementation types.

## Later enhancements, not ownership blockers

- provide per-filter subpath exports for fine-grained bundles;
- replace the Vite-specific WASM bootstrap with bundler adapters if consumers
  require webpack/Rollup-without-Vite support;
- add a separate Node/pixel-buffer backend only if a non-browser use case is
  required.

## Initial distribution

The first registry target is GitHub Packages under
`@gyng/ditherer-filters`. The package manifest points at
`https://npm.pkg.github.com`, and `.github/workflows/publish-filters.yml`
publishes either a manually requested exact version or a matching
`filters-v<version>` tag using the repository's `GITHUB_TOKEN`.
