# 110 — Cylindrical Anamorphosis and Relief Stamp

Status: Complete

## Objective

Repair two filters whose output contradicts the process they name: Anamorphic
Cylinder (an ad-hoc log/exp radial remap, not cylindrical-mirror reflection
geometry) and Stamp (a per-pixel threshold plus white noise, not a relief die
with morphological ink transfer and edge break-up).

## Evidence

- **Anamorphic Cylinder** maps the annulus with
  `rSrc = cylR·exp(t·ln(maxR/cylR))` — an arbitrary logarithmic radial stretch
  with no basis in mirror optics — and renders the _raw undistorted source_ at
  its cartesian position inside the mirror region (you cannot see the flat
  artwork through an opaque cylinder).
- **Stamp** is a per-pixel luminance threshold with additive white-noise
  "jitter"/"edgeBias"/"fade"; the "edge bias" is sampled from the same white
  noise, not any spatial edge detector, so it is functionally Binarize plus
  dither — no morphology, no distance-to-edge, no connectivity.

## References

- Cylindrical-mirror anamorphosis: a point at height z on the cylinder reflects
  to plane radius `r = R_c + z·cot(α)` — the radial map is LINEAR in image
  height, angle preserved (Hunt/Sharp, _Mathographics_; standard cylindrical
  anamorphosis derivation).
- Relief/rubber-stamp printing: a raised binary die pressed through ink;
  break-up concentrates at shape boundaries where the stamp starves of ink
  (morphological ink transfer; distance-transform edge falloff).

## Implementation

1. Add a framework-free `anamorphMapping.ts` (linear reflection radial map,
   polar disc-preview height, angle-to-column wrap) with a GLSL mirror;
   unit-test that the annulus maps LINEARLY (midpoint radius → 0.5).
2. Rebuild **Anamorphic Cylinder** to use the linear reflection radial map with
   angle preserved (plus twist), rendering the inner disc as a polar mirror
   preview joined continuously to the annulus at the wall. Normalise options;
   preserve alpha/palette.
3. Rebuild **Stamp** as a binary die → morphological open/close → distance-to-
   edge break-up (measured on the opened field) → low-frequency pressure noise,
   preserving source alpha and adding palette-identity handling like the sibling
   relief filters. Normalise options.
4. Add unit tests (mapping) and real-browser GL-smoke contracts (Anamorphic
   linear reflection radial; Stamp edge-concentrated break-up + alpha); register
   them.
5. Run the full unit, Chromium/WebGL, lint, type, catalog, package, and app
   gates.

## Outcome

- Anamorphic Cylinder now maps the annulus radius linearly to the source height
  (the reflection law), preserves angle, and shows a continuous polar
  mirror-preview disc; the mapping mirrors the unit-tested `anamorphMapping.ts`.
- Stamp now thresholds to a binary die, morphologically opens/closes it,
  concentrates break-up at boundaries via a distance-to-edge measure on the
  opened field, and modulates ink with low-frequency pressure noise; source
  alpha is preserved and a palette pass is applied like the relief family.
- Two adversarial reviews found the Anamorphic rebuild fully correct (GLSL↔JS
  parity, disc/annulus continuity, y-flip, and a smoke contract that genuinely
  fails the old log map). The Stamp review found one medium defect — the
  edge-distance scan read the raw binary, so interior pinholes could spawn
  break-up halos on real photos — now fixed by measuring distance on the opened
  field; plus a clean roughness-0 low end and a corrected interior test inset.
- Verified with the mapping unit tests (+4, 2,259 total), a real-browser
  GL-smoke `warp-and-print` suite (linear reflection radial; edge-concentrated
  break-up and alpha), lint, typecheck, catalog, and build.
