# 109 — Photographic Tone and Light-Transport Fidelity

Status: Complete

## Objective

Repair three filters whose tonal/optical response contradicts the photographic
process they name: Solarize (a hard per-channel invert, not the smooth Sabattier
tone reversal), Dodge/Burn (a gamma-space multiply, not a linear-light exposure
change), and Atmospheric Haze (a linear depth blend in gamma space, not the
Koschmieder exponential airlight law).

## Evidence

- **Solarize** applies a knife-edge, per-channel invert
  (`c.r > threshold ? 1 - c.r : c.r`, independently for R/G/B). Each channel
  flips at a different input level, producing garish false colour with no basis
  in the Sabattier density curve, which reverses _tone_ smoothly through a
  re-exposure hump.
- **Dodge/Burn** multiplies the gamma-encoded RGB by a factor
  (`rgb * factor`). Dodging and burning are _exposure_ changes — multiplicative
  in linear light — so scaling gamma-encoded values gives the wrong tonal
  response.
- **Atmospheric Haze** uses transmission linear in depth
  (`haze = depth * strength`) and composites the tint with a straight lerp in
  gamma space. The Koschmieder airlight law is exponential
  (`L = L₀·e^(−βd) + L_air·(1 − e^(−βd))`) and lives in radiance (linear) space.

## References

- Sabattier / solarization H&D characteristic curve — partial re-exposure
  reverses density through a hump (Langford, _Basic Photography_).
- Dodge/burn as local exposure control (multiplicative in linear light /
  additive in log-density).
- H. Koschmieder, 1924; Narasimhan & Nayar, "Vision and the Atmosphere" —
  airlight `L = L₀·e^(−βd) + L_air·(1 − e^(−βd))`.
- IEC 61966-2-1 sRGB EOTF (already implemented; reused via
  `opticalConvolutionContracts`).

## Implementation

1. Add a framework-free `toneTransferContracts.ts` (reusing the existing sRGB
   EOTF helpers) exporting the smooth Sabattier `solarizeCurve`, the
   `koschmiederTransmission` law, and a linear-light `linearExposure`, plus a
   GLSL chunk for the solarize curve. Unit-test their defining properties.
2. Rebuild **Solarize** to apply the smooth reversal curve (continuous, same
   curve on every channel — no independent per-channel step), with a reversal
   point and strength control.
3. Rebuild **Dodge/Burn** to apply its exposure factor in linear light
   (linearise → scale → delinearise) on both GL and JS paths.
4. Rebuild **Atmospheric Haze** to use exponential transmission
   `t = e^(−β·depth)` and composite airlight in linear light
   (`out = src·t + air·(1−t)`), keeping the depth modes, horizon, softness, and
   highlight bloom.
5. Normalise options; preserve alpha and palette. Add unit tests and
   real-browser GL-smoke contracts; register them.
6. Run the full unit, Chromium/WebGL, lint, type, catalog, package, and app
   gates.

## Outcome

- A framework-free, unit-tested reference (`toneTransferContracts.ts`, reusing
  the sRGB EOTF) now documents the three tone models: the smooth Sabattier
  `solarizeCurve` (with an exact GLSL mirror), the linear-light `linearExposure`,
  and the `koschmiederTransmission` / `airlightComposite` airlight law.
- Solarize applies the smooth reversal curve with the same curve on every
  channel (a reversal point and strength control), replacing the knife-edge,
  per-channel invert; highlights fold toward black through a continuous hump.
- Dodge/Burn applies its exposure factor in linear light on both GL and JS
  paths (linearise → scale → delinearise), the physically correct exposure
  change instead of a gamma-space multiply.
- Atmospheric Haze uses exponential Koschmieder transmission
  `t = e^(−β·depth)` and composites the airlight (tint) in linear light,
  keeping the vertical/luma/hybrid depth modes, horizon, softness, and bloom.
- Two adversarial reviews (tone math + shaders; filter integration) found no
  runtime bugs — the solarize JS↔GLSL mirror is byte-exact and continuous,
  dodge/burn linear exposure is GL/JS-equivalent, and the haze composite is
  energy-correct and monotone. Three test-efficacy notes were applied: the haze
  smoke contract now locks the exponential falloff (convex airlight buildup on a
  luma ramp, rejecting linear-in-depth), the dodge contract now rejects a
  gamma-space multiply, and the reference module's header was made accurate.
- Verified with the tone-module and Dodge/Burn JS-path unit tests (+11, 2,255
  total), a real-browser GL-smoke `tone-and-light` suite (Sabattier reversal,
  Koschmieder depth/exponential airlight, linear-exposure dodge/burn), lint,
  typecheck, catalog, and build.

Status: Complete
