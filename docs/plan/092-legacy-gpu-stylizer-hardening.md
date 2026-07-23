# 092 — Legacy GPU stylizer hardening

**Status:** Complete

## Objective

Rebuild the visibly weak Lens Flare and Pop Art shaders and correct Facet's
compositing and control semantics. Preserve their established filter names and
saved option keys while replacing fixed-pixel, gamma-space, aliased, opaque, or
misleading behavior with resolution-aware GPU implementations.

## Evidence and findings

- Lens Flare adds colored byte values directly in gamma-encoded sRGB, forces
  opaque alpha, uses hard-edged rings, and sizes ghosts as fixed 15–75 pixel
  circles. Its ghost centers only march from the light toward image center
  instead of spanning the optical axis. Zero intensity is therefore not an
  RGBA identity on composable input.
- Pop Art makes circular dot radius linear in darkness. Because circle area is
  proportional to radius squared, a nominal 50% tone covers only about 20% of
  its cell, while full black still leaves white cell corners. Hard thresholding
  aliases every dot edge, the screen cannot rotate, paper is fixed white, and
  source alpha is discarded.
- Facet calls a separable square neighborhood blur a cell "Average", derives
  layout seed from size/jitter rather than exposing it, hard-thresholds seams,
  averages straight-alpha RGB (letting invisible colors bleed), and forces all
  output opaque.

## Research basis

- Hullin et al., *Physically-Based Real-Time Lens Flare Rendering* (SIGGRAPH
  2011), identifies unintended lens-system paths—especially interreflection
  ghosts—plus chromatic/geometric aberration and coatings as core flare cues:
  https://resources.mpi-inf.mpg.de/lensflareRendering/
- He and Bouman, *AM/FM Halftoning*, defines conventional AM tone rendition as
  fixed dot density with varying dot size and evaluates output tone as average
  absorptance constrained to the requested level:
  https://engineering.purdue.edu/~bouman/publications/pdf/jei8.pdf
- Duan and Chen derive round-dot area as πr² and locate theoretical round-dot
  contact at 78.5% cell coverage, motivating an area-domain dot/hole transition
  rather than a radius-domain tone mapping:
  https://library.imaging.org/admin/apis/public/api/ist/website/downloadArticle/print4fab/27/1/art00107_1

## Implementation

1. Add pure geometry contracts for area-driven Pop Art spots and optical-axis
   ghost placement, plus browser contracts for zero-intensity identity, source
   alpha, flat-patch tone coverage, and transparent Facet output.
2. Composite Lens Flare energy in linear light, scale all elements by the short
   image dimension, distribute ghosts across the center-reflected optical axis,
   soften bloom/rings/streaks, preserve alpha, and expose size/spread/streak and
   chromatic controls with sparse-state fallback.
3. Turn Pop Art darkness into dot or complementary-hole area, antialias the
   analytical boundary with derivatives, add screen-angle and paper controls,
   retain source alpha, and make sparse saved options safe.
4. Give Facet a deterministic user seed, rename Average to honest Local mean,
   blur premultiplied RGBA, unpremultiply only for display, antialias seams, and
   carry sampled coverage through both center and local-mean modes.
5. Run two representative Chromium contact-sheet passes, correcting visible
   clipping, tone jumps, alpha halos, or overbearing defaults before release
   gates.

## Acceptance gates

- Lens Flare at zero intensity is byte-identical RGBA; active flare preserves
  source alpha, scales consistently across resolutions, and places ghosts on
  both sides of the optical center when the requested count permits.
- Pop Art flat patches reproduce requested dot area within raster tolerance,
  black can reach full coverage, dots remain antialiased at small sizes, and
  paper/screen controls visibly change output without changing source alpha.
- Facet's seed is independently adjustable, its fill-mode copy states the
  approximation, transparent source remains transparent, and hidden RGB cannot
  contaminate averaged visible color.
- Every new option is described, sparse options render safely, and the final
  repeated shader/control/visual review yields no further finding in scope.
- Focused tests, lint, TypeScript, full Vitest, generated metadata, package/app
  builds, bundle budget, and the complete Chromium WebGL gate pass.

## Outcome

- Lens Flare now adds resolution-aware bloom, optical-axis ghosts, and a
  controllable anamorphic streak in linear light while retaining source alpha;
  zero intensity is an opaque-input byte identity.
- Pop Art now maps requested darkness to circular ink area, changes to
  complementary paper holes after round-dot contact, antialiases its screen,
  preserves alpha, and exposes screen-angle and paper-color controls.
- Facet now exposes a stable seed, describes its blur-backed fill as Local
  mean, averages premultiplied RGBA, carries sampled coverage, and antialiases
  seams.
- Pure geometry contracts, real-WebGL identity/alpha/tone/transparency and
  sparse-state contracts, and two Chromium contact-sheet review passes found
  no remaining issue in scope.
- Final verification: 2,030 Vitest tests passed (179 skipped); lint, TypeScript,
  catalog generation (302 lazy, 292 public, 328 rows), library/types build, app
  build, and the 563.52 kB chunk budget passed. The complete WebGL gate passed
  2,657 checks with 35 skips across 267 GL filters, 726 shader compiles, 363
  program links, and 8,936 draws with zero failures.
