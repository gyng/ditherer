# 095 — Legacy Field and Printer Hardening

Status: Complete

## Objective

Repair four existing filters whose controls and output currently violate their
advertised model: Contour Lines, Anisotropic Diffusion, Dot Matrix, and Pixel
Outline. Preserve saved-state compatibility while replacing misleading or
unstable math with deterministic, alpha-correct implementations.

## Evidence

- Contour Lines dilates both sides of a quantized-band boundary by the full
  requested width, so a one-pixel setting produces roughly two pixels of ink.
  Its "Filled bands" mode retains continuously varying source values and
  therefore does not produce flat bands.
- Anisotropic Diffusion stores every iteration in RGBA8. Sub-byte updates can
  round into a two-frame limit cycle (for example, a 100/102 checkerboard), so
  increasing the iteration count can alternate phase instead of converging.
- Dot Matrix uses variable-size square marks whose radius and opacity both
  scale with darkness. That creates a strongly nonlinear response, disagrees
  between CPU and GL cell sampling, and is not representative of fixed printer
  pin strikes.
- Pixel Outline computes edges from straight RGB beneath transparency, uses
  its width partly as opacity, and replaces source alpha with opaque output.
- All four wrappers accept sparse saved option objects but currently pass
  undefined or non-finite values into array access, loops, or uniforms.

## References

- P. Perona and J. Malik, “Scale-Space and Edge Detection Using Anisotropic
  Diffusion,” IEEE TPAMI 12(7), 1990. The explicit four-neighbour scheme is
  stable for `0 <= lambda <= 1/4`, and conductance decreases with normalized
  gradient magnitude.
- NIST, “Contour-to-Grid Interpolation Using Nonlinear Finite Elements,” for
  the distinction between a scalar field, discrete contour levels, and the
  geometry of isolines crossing that field.

## Implementation

1. Normalize every public option over defaults, clamp numeric ranges, validate
   enum/color values, and retain existing option keys for URL compatibility.
2. Rebuild Contour Lines around endpoint-preserving luminance bands and
   antialiased boundary coverage whose integrated thickness matches the width
   control. Preserve chroma in filled bands and preserve source alpha.
3. Move Anisotropic Diffusion iteration storage to pooled RGBA16F render
   targets, use one RGB-vector gradient magnitude to guide all channels, make
   transparency a diffusion barrier, and composite the original alpha plane.
4. Rebuild Dot Matrix as fixed circular pin strikes selected by a deterministic
   ordered threshold over alpha-weighted cell tone. Give CPU and GL the same
   pitch, sampling, threshold, geometry, palette, and alpha semantics.
5. Rebuild Pixel Outline around premultiplied RGBA differences, Euclidean
   distance coverage for fractional widths, exact source alpha, and matching
   CPU/GL behavior.
6. Add low-level math contracts and real-Chromium output contracts covering
   contour band counts/thickness, diffusion convergence and kappa direction,
   dot firing density, alpha/hidden-RGB invariance, sparse state, and backend
   agreement.
7. Run unit, lint, type, catalog-generation, package-build, application-build,
   and complete WebGL shader gates. Inspect representative ramps, steps,
   transparency, and noisy fields in Chromium before marking complete.

## Release gates

- `npm run test`
- `npm run test:gl`
- `npm run lint`
- `npm run typecheck`
- `npm run generate:check`
- package/type build and application production build
- real-browser visual/output-contract inspection

## Outcome

- Contour Lines now renders exactly the requested number of neutral fill tones,
  retains source chroma within gamut, and uses derivative-based antialiased
  isolines instead of double-width binary dilation.
- Anisotropic Diffusion now converges low-amplitude noise in RGBA16F storage,
  shares one vector edge guide across RGB, gates flux at transparency, and
  restores the original alpha plane after the final iteration.
- Dot Matrix now uses fixed circular marks and ordered firing density with the
  same alpha-weighted 4x4 cell sampling in CPU and WebGL paths.
- Pixel Outline now detects premultiplied color and silhouette changes, gives
  fractional widths continuous coverage, agrees across CPU/WebGL, and keeps
  every source alpha byte.
- Sparse and malformed saved-state contracts pass for all four filters.
- Verified with 2,042 unit tests, 2,666 Chromium/WebGL checks (728 shader
  compiles, 364 links, and 9,069 draws), lint, typecheck, generated-catalog
  verification, package/type build, and the production application build.
