# 106 — Optical Convolution and Statistic Fidelity

Status: Complete

## Objective

Repair four Blur & Edges filters that name a specific optical operation but
implement a crude box-mean or wrong statistic, most of them in gamma space:
Despeckle, Sharpen (unsharp mask), Bloom, and Bokeh. Each is rebuilt around the
operation it claims — an edge-preserving median, a Gaussian unsharp mask,
linear-light multi-scale Gaussian bloom, and a linear-light circle-of-confusion
gather — reusing the repo's existing true separable Gaussian and median
primitives where possible.

## Evidence

- **Despeckle** replaces high-variance pixels with the neighbourhood _mean_ and
  keeps low-variance pixels (`pick = variance > threshSq ? mean : self`). Edges
  are high-variance, so it box-blurs edges while leaving flat, speckle-prone
  regions untouched — the opposite of despeckling — and there is no median at
  all despite the "median sampling" control label.
- **Sharpen** builds its unsharp mask from a uniform _box_ blur (separable, both
  paths), not the Gaussian that defines unsharp masking, and composites in gamma
  space, producing boxy, ringy halos and tonal shifts.
- **Bloom** blurs with a single-scale uniform box and thresholds/composites in
  gamma space (`c.rgb - threshold`, `src + bloom*strength`), so the glow has a
  square falloff and under-represents the energy of bright sources.
- **Bokeh** gathers highlight luminance and accumulates in gamma space and
  samples the circle of confusion on a sparse `stepSize = floor(radius/2)`
  lattice, so discs are dim and beat/gap at larger radii.

## References

- Gonzalez & Woods, _Digital Image Processing_ — median filtering for
  salt-and-pepper (impulse) noise; center-weighted / thresholded median.
- The unsharp masking definition: `out = src + (src − Gaussian(src)) · amount`.
- J. Jimenez, "Next Generation Post Processing in Call of Duty: Advanced
  Warfare," SIGGRAPH 2014 — physically based bloom: linear-light bright pass,
  multi-scale Gaussian, additive composite in linear.
- Standard depth-of-field scatter/gather bokeh: energy gather in linear light,
  weighted by circle-of-confusion area.
- IEC 61966-2-1 sRGB EOTF (already implemented in `utils/index.ts`).

## Implementation

1. Add a shared optical module
   `packages/ditherer-filters/src/filters/opticalConvolutionContracts.ts`
   with pure, unit-tested helpers (normalised Gaussian 1-D kernel and per-tap
   weight, radius→sigma, per-channel median, thresholded-median pick, linear
   bright-pass response) and a shared sRGB↔linear GLSL chunk, since no shared
   colour-space shader chunk exists today.
2. Rebuild **Despeckle** as an edge-preserving thresholded median: replace a
   pixel with the per-channel neighbourhood median only when it deviates from
   that median by more than the threshold, so impulses are removed and edges
   and detail are preserved. Update GL and JS paths; keep alpha and palette.
3. Rebuild **Sharpen** to blur with a true Gaussian (both separable passes)
   instead of a box, keeping the working-space composite (standard for unsharp
   masking, and it avoids banding an 8-bit linear intermediate), the threshold
   gate, alpha, and palette handling.
4. Rebuild **Bloom** as a linear-light bright pass, a multi-scale Gaussian
   spread (reusing `renderGaussianBlurGL` at increasing sigmas), and an
   additive composite in linear light, delinearised on output.
5. Rebuild **Bokeh**'s light-gathering core to linearise before the highlight
   gather, accumulate in linear light, delinearise on output, and sample the
   circle of confusion densely enough to avoid lattice gaps, while keeping the
   existing shape machinery.
6. Add unit tests for the optical module and each filter's defining behaviour
   (median removes an impulse while preserving a step edge; Gaussian unsharp
   raises local contrast; bloom/bokeh energy rises in linear light), plus
   real-browser GL-smoke contracts, and register them.
7. Run the full unit, Chromium/WebGL, lint, type, catalog, package, and app
   gates.

## Outcome

- A shared, unit-tested optical module (`opticalConvolutionContracts.ts`) backs
  all four filters: a normalised 1-D Gaussian kernel and per-tap weight,
  radius→sigma, per-channel median, thresholded-median pick, a linear
  bright-pass response, and a shared sRGB↔linear GLSL chunk (the first such
  shared colour-space chunk in the repo).
- Despeckle now replaces a pixel with its per-channel neighbourhood median only
  when it deviates from that median by more than the threshold, reusing the
  tested `medianFilterGL` histogram on the GPU and a real median in JS —
  removing impulse speckle while preserving edges and detail.
- Sharpen builds its unsharp mask from a true separable Gaussian on both paths,
  fixing the boxy, ringing halos of the box-blur low-pass.
- Bloom extracts the bright pass in linear light, spreads it with a
  progressive multi-scale Gaussian, and composites additively in linear light,
  giving a smooth energy-faithful glow instead of a square gamma-space halo.
- Bokeh linearises before the highlight gather, accumulates and composites in
  linear light, and samples the circle of confusion at half the previous step
  (with a compensated additive scale) to remove lattice gaps, keeping the
  existing shape machinery.
- Verified with the optical-module and JS-path unit tests (+13 tests, 2,229
  total), the real-browser GL smoke (2,714 checks, including a new
  optical-convolution suite for impulse removal, edge preservation, unsharp
  overshoot, linear bloom glow, and bokeh disc spread), lint, typecheck,
  generated catalog verification, and the production application build.

Status: Complete
