# 097 — Painterly Stylizer Hardening

Status: Complete

## Objective

Repair Pencil Sketch, Mosaic Tile, and Oil Painting so their controls describe
the rendered operation, their CPU/WebGL paths agree where both exist, and
transparent pixels cannot corrupt visible color or structure.

## Evidence

- Pencil Sketch normalizes luminance before its CPU Sobel pass but restores the
  0–255 scale only in WebGL, making CPU edge emphasis roughly 255 times weaker.
  Its CPU borders are zeroed while WebGL clamps, it forces opaque output, and
  the control called density actually increases line spacing.
- Mosaic Tile computes full-tile means on CPU but center samples on WebGL, uses
  unrelated random fields, maps grout through the palette on only one backend,
  and forces all output opaque. Its jitter control changes brightness rather
  than tile position.
- Oil Painting describes its luminance-histogram bin count as output color
  quantization, uses a square support for a brush-radius control, resolves tied
  modes toward the darkest bin, and lets invisible RGB affect neighborhood
  statistics.

## Implementation

1. Normalize sparse and malformed state for all three filters without changing
   their saved-state keys.
2. Make Pencil Sketch's saved `strokeDensity` value map monotonically to actual
   line density, share clamped alpha-aware Sobel semantics across CPU/WebGL,
   preserve source alpha, and apply palettes in one final pass.
3. Give Mosaic Tile a shared deterministic coordinate hash and shared 4×4
   alpha-weighted tile sampling, preserve source alpha, and apply the selected
   palette consistently to tiles and grout.
4. Use an alpha-weighted circular neighborhood for Oil Painting and resolve
   equal histogram modes by proximity to the center pixel's luminance bin.
5. Correct option and catalog descriptions, and add real-browser contracts for
   backend agreement, alpha/hidden-RGB invariance, control liveness, tie
   behavior, sparse state, and deterministic output.
6. Run unit, Chromium/WebGL, lint, type, generated-catalog, package, and app
   gates before marking the plan complete.

## Outcome

- Pencil Sketch now uses matching alpha-aware clamped Sobel fields on CPU and
  WebGL, follows contour tangents, maps every saved density level to a
  Nyquist-safe continuous hatch frequency, preserves alpha, and shares one
  final palette pass.
- Mosaic Tile now computes exact alpha-weighted tile statistics once, uploads
  the compact tile table for WebGL lookup, uses one deterministic coordinate
  hash on both backends, preserves alpha, and cannot miss sparse opaque marks.
- Oil Painting now uses circular visible-sample neighborhoods, alpha-weighted
  modal bins, and center-nearest tie resolution with byte-scale tolerance.
- Browser contracts cover backend agreement, all ten density levels, contour
  orientation, partial alpha, hidden RGB, deterministic jitter, partial edge
  tiles, sparse 40-pixel tiles, modal ties, and malformed saved state.
- Two independent post-repair reviews reported no remaining findings in this
  plan's scope. The WebGL gate passed 2,675 checks with 728 shader compiles,
  364 links, and 9,137 draws.
