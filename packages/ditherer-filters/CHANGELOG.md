# Changelog

All notable changes to `@gyng/ditherer-filters` are documented here. The
package follows semantic versioning.

## [0.2.0] - 2026-07-16

### Added

- Stable per-filter subpath imports under `filters/*`.
- An implementation-free metadata catalog and lazy canonical loader.
- Deterministic registry-derived generation and bundle-size contracts.
- A standalone packed-package example covering direct imports, lazy loading,
  sessions, workers, WASM readiness, and explicit cleanup.

### Fixed

- Ordered dithering now applies Nearest palette levels independently of the
  threshold map's quantization levels.

## [0.1.1] - 2026-07-16

### Changed

- Declared the filter package as an npm workspace and an explicit Ditherer
  application dependency.
- Added a release gate that builds the real Ditherer app against the packed
  tarball and verifies its module worker and RGB-to-Lab WASM payload.
- Restricted legacy engine implementation aliases to Vitest so production
  application builds consume only the public package entries.
- Added a documented, reproducible GitHub Packages release procedure.

## [0.1.0] - 2026-07-16

### Added

- Initial React-independent filter catalog and session runtime.
- Canvas2D, WebGL2, worker, temporal-state, palette, and optional WASM support.
- Root, client, worker, and WASM-bindings public entries with generated types.
- Packed consumer, browser, application, and complete shader-registry gates.
