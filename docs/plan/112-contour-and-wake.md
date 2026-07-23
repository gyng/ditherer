# 112 — Contour Iso-Lines and Advected Wake Turbulence

Status: Complete

## Objective

Repair two filters whose output contradicts the named effect: Contour Map (flat
posterized luma bands with no iso-contour lines) and Wake Turbulence (a
stationary axis-aligned sinusoid, not turbulence trailing downstream of motion).

## Evidence

- **Contour Map** (`contourMap.ts`): `band = floor(lum·bands)/bands` then a
  hypsometric colour fill — it equates luminance with elevation and draws no
  iso-elevation contour LINES (the defining feature of a contour map), from an
  unsmoothed height field. Its JS path also forces output alpha to 255.
- **Wake Turbulence** (`wakeTurbulence.ts`): the warp is a stationary,
  axis-aligned screen-space sinusoid gated by motion energy
  (`dx = e·sin(px.x·…); dy = e·cos(px.y·…)`); the displacement has no relation
  to motion direction and is not a divergence-free turbulence field. (It does
  compute a real per-pixel motion-energy field.)

## References

- Topographic contour maps: iso-value contour lines over hypsometric tint;
  anti-aliased iso-lines via screen-space derivatives (fwidth).
- Curl noise for incompressible turbulence — a divergence-free 2-D field is the
  curl of a scalar potential (Bridson et al., "Curl-Noise for Procedural Fluid
  Flow," SIGGRAPH 2007); heat-shimmer/wake refraction trails along the flow.

## Implementation

1. Rebuild **Contour Map** to draw anti-aliased iso-contour lines at each
   elevation level over the hypsometric fill, from a smoothed height field, with
   line-colour/width controls; fix the JS alpha; keep colormaps and palette.
2. Add a framework-free, unit-tested `turbulenceField.ts` (value noise + its
   curl, which is divergence-free) with a GLSL mirror.
3. Rebuild **Wake Turbulence**'s warp to displace by that divergence-free curl
   turbulence, advected along the motion-energy gradient (so ripples trail the
   motion) and animated, gated by the existing motion-energy field; preserve
   alpha.
4. Normalise options. Add unit tests and real-browser GL-smoke contracts;
   register them.
5. Run the full unit, Chromium/WebGL, lint, type, catalog, package, and app
   gates.

## Outcome

- Contour Map now draws anti-aliased iso-contour lines (screen-space
  derivatives) at each elevation level over the hypsometric fill, from a
  smoothed height field, with line-colour/width/opacity controls; the JS path's
  forced-opaque alpha bug is fixed.
- A framework-free, unit-tested `turbulenceField.ts` provides value noise and its
  divergence-free curl (the incompressibility that defines real turbulence),
  with a GLSL mirror. Wake Turbulence now refracts the image by that curl
  turbulence, advected along the motion-energy gradient and animated, gated by
  the existing per-pixel motion energy — replacing the stationary axis-aligned
  sinusoid; source alpha is preserved.
- Two adversarial reviews found no correctness bugs. Wake Turbulence was verified
  clean (GLSL↔JS parity, NaN-safe/bounded displacement, deterministic, correct
  alpha), and the divergence-free test was confirmed legitimate and
  discriminating (a gradient field of the same potential fails it). Contour Map
  was verified correct; one low-severity visual improvement was applied — fading
  lines across cliffs where many bands cross a single pixel so a hard edge reads
  as clustered contours rather than a solid colour block.
- Verified with the curl-noise unit tests (+3, 2,268 total), real-browser
  GL-smoke contracts (Contour iso-contour-lines; Wake motion-gated-warp), lint,
  typecheck, catalog, and build.

Status: Complete

