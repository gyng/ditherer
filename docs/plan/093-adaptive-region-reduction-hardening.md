# 093 — Adaptive Region Reduction Hardening

**Status:** Complete

## Why this pass

A parallel audit of legacy CPU filters, legacy GPU filters, and catalog/control
contracts found three related correctness failures in region-based reduction:

- Delaunay samples only interior points, so the retained triangulation covers
  their convex hull rather than the full raster. Pixels outside that hull are
  left transparent, and triangle averages include invisible RGB.
- Stained Glass advertises Average, Median, and Dominant pane colors, but both
  backends always use a straight RGB average and force opaque output.
- Median Cut converts the requested color count to a recursion depth, so every
  non-power-of-two request can produce more colors than its documented maximum.
  Transparent RGB can also consume palette capacity.

This pass treats these as one adaptive-region contract rather than three
isolated patches.

## Research basis

- Heckbert's median-cut algorithm separates image statistics, colormap
  selection, and nearest-color mapping. Repeatedly splitting one bucket gives
  an explicit palette-size budget, rather than rounding the budget to a power
  of two: <https://publications.ri.cmu.edu/color-image-quantization-for-frame-buffer-display>
- A Delaunay triangulation covers the convex hull of its sites. Including the
  four raster corners as sites therefore makes full-image coverage an explicit
  geometric invariant: <https://www.cs.purdue.edu/homes/cs53100/slides/delaunay.pdf>
- Fully transparent samples carry no visible color contribution. Adaptive
  statistics must exclude them, while rendered alpha continues to follow the
  source image.

## Implementation

### 1. Regression contracts first

- Assert Delaunay covers every pixel of an opaque input and preserves source
  alpha without letting invisible RGB tint visible triangle colors.
- Assert Stained Glass's three pane statistics are genuinely distinct on a
  skewed distribution and ignore transparent outliers.
- Assert Median Cut never exceeds arbitrary requested counts (including 3, 5,
  7, 13, and 31) and produces the same visible palette when only hidden RGB
  changes.
- Extend the real-browser backend agreement contract to non-power-of-two
  Median Cut budgets and alpha-preserving Stained Glass output.

### 2. Delaunay coverage and compositing

- Reserve four deterministic hull sites at raster corners and deduplicate
  generated sites.
- Rasterize with a shared tolerant barycentric predicate and a coverage map.
- Use alpha-weighted visible samples for each triangle representative, map its
  palette color once, and preserve per-pixel source alpha for panes and edges.
- Fall back to the source pixel for any numerical coverage gap.

### 3. Real Stained Glass color modes

- Add one shared pane-statistics utility used by CPU and WebGL orchestration:
  alpha-weighted average, weighted per-channel median, and dominant quantized
  color cluster.
- Preserve source alpha in both backends and use subpixel border-distance
  packing plus anti-aliased leading transitions.
- Normalize sparse/invalid options to documented defaults.

### 4. Exact-budget Median Cut

- Add a best-first bucket splitter that stops at the requested count instead of
  converting it to a recursion depth.
- Ignore fully transparent samples, use alpha weights for splitting and bucket
  representatives, and retry the complete visible population if stride
  sampling misses it.
- Keep existing depth-based utility semantics intact for unrelated callers.

### 5. Verification and handoff

- Focused Vitest contracts and TypeScript diagnostics.
- Browser contact-sheet comparison for the repaired effects.
- Complete WebGL registry validation, unit suite, lint, generated-artifact
  check, library build, and application build.
- Update catalog copy and changelog with user-visible behavior changes.

## Acceptance criteria

- Opaque Delaunay inputs have no transparent hull or crack pixels.
- Delaunay and Stained Glass preserve source alpha and ignore invisible RGB in
  their visible-color statistics.
- Average, Median, and Dominant Stained Glass modes produce meaningful,
  deterministic differences on skewed source distributions in both paths.
- Median Cut emits no more than the requested number of colors for every valid
  integer budget and never spends that budget on fully transparent RGB.
- All focused, browser/WebGL, and release gates pass.

## Verification

- `npm run test -- --run`: 2,042 passed, 179 skipped.
- `npm run test:rust`: 34 passed.
- `npm run test:gl`: 2,658 contracts passed; 726 shader compiles, 363
  program links, and 8,948 draws.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm --prefix packages/ditherer-filters run generate:check`: 302 lazy
  filters, 292 public modules, and 328 catalog rows verified.
- `npm run build:lib`: passed, including declaration generation.
- `npm run build`: passed; largest JavaScript chunk 564.04 kB.
- Chromium visual contact sheet reviewed for complete Delaunay hull coverage,
  visible transparency, Stained Glass CPU/GL mode alignment, and 7/13-color
  Median Cut output. The temporary review page and test were removed afterward.
