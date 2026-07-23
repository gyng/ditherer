# 084 — Temporal Filter Metadata Hardening

## Status

Complete.

## Finding

Nineteen registered filters expose an `animate`/`animateNoise` control and read
frame-varying state but omit the canonical `temporal: true` export flag. The
effects can still animate when their legacy action is pressed, but catalog
search, badges, chain previews, and library consumers misclassify them as
static.

## Contract

Every registered filter with an option key beginning with `animate` must
declare temporal behavior. This is intentionally based on the public option
surface rather than a hand-maintained name list.

## Scope

Ordered, Jitter, Triangle dither, Interlace Tear, Scanline Warp, Scan Line
Shift, Pixel Scatter, Mode 7, Rotate, Glitch Blocks, Ultrasound, Noise
Generator, Deep fry, Pixel Drift, Moiré / Aliasing, Night vision,
Rhythmic Wobble, FFT Phase Scramble, and Vintage TV.

## Verification

- Registry contract derives candidates from their option keys.
- Generated catalog, lint, typecheck, unit, package/app builds, and WebGL gate.

## Outcome

- Added a registry-derived invariant rather than a hand-maintained filter-name
  assertion; it initially reproduced 29 candidate catalog rows (20 unique
  filter modules plus Ordered variants). The liveness review reduced the final
  set to 28 rows and 19 modules by removing Data Bend's dead controls.
- Added `temporal: true` to every affected filter export. Manual play controls
  and rendering behavior are unchanged; metadata consumers now agree with the
  public control surface.
- Removed Data Bend's inert animation controls and temporal flag after the
  final liveness audit confirmed that its deterministic byte transform has no
  frame-varying state. Older saved `animate` and `animSpeed` keys remain benign
  ignored properties.
- Final verification: 1,965 tests passed (179 skipped); lint, typecheck,
  generated-source verification, package build, and app build passed; the
  bundle limit passed at 554.24 kB. The immediately preceding shader gate
  remains green at 2,621 cases, 724 compiles, 362 links, and 8,613 draws; this
  metadata-only pass changed no GLSL.
