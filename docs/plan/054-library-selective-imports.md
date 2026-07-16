# 054 — Library Selective Imports

## Goal

Ship `@gyng/ditherer-filters@0.2.0` as both the complete Ditherer engine and a
practical dependency for smaller browser projects. Consumers must be able to
import or lazy-load one filter without pulling the complete catalog, while the
existing root API, worker, and WASM entries remain compatible.

## Correctness prerequisite

Fix Ordered dithering with the Nearest palette before changing package
topology. Ordered has two related level controls:

- the threshold map's level count controls the intermediate step used when
  matching a fixed color palette;
- the Nearest palette's `levels` option controls both the ordered-dither step
  and final per-channel quantization, so it can actually increase or decrease
  the output tone count.

The WebGL path must apply both. A regression test must prove that changing the
palette level reaches the renderer independently of the threshold-map level,
and the real-browser GL gate must continue to compile and draw every branch.

## Public API

- Preserve the complete `@gyng/ditherer-filters` root entry.
- Add `@gyng/ditherer-filters/catalog`, containing serializable filter metadata
  and no filter implementation imports.
- Add `@gyng/ditherer-filters/lazy`, exporting `loadFilter(name)` and the names
  it can resolve. Each loader must use a statically analyzable dynamic import so
  bundlers emit per-filter chunks.
- Add stable per-filter subpaths under
  `@gyng/ditherer-filters/filters/<module-name>`.
- Keep custom `FilterDefinition` chain entries supported by the runtime.

The catalog describes picker rows (`displayName`, `filterName`, `category`, and
`description`) but does not carry executable filter definitions or defaults.
Preset rows may share the same canonical `filterName`.

## Generated contract

The catalog, lazy-loader map, build entries, and package subpath exports are
derived from the authoritative filter registry. Generation must be
deterministic and checked in CI so a newly registered filter cannot silently be
missing from selective imports.

Only canonical public filter modules are exposed. Internal GL helpers,
factories, data tables, and implementation utilities are not package subpaths.

## Size contract

Build and measure a consumer that imports only one representative filter. Its
application JavaScript must not contain the full catalog chunk. Enforce a
generous compressed-size ceiling that catches accidental eager catalog imports
without coupling the test to harmless minifier changes.

The full root and worker entries remain intentionally large because they can
resolve every registered filter.

## Standalone packed consumer

Promote the packed-package fixture into a documented example that installs the
generated tarball and demonstrates:

1. direct per-filter import and processing;
2. lazy loading by canonical filter name;
3. a reusable temporal/session chain and disposal;
4. worker execution through the public client entry; and
5. WASM readiness through the public root API.

Both Node export smoke tests and a real Chromium run must resolve through the
packed artifact, never workspace source aliases.

## Release gates

- targeted Ordered regression test;
- generated-file freshness and catalog/loader/registry parity tests;
- TypeScript consumer compilation for every new public entry;
- selective-consumer bundle-size assertion;
- packed standalone consumer browser test covering worker and WASM wiring;
- `npm run lint`, `npm run typecheck`, and `npm run test`;
- ordinary and packed application production builds;
- `npm run test:gl`;
- version/tag validation for `filters-v0.2.0`.

Publish to GitHub Packages from the reviewed merge commit. npmjs publication is
an additional distribution target only when repository automation has an
explicit npm token and provenance configuration; it must never depend on a
developer's ambient local credentials.
