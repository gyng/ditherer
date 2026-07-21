# Changelog

All notable changes to `@gyng/ditherer-filters` are documented here. The
package follows semantic versioning.

## [0.3.0] - 2026-07-22

### Added

- Specification-grade and unusual display simulations covering PAL/SECAM,
  teletext, fax, Apollo slow-scan television, PXL-2000, Apple II HGR, ZX
  Spectrum, Game Boy Camera, Amiga HAM6, Baird mechanical television, CGA
  composite artifact color, PLATO plasma panels, and DLP sequential color.
- N-candidate ordered dithering, OKLab palette matching, and whole-buffer
  WASM-accelerated palette quantization paths.
- A reusable boundary-seeded RGBA16F jump-flood distance field plus SDF Boolean
  Sculpt, SDF Medial Axis, and animated SDF Flow Warp filters.
- Expanded shader, worker, backend-parity, malformed-state, temporal, and
  output-contract validation across the public filter registry.

### Changed

- SDF Stylize now uses a true signed boundary distance instead of an unsigned
  foreground seed approximation.
- Oversized palettes are reduced intelligently instead of being truncated, and
  the complete generated catalog remains available through selective imports.

### Fixed

- Corrected serpentine error-diffusion direction, pixel-sort iterator
  duplication, low-color octree hangs, and missing palette-mode fallbacks.
- Brought JavaScript and WASM Lab/OKLab conversion behavior into parity for
  fractional channels and linearized palette matching.
- Hardened signal decoders, filter workers, temporal state, and WebGL paths
  against malformed saved options and silent passthrough or black output.

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
