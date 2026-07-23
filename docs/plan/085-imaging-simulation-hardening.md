# 085 — Imaging Simulation Hardening

## Status

Complete.

## Findings

- Night Vision applies a display-gamma lift instead of a bounded intensifier
  response, adds signal-independent uniform grain, and forces opaque WebGL
  output. It also overstates the visible-RGB approximation as a Gen 3 device.
- Ultrasound treats source brightness as echo strength, so a spatially uniform
  image produces strong structure even though B-mode echoes are driven chiefly
  by acoustic-impedance changes and unresolved backscatter. Its noise is
  uncorrelated uniform modulation, attenuation follows brightness rather than
  propagation depth, arbitrary measurement markers are always visible, and
  both backends discard source alpha.
- Mavica FD7 reads frame-varying state for field jitter, fluorescent variation,
  and sensor noise but does not declare temporal behavior. Its WebGL pipeline
  also replaces alpha with one at multiple stages.

## Research basis

- Hamamatsu's image-intensifier documentation describes photocathode conversion,
  MCP electron multiplication, phosphor conversion, finite equivalent
  background input, selectable phosphor decay, and P43's 545 nm peak. The
  simulation therefore remains an explicitly visible-light proxy while using
  bounded gain, a noise floor, signal-dependent shot noise, and green phosphor.
- Quantitative-ultrasound literature describes B-mode echoes as reflection and
  scattering from acoustic-impedance inhomogeneities, propagation attenuation,
  point-spread-function filtering, and Rayleigh-distributed envelopes for many
  unresolved scatterers. The source image can only stand in for an impedance
  map, so the UI and catalog must say so.
- Sony's MVC-FD7 support page and manual remain the device-level reference for
  the existing Mavica model; this pass does not invent new device claims.

## Contracts

1. Intensifier output is monotonic and bounded; grain has a finite background
   floor but grows with the square root of amplified signal.
2. Ultrasound specular echo responds to local impedance change, diffuse tissue
   backscatter remains low, attenuation is monotonic with depth, and fully
   developed speckle uses a non-negative Rayleigh envelope.
3. CPU and WebGL paths preserve the source alpha at the sampled source location.
4. Diagnostic overlays are optional and off by default.
5. Every exposed control has user-facing help text, and catalog copy names
   source-derived proxies honestly.
6. Mavica declares temporal behavior and keeps alpha through every GL stage.

## Verification

- Unit tests for the pure response/noise/backscatter contracts.
- Registry and option-description contracts.
- Chromium contact sheets across defaults and meaningful extremes.
- WebGL alpha/output checks and the complete shader registry gate.
- Lint, typecheck, generated catalog verification, unit tests, and package/app
  production builds.

## Outcome

- Night Vision now uses a bounded exponential intensifier response, finite
  equivalent-background noise, square-root signal-dependent noise, and
  alpha-safe CPU/GL compositing. Its controls and catalog copy identify the
  visible-luminance approximation honestly.
- Ultrasound now derives strong echoes from local source changes rather than
  absolute brightness, applies monotonic round-trip depth attenuation,
  correlated Rayleigh-envelope speckle, and logarithmic display compression.
  Measurement crosses are optional and disabled by default; a second review
  corrected their GPU Y orientation to match the CPU path.
- Mavica FD7 now preserves source alpha through pre-color, interlace, soften,
  JPEG, and post-processing stages, declares its frame-varying behavior as
  temporal, and exposes device-specific public copy.
- Added permanent real-browser contracts for source alpha, signal-dependent
  intensifier noise, and impedance-boundary response.
- Final verification: 1,972 tests passed (179 skipped); generated-source
  verification, lint, typecheck, library build/types, application build, and
  the 554.24 kB bundle limit passed. The Chromium WebGL gate passed 2,623 cases
  with 724 shader compiles, 362 links, and 8,751 draws.
