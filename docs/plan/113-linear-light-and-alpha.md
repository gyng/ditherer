# 113 — Linear-Light Accumulation and Alpha Preservation

Status: Complete

## Objective

Fix two verifiable correctness classes found by a fresh survey angle (beyond the
exhausted "name contradicts process" backlog):

- **Seam A — gamma-vs-linear**: filters that integrate/average/accumulate *light*
  (a linear-light operation) but do the arithmetic on gamma-encoded sRGB, so
  bright detail smeared over dark areas comes out too dark and midtones shift.
  Each claims a camera/film/optical process and should reuse the existing
  `SRGB_GLSL` / `srgbToLinear` / `linearToSrgb` helpers.
- **Seam B — alpha preservation**: colour/geometric transforms that hardcode
  output alpha to `1.0`/`255` instead of carrying source alpha, or whose GL and
  CPU paths disagree.

## Evidence

### Seam A (light averaged in gamma space)
- **Motion Blur** (`motionBlur.ts`, `motionBlurGL.ts`) — line-integral average
  along the motion path done as a plain gamma `+=` / `/count`.
- **Radial Blur** (`radialBlur.ts`) — zoom/spin sample average in gamma (GL + CPU).
- **Long Exposure** (`longExposure.ts`) — temporal frame accumulation
  (shutter-average / additive / running-average / blend) in gamma; this is photon
  integration over time, the canonical linear-light op.
- **Halation** (`halationGL.ts`) — highlight blur (light spread) + screen
  composite (light addition), both in gamma.
- **Orton** (`ortonGL.ts`) — gaussian glow + screen composite in gamma.
- **Tilt-Shift** (`tiltShift.ts`) — DoF defocus gaussian + focus-band composite
  in gamma (muddy-bokeh bug).
- **Volumetric Light** (`volumetricLight.ts`) — ray-march light-shaft
  accumulation from gamma-luma emitters + additive composite in gamma.
- **CCD Charge Smear** (`ccdChargeSmear.ts`) — well-overflow thresholded on gamma
  luma, excess accumulated + additively composited in gamma. *(Verify first — it
  was reworked for 0.4.0; only include if it genuinely operates in gamma.)*

### Seam B (forced-opaque / dropped source alpha)
- **Temporal Color Cycle** (`temporalColorCycle.ts`) — GL `vec4(rgb,1.0)` and CPU
  `[i+3]=255` on a pure HSL hue-cycle; `src.a` / `buf[i+3]` both available.
- **Scanline Warp** (`scanlineWarpGL.ts`) — GL-only warp samples only `.rgb`,
  outputs `vec4(rgb,1.0)`; alpha should follow the same displacement.
- **Color Gradient Noise** (`colorGradientNoiseGL.ts`) — GL-only source/noise
  blend forces opaque.
- **Triangle Pixelate** (`trianglePixelate.ts`) — CPU forces `255` while its own
  GL path preserves alpha (backend inconsistency); sibling `hexPixelate.ts`
  preserves it.
- **Motion Pixelate** (`motionPixelate.ts`) — CPU-only; even the verbatim
  pass-through branch overwrites alpha with 255.
- **Time Mosaic** (`timeMosaic.ts`) — historical-frame branch drops alpha while
  the live branch preserves it (self-contradiction).

## Implementation

1. **Seam A**: wrap each light accumulation/blend/screen op in
   `srgbToLinear`→(accumulate in linear)→`linearToSrgb`, in BOTH GL and CPU
   paths, following the house convention for physically-correct filters (include
   `SRGB_GLSL` in the shader; keep GLSL↔JS parity). Preserve alpha. Keep all
   existing options and visual intent (only the colour space of the math changes).
2. **Seam B**: carry source alpha (`src.a` / `buf[si+3]`) — warp/interpolate it
   where the transform is geometric; average it where tiles are averaged.
3. Add framework-free unit tests: Seam A asserts a bright-over-dark average is
   *brighter* in linear than the old gamma result (and matches the linear
   reference); Seam B asserts output alpha equals the carried source alpha.
4. Add real-browser GL-smoke contracts for the GL-only / GL-critical cases;
   register them in `src/gl-smoke/suites.ts` (single registration edit done by
   the orchestrator to avoid conflicts).
5. Run the full gate: typecheck, lint, `generate:check`, unit tests,
   `test:e2e:gl`, build.
6. Adversarial hardening review per filter until no new findings.

## Outcome

- **Seam A (8 filters) moved to linear light**, hardcoded always-on per the
  `bloom.ts` house pattern (import `SRGB_GLSL`, `oc_srgbToLinear`/`oc_linearToSrgb`,
  no `_linearize` flag): Motion Blur, Radial Blur, Long Exposure, Halation,
  Orton, Tilt Shift, Volumetric Light, CCD Charge Smear. Each decodes to linear
  before the physical op and re-encodes once at output; multi-pass filters
  (Halation, Orton, Tilt Shift, Long Exposure) use RGBA16F intermediates where
  available. Dual-path filters (Motion Blur, Radial Blur) keep GLSL↔JS parity by
  linearizing after sampling (bilinear/`GL_LINEAR` runs in sRGB byte space, then
  linearize each tap, sum, re-encode once). Source alpha preserved everywhere,
  never linearized.
- **Seam B (6 filters) now carry source alpha** instead of forcing opaque: Color
  Cycle, Scanline Warp (alpha warped with the same taps as colour), Color
  Gradient Noise, Triangle Pixelate (CPU path now matches its GL path), Motion
  Pixelate (tile-average averages alpha; pass-through copies it), Time Mosaic
  (stored-frame branch).
- **CCD**: `u_threshold` linearized once (bloom bright-pass convention);
  `u_strength <= 0` early-outs to an exact source pass-through so the
  zero-strength identity is guaranteed by construction, not by sub-quantization
  rounding.
- **Tests**: 14 framework-free unit tests added (linear brightness / alpha
  preservation), 2302 unit tests pass. 11 real-browser GL-smoke contracts added
  under two new suites — `linear-light-accumulation` (8) and `alpha-preservation`
  (3); full GL smoke 2743 pass. lint, typecheck, catalog (`generate:check`), and
  build all green.
- **Hardening**: four adversarial reviews (dual-path parity, multi-pass glow,
  accumulation, alpha) found no correctness bugs. One low-severity CCD
  robustness note (zero-strength bit-exactness) was applied. Two intentional
  behaviour notes recorded: Long Exposure's BLEND cross-fade now interpolates in
  linear (correct — the control is "how fast old light fades", i.e. fading
  light); MAX mode is output-identical (max commutes with the monotonic EOTF).
- **Pre-existing, out of scope** (noted, not touched): Motion Blur's CPU vs GL
  kernel tap-count discretization differs for odd `length` (predates this work,
  orthogonal to colour space); Triangle Pixelate's outline stroke is opaque on
  both paths by design.
- One pre-existing GL-smoke contract was re-baselined, not a regression: CCD's
  `additive-overload-drain-and-direction` anti-blooming threshold moved 0.4→0.5
  because a smaller *linear* spill re-encodes concavely onto a near-black
  background, so the measured sRGB byte-energy drops ~58% (still a strong drain),
  where the old gamma filter produced >60%.

Status: Complete
