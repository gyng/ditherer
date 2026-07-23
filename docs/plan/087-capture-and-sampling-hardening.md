# 087 — Capture and Sampling Hardening

## Status

Complete.

## Scope

Harden three existing filters selected by source inspection and a nine-view
Chromium contact sheet: Anaglyph, Bayer Sensor, and Moiré / Aliasing.

## Findings

- Anaglyph's CPU luminance path passes a 0–255 value into math that expects
  0–1, pushing almost every non-black pixel to maximum disparity and producing
  output radically different from WebGL. Both paths force at least one pixel
  of disparity, extract channels empirically, and expose no convergence plane.
- Bayer Sensor's nearest and bilinear modes use an arbitrary distance-weighted
  neighborhood rather than their named reconstruction kernels. Its
  "edge-aware" mode only changes green at red/blue sites, while red and blue
  keep the same generic interpolation. The color-bleed control merely
  desaturates the finished image, noise is signal-independent, and alpha is
  discarded. A second physical-model review also found that CFA sampling was
  still occurring in gamma-encoded sRGB and that shot/read noise was fixed in
  space and time instead of changing per captured frame.
- Moiré / Aliasing snaps the source to one grid but then paints unrelated sine
  waves over it. Sensor, screen, and print modes are nearly indistinguishable;
  the screen path has no emitter lattice, the print path has no process-color
  screens, and alpha is discarded.

## Research basis

- Dubois's anaglyph work formulates generation as a projection using display,
  glasses, and observer colorimetry rather than empirical channel selection.
  This pass uses the published red/cyan least-squares matrices in linear RGB,
  while clearly retaining a single-image synthetic stereo limitation.
- Malvar, He, and Cutler reconstruct Bayer mosaics with gradient-corrected 5×5
  linear filters. Their method adds cross-channel Laplacian corrections to
  bilinear estimates with gains 1/2, 5/8, and 3/4. This pass implements those
  cases and retains explicit nearest and true bilinear baselines.
- Krumm and Shafer distinguish crossed-grating moiré from sampled-grating
  aliasing and show that multiple sampling/transmission stages affect the
  result. The replacement derives artifacts from actual source, emitter, or
  CMYK screen lattices followed by a rotated sampling lattice; it does not add
  a free-standing interference wave.
- Conventional process screens use separated C/M/K angles around 15°, 75°,
  and 45°, with yellow near 0°. The print mode uses those channel-specific
  lattices so its rosette/beat structure follows the separations.

## Contracts

1. Anaglyph depth and disparity math is finite, normalized, permits zero
   disparity at the convergence plane, and agrees between CPU and WebGL.
2. Red/cyan output uses the Dubois linear-light projection. Alternate glasses
   modes preserve eye separation through luminance rather than arbitrary source
   channel extraction. Source alpha is preserved.
3. Every Bayer layout contains two green, one red, and one blue site per 2×2
   cell. Nearest, bilinear, and gradient-corrected modes remain meaningfully
   distinct and preserve measured samples at their native sites.
4. Gradient-corrected Bayer reconstruction applies all missing-channel cases,
   not just green. Sensor noise combines a signal-dependent shot term and a
   signal-independent read floor; crosstalk acts before demosaicing. Alpha is
   preserved.
5. Equal aligned lattice frequencies have zero beat frequency; pitch or angle
   mismatch creates a positive beat. Strength zero is exact identity.
6. Screen capture uses an RGB emitter lattice, print capture uses rotated CMYK
   halftone screens, and all moiré modes preserve source alpha.
7. Every affected control and catalog row describes the rendered model and its
   single-image or proxy limitations honestly.

## Verification

- Pure contracts for disparity, Dubois projection, CFA topology, noise scaling,
  screen angles, and lattice beat frequency.
- Permanent Chromium contracts for CPU/GL anaglyph parity, Bayer native-sample
  and alpha behavior, moiré identity/lattice distinction, and all enum paths.
- Before/after contact sheets using high-frequency, hard-edge, color, and alpha
  fixtures.
- Generated catalog, lint, typecheck, full unit suite, library/app builds, and
  the complete WebGL shader gate.

## Outcome

- Anaglyph now generates convergence-centered synthetic eye views, permits a
  true zero-disparity plane, applies the Dubois red/cyan projection in linear
  light, uses luminance-separated alternate glasses modes, preserves alpha,
  and maintains CPU/WebGL parity across all twelve mode/depth combinations.
- Bayer Sensor now captures in linear light, keeps native CFA measurements,
  provides true nearest and bilinear baselines plus complete 5×5
  gradient-corrected reconstruction, applies crosstalk and optical filtering
  before demosaicing, combines temporal shot/read noise with stable defects,
  and preserves alpha. Its gradient-corrected path is browser-verified to beat
  bilinear RMSE on a neutral hard edge.
- Moiré / Aliasing now derives its output from rotated capture sampling, RGB
  emitter, or CMYK halftone lattices. Pitch, angle, aperture, separation, and
  drift are live; zero drift is frame-invariant, zero strength is exact
  identity, and alpha is preserved.
- The unchanged before/after contact-sheet fixture and two subsequent
  correctness reviews produced no remaining findings in this tranche.
- Final gates: 129 Vitest files passed (1,992 tests; 179 skipped), lint and
  TypeScript checks passed, generated catalog verification passed, library and
  app production builds passed, and Chromium WebGL validation passed with
  2,634 contracts, 722 shader compiles, 361 links, and 8,798 draws.
