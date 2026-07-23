# 098 — Bilateral Blur Hardening

Status: Complete

## Objective

Replace Bilateral Blur's divergent CPU/WebGL implementations and backend-only
controls with one bounded, alpha-aware, edge-guided separable algorithm whose
quality/speed choices behave consistently.

## Evidence

- WebGL ignores the separable, downsample, and factor controls shown to most
  users, always runs a 2D kernel, and silently truncates its radius at 20 while
  CPU reaches 40.
- The maximum WebGL path performs 1,681 source reads per output pixel, while
  CPU's downsample path fails to scale sigma into working-resolution pixels.
- Both backends let RGB beneath zero alpha affect range weights, blur alpha
  itself, and can create transparent-edge mattes.
- CPU's horizontal pass quantizes to bytes, its range-kernel cache can grow
  without bound, and its palette and optimization semantics differ from GL.

## Implementation

1. Expose only spatial sigma, range sigma, working resolution (full, half, or
   quarter), and palette; migrate legacy downsample keys when no new resolution
   value is present.
2. Build an alpha-weighted work-resolution guide, scaling spatial sigma by the
   resolution divisor and bounding its two-pass radius at 24.
3. Run horizontal and vertical guided bilateral passes in Float32/RGBA16F,
   deriving range weights from the original guide and color weights from visible
   alpha rather than filtering alpha itself.
4. Joint-bilaterally reconstruct half/quarter output against the full-resolution
   source guide, preserve source alpha exactly, canonicalize transparent RGB,
   and support both sRGB and linear-light processing.
5. Apply one shared final palette pass and add contracts for control liveness,
   CPU/WebGL agreement, edge preservation, smoothing monotonicity, working-scale
   invariance, alpha/hidden-RGB behavior, linear-light behavior, borders, tiny
   rasters, deterministic output, and malformed/legacy state.
6. Run full release gates and an independent post-repair review before marking
   the plan complete.

## Outcome

- CPU and WebGL now share the same alpha-aware, source-guided separable model,
  bounded work-resolution policy, linear-light switch, exact source-alpha
  handling, transparent-RGB canonicalization, and final palette semantics.
- Legacy optimization keys migrate to the new working-resolution control, and
  oversized CPU/GL inputs return the original canvas with an explicit status
  instead of cloning or allocating unsafe full-frame buffers.
- Permanent browser contracts cover CPU/WebGL parity, custom palettes,
  smoothing and edge response, resolution transitions, linear-light liveness,
  sparse alpha, malformed and legacy state, and tiny or one-dimensional input.
- The final cross-tranche review also restored sparse direct-call defaults in
  five earlier upgraded simulations, made ACTION and palette descriptions
  accessible, corrected the palette selector's display-name/runtime-ID
  mismatch, and repaired incomplete or misleading control metadata.
- Final verification passed 2,048 Vitest tests with 179 intentional skips,
  TypeScript, ESLint, 34 Rust tests, generated-entry verification, and the real
  Chromium WebGL2 gate with 2,698 checks and 9,405 draws. The packed consumer
  now splits installed filter modules into bounded chunks; its largest
  JavaScript artifact is 1,781,033 bytes under the 2,000,000-byte ceiling.
