# 105 — Pen-and-Ink and Relief Printmaking Tone Hardening

Status: Complete

## Objective

Repair four printmaking stylizers whose output contradicts the mark-making
technique they are named after: Crosshatch, Engraving, Woodcut, and Stipple.
All four convey tone by hard luminance thresholds over a fixed device-space
lattice, so a mid-grey region and a near-black region receive identical marks,
and the marks never follow the subject's form. The rebuild makes tone a
*continuous function of local mark density* and models each technique's
defining mark structure, while keeping each filter distinct from the existing
Flow Crosshatch (which already owns the form-following hatch look).

## Evidence

- **Crosshatch** (`crosshatch.ts`) responds to tone with two discrete
  breakpoints only (`if (lum < threshold1) …; if (lum < threshold2) …`) and a
  constant `onLine` spacing/width, so every tone below `threshold2` is
  identical and hatch density never tightens with darkness. Real pen-and-ink
  hatching adds stroke layers and tightens spacing continuously as an area
  darkens (Winkenbach & Salesin's prioritized stroke textures).
- **Engraving** (`engraving.ts`) swells line width with tone correctly but
  draws a single global straight direction; deep shadows collapse into one
  thick bar with no second hatch set and no dot-and-lozenge shadow structure,
  which is the defining tone-carrier of copperplate/steel line engraving.
- **Woodcut** (`woodcutGL.ts`) is a plain luminance binarize plus a fixed 45°
  screen-door in device-pixel coordinates (`mod(jsX + jsY, lineFreq)`) that
  ignores image structure entirely, with arbitrary constants
  (`threshold*1.5`, `*0.3`, `mag > 30.0`). Relief carving prints white gouges
  that follow the block's form and grain and taper with tone.
- **Stipple** (`stippleGL.ts`) places exactly one hash-jittered dot per fixed
  lattice cell and conveys tone by growing the *dot radius*
  (`dotR = maxDotSize * darkness`). Constant count with variable radius on a
  grid is amplitude-modulated halftone — the opposite of stippling, whose dots
  are near-constant size and whose *spatial density* rises in dark areas on a
  blue-noise distribution.

## References

- G. Winkenbach and D. Salesin, "Computer-Generated Pen-and-Ink
  Illustration," SIGGRAPH 1994 — prioritized stroke textures; tone reproduced
  by number of stroke layers and spacing.
- A. Secord, "Weighted Voronoi Stippling," NPAR 2002 — constant-radius dots
  whose density matches image darkness; error-diffused placement as the
  practical approximation.
- R. Ulichney, "Digital Halftoning," MIT Press 1987 — void-and-cluster blue
  noise; density-modulated dot masks.
- J. E. Kyprianidis et al., "State of the Art: A Taxonomy of Artistic
  Stylization Techniques for Images and Video," IEEE TVCG 2013 — structure
  tensor / edge-tangent flow for form-following line art.
- Classical intaglio references for the dot-and-lozenge shadow structure of
  copper/steel line engraving (banknote engraving practice).

## Implementation

1. Add a shared, framework-free tone module
   `packages/ditherer-filters/src/filters/printmakingToneContracts.ts`
   exporting pure, unit-tested helpers: continuous tone→hatch-level and
   tone→spacing mappings, anti-aliased line/dot coverage, tone-accurate
   coverage inversion, a 3×3 structure-tensor orientation, a
   density→blue-noise-threshold mapping, and the dot-and-lozenge shadow
   coverage. Shared GLSL chunks mirror the same math so GPU and any CPU path
   agree in behaviour.
2. Rebuild **Crosshatch** as continuous fixed-angle tonal hatching: darkness
   maps to a hatch level that progressively activates the user's angle layers
   (angle1, angle2, then derived intermediate angles for deep shadow) with
   anti-aliased coverage and spacing that tightens with tone; total inked area
   tracks darkness. Keep the fixed user angles so it stays distinct from Flow
   Crosshatch. Update GL and JS paths; normalise sparse/malformed options;
   preserve source alpha; keep palette-identity semantics.
3. Rebuild **Engraving**: keep swelling primary burin lines, add a crossing
   secondary set in the shadows and a lozenge/dot texture in the deepest
   shadows, with gentle smoothed-orientation form following. Tone-accurate
   coverage; GL and JS paths; alpha and palette handling.
4. Rebuild **Woodcut** (GL): relief ink masses from a tone threshold, with
   mid-tones carried by tapered white gouges whose orientation follows the
   local structure tensor (not a fixed device-space screen) and whose spacing
   conveys tone; deterministic and frame-invariant.
5. Rebuild **Stipple** (GL): near-constant dot radius with dot presence
   governed by a blue-noise threshold mask so local dot density rises with
   darkness; remove the radius-encodes-tone behaviour.
6. Add unit tests for the tone module and for each filter's tonal
   monotonicity, alpha preservation, palette identity, and malformed-state
   fallback. Add real-browser GL-smoke contracts (tone-monotonic ink coverage,
   stipple constant-radius/variable-density, woodcut form-following) and
   register them in the smoke suites.
7. Run the full unit, Chromium/WebGL, lint, type, catalog, package, and app
   gates.

## Outcome

- A shared, unit-tested tone module (`printmakingToneContracts.ts`) now backs
  all four filters and their shaders: continuous tone→hatch-level and
  tone→coverage mappings, a centred anti-aliased mark coverage that vanishes
  at zero width (so undeveloped tones stay bare paper), a structure-tensor
  orientation, the engraving dot-and-lozenge ladder, and constant-radius
  density-modulated stipple placement. A single GLSL chunk mirrors the math.
- Crosshatch reproduces tone with four fixed-angle hatch layers (the two user
  angles plus two derived intermediates) whose strokes thicken within each
  tone band, keeping it distinct from the form-following Flow Crosshatch.
- Engraving swells its primary burin lines, adds a crossing secondary set in
  the mid-shadows and a lozenge/dot texture in the deepest shadows, with gentle
  structure-tensor form following, so shadows no longer collapse into one bar.
- Woodcut carries mid-tones with structure-tensor-oriented gouges whose carved
  (paper) fraction equals the local lightness, replacing the fixed 45°
  device-space screen, and keeps a solid ink contour on strong edges.
- Stipple places constant-radius dots gated by a per-cell noise threshold so
  dot density rises with darkness, removing the radius-encodes-tone behaviour.
- All four preserve source alpha, apply palette-identity semantics, and
  normalise sparse/malformed options; the JS fallbacks (Crosshatch, Engraving)
  were updated in step with the GPU paths.
- Verified with the tone-module and JS-path unit tests (+23 tests, 2,216
  total), the real-browser GL smoke (2,709 checks, including a new
  printmaking-stylizers suite for tone monotonicity, stipple density
  modulation, and source-alpha preservation), lint, typecheck, generated
  catalog verification, and the production application build.

Status: Complete

