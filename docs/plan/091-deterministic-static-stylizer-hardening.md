# 091 — Deterministic static stylizer hardening

**Status:** Complete

## Objective

Harden Voronoi, K-means, and Pixelsort where render-time randomness, incorrect
search bounds, ignored controls, or interval bookkeeping make still-image
results unstable or misleading. Preserve their artistic intent while making a
saved chain reproducible and every exposed control truthful.

## Findings

- Voronoi calls `Math.random()` for every render. Its accelerated nearest-site
  search stops as soon as any site is found in the first two bucket rings, even
  when an unsearched bucket has a closer site. Cell RGB is averaged without
  alpha weighting, so invisible source colors contaminate visible cells.
- K-means uses unseeded k-means++ initialization, exposes a palette control that
  it explicitly ignores, and keeps adding duplicate centroids after the
  distance distribution collapses. Sparse saved options also bypass defaults.
- Pixelsort uses `Math.random()` for optional interval starts, so enabling the
  control makes identical still renders disagree. `maxIntervalSize` flushes
  only after the limit has already been exceeded, and the random-control copy
  says it breaks intervals although the implementation admits pixels outside
  the normal gates so they can join or start a span. Its direct-module default
  also inherits Nearest's two-level palette, so only the registry wrapper avoids
  destructive cyan/red/yellow channel quantization.

## Implementation

1. Add regression contracts for deterministic seeded rendering, exact Voronoi
   nearest-site selection, alpha-weighted cell color, live K-means palette
   mapping, collapsed-cluster handling, and exact Pixel Sort span limits.
2. Give all three stochastic layouts explicit deterministic seed controls and
   remove render-time dependence on global randomness.
3. Make Voronoi bucket search exact using a geometric lower bound for every
   unsearched bucket ring, and average premultiplied source color per cell.
4. Run K-means in perceptual CIE Lab by default, weight clustering by visible
   alpha, stop when no distinct centroid remains, and apply the selected output
   palette. Retain an RGB mode for compatibility and comparison.
5. Flush Pixel Sort intervals at the declared maximum, use its seed for extra
   span starts, and align the user-facing description with that behavior.
6. Re-review degenerate sizes, partial saved state, alpha, performance, and
   catalog copy; then run focused, full, build, generated, and browser gates.

## Acceptance gates

- Identical input, options, and seed produce byte-identical output without
  reading `Math.random()` in all three filters.
- Voronoi never selects a farther bucket site merely because a nearer ring was
  non-empty, and fully transparent RGB cannot tint visible cell color.
- K-means initialization is finite for uniform/tiny inputs, perceptual mode is
  available and default, and a non-identity palette materially changes output.
- Pixel Sort never writes a run longer than `maxIntervalSize`; a limit of one
  is therefore an identity permutation.
- Every new control is described, partial saved options are safe, and the final
  repeated implementation review yields no further finding in this tranche.
- Focused tests, full Vitest, generated registry, lint, TypeScript, package/app
  builds, and the complete Chromium WebGL gate pass.

## Outcome

- Voronoi now uses an explicit seed, exact bucket-ring termination based on the
  distance to every unsearched region, alpha-premultiplied cell averaging, a
  non-destructive 256-level default palette, safe sparse options, and a
  pixel-count cap for degenerate small inputs.
- K-means now uses deterministic alpha-weighted k-means++ initialization,
  perceptual CIE Lab clustering by default with a legacy RGB mode, early
  convergence and collapsed-distribution termination, visible-sample recovery
  for coarse grids, and its formerly ignored palette control.
- Pixelsort now seeds extra-span decisions, describes those decisions honestly,
  flushes at the inclusive user limit, bounds malformed chance/limit values,
  and keeps 256-level color precision even when imported directly rather than
  through the catalog wrapper.
- Permanent tests cover forbidden global randomness, exact nearest-site parity
  against brute force, the former populated-ring counterexample, transparent
  RGB isolation, coarse sampling, live palette mapping, uniform/tiny cluster
  collapse, non-destructive defaults, exact span limits, and repeated seeded
  output.
- Two Chromium contact-sheet passes covered source transparency and detail,
  default/alternate/fine Voronoi layouts, Lab 8/Lab 4/RGB K-means, and default
  plus extra-span Pixelsort. The first pass exposed direct-module binary color
  quantization; the corrected pass retained the source gamut and produced
  stable repeated checksums. Temporary review files were removed.
- Verification passed: 2,024 Vitest tests with 179 intentional skips; lint;
  TypeScript; generated metadata for 302 lazy filters, 292 public modules, and
  328 catalog rows; package and application builds; the 562.57 kB app chunk
  budget; diff whitespace validation; and the Chromium WebGL gate with 2,656
  passed checks, 35 skips, 267 GL filters, 157 GL-required filters, 726 shader
  compiles, 363 links, 8,921 draws, and zero failures.
