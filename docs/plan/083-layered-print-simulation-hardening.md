# 083 — Layered Print Simulation Hardening

## Status

Complete.

## Scope

Review and harden Risograph, Risograph (multi-layer), Screen Print /
Misregistration, and Duplex / Offset Print.

## Findings

- Both Risograph filters derive fixed master grain and plate registration from
  `_frameIndex`, so a completed print shimmers and shifts during animation.
- Two-color Risograph applies a one-pixel box blur even when Ink Bleed is zero.
- All four effects replace the source alpha plane with opaque paper.
- The two Risograph grain controls generate independent output-pixel noise,
  rather than a stable master/paper field.
- Screen Print calls its deterministic alternating plate-angle adjustment
  random jitter and has no halftone/mesh representation despite offering
  continuous-tone source separations.
- Duplex Print combines 0–255 ink uniforms through a subtractive paper term
  that can become negative before clamping, and it lacks sparse-state fallback
  and an honest filter description.

## Direction

- Treat masters, registration, and paper/ink variation as fixed sheet state.
- Make zero bleed a true no-blur path.
- Preserve source alpha while rendering the RGB result over simulated paper.
- Use spatially correlated master/ink variation rather than pixel static.
- Keep Screen Print's spot-color mode, describe deterministic angle spread
  truthfully, and add a printable rotated halftone screen with bounded dot gain.
- Composite duplex inks sequentially over paper with both plates clearing
  toward highlights; avoid negative paper energy.

## Evidence

- RISO documents a thermally perforated master wrapped around a print drum,
  with emulsion ink pressed through its holes and absorbed into the sheet.
- ScreenPrinting.com documents halftone tone reproduction as rotated dot grids,
  recommends angles that avoid the mesh axes, and describes pressure-driven
  dot gain.

## Verification

- Unit contracts for deterministic sheet state, zero-bleed radius, print-tone
  bounds, and halftone coverage.
- Chromium contracts for frame invariance, alpha, no forced blur, visible
  screen structure, and duplex highlight paper.
- Repeated contact-sheet review, then full lint/type/unit/build/GL gates.

## Outcome

- Completed three visual review rounds. The first exposed Screen Print's smooth
  yellow overpaint; the second exposed an overly fine default rosette; the
  third confirmed readable clustered dots and distinct plate overlap. The
  temporary browser harness was removed.
- Both Risograph variants are byte-stable across frame indices, use correlated
  fixed master variation, preserve alpha, and agree on exposed registration
  borders. Two-color zero bleed no longer spreads a one-pixel mark.
- Screen Print now uses resolution-relative rotated clustered dots,
  pressure-style dot gain, subtractive overprint, and deterministic offset
  angles described honestly.
- Duplex Print uses normalized sequential ink layers; both coverages clear to
  the exact configured paper color at white and source alpha is preserved.
- Final verification: 1,964 tests passed (179 skipped); lint, typecheck,
  generated-source verification, package build, and app build passed; the app
  chunk budget passed at 554.21 kB; WebGL smoke passed 2,621 cases with 35
  intentional skips across 267 GL filters, 724 compiles, 362 links, and 8,613
  draws.

## References

- https://www.riso.co.jp/english/tech_portal/core/ink.html
- https://www.riso.co.jp/product/risograph/feature/index.html
- https://www.screenprinting.com/blogs/news/a-crash-course-in-halftones-for-screen-printing
- https://www.screenprinting.com/pages/screen-printing-mesh-size-information
