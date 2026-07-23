# 096 — Core Tone and Edge Hardening

Status: Complete

## Objective

Repair four high-impact legacy algorithms whose present output contradicts
their defining method: Posterize Dither, CMYK Halftone, Edge Trace, and CLAHE.

## Evidence

- Posterize Dither perturbs values by too little before rounding and uploads
  corner rather than cell-centered Bayer thresholds. At two levels, 25% gray
  produces no white pixels instead of approximately 25%.
- CMYK Halftone assigns half of every screen cell to the following center and
  uses a radius factor that over-inks low/mid tones by about 54% before clipping.
- Edge Trace performs non-maximum suppression perpendicular to the Sobel
  gradient, keeping broad responses instead of localized gradient maxima.
- CLAHE stores one tile CDF per texture row without respecting
  `MAX_TEXTURE_SIZE`; a 1920x1080 image with 8-pixel tiles requests 32,400 rows.
  Its GL path also skips non-identity Nearest levels, invisible RGB contributes
  to histograms, residual redistribution favors dark bins, and black cannot map
  through the CDF.

## References

- B. E. Bayer, “An Optimum Method for Two-Level Rendition of Continuous-Tone
  Pictures,” ICC Conference, 1973.
- J. Canny, “A Computational Approach to Edge Detection,” IEEE TPAMI, 1986.
- OpenCV 4.x CLAHE implementation, including evenly stepped residual histogram
  redistribution.
- Purdue AM/FM halftoning literature: amplitude-modulated screening represents
  tone by inked area at fixed screen frequency.

## Implementation

1. Use cell-centered Bayer ranks and stochastic rounding between adjacent
   posterization levels so complete matrices preserve channel means; preserve
   alpha and normalize sparse/malformed options.
2. Correct CMYK screen periodicity and replace arbitrary radii with
   area-calibrated dots plus complementary corner holes, derivative AA,
   source-alpha preservation, and honest screen-spacing copy.
3. Correct all four Edge Trace NMS direction bins, replace binary width jumps
   with continuous Euclidean coverage, preserve source alpha, make overlay mix
   zero an RGBA identity, and normalize options.
4. Atlas-pack CLAHE CDF rows within queried texture limits, apply palette
   identity semantics consistently, distribute clipping residuals across the
   histogram, exclude transparent samples, support mapped black, and normalize
   saved state.
5. Add real-browser contracts for ordered tone means, CMYK area/periodicity,
   edge localization/identity, CLAHE palette liveness/alpha, and malformed state.
6. Run the full unit, Chromium/WebGL, lint, type, catalog, package, and app gates.

## Outcome

- Posterize Dither now uses cell-centered Bayer ranks to choose between adjacent
  output levels, preserving complete-cell means and source alpha.
- CMYK Halftone now separates each alpha-weighted source sample before plate
  averaging, uses center-relative 180-degree-periodic screens, and evaluates a
  monotone circular area-rank spot with 4x4 subpixel coverage down to pitch 2.
- Edge Trace now suppresses along the Sobel gradient with deterministic plateau
  handling, detects premultiplied color and alpha silhouettes, preserves alpha,
  gives width continuous coverage, and makes zero Overlay mix an unconditional
  pre-palette identity. Mode-irrelevant controls are hidden.
- CLAHE now reflect-pads partial tiles, ignores hidden transparent RGB,
  propagates valid mappings into empty tiles in O(tile count), spreads clipped
  residuals, maps black through its CDF, applies one shared palette pass, and
  atlas-packs CDFs within the queried device limit.
- Three independent post-repair review loops reported no remaining findings in
  this plan's scope.
- Verified with 2,044 unit tests, 2,671 Chromium/WebGL checks (728 shader
  compiles, 364 links, and 9,103 draws), lint, typecheck, generated-catalog
  verification, package/type build, and production application build.
