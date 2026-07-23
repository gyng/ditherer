# 111 — Named-Transform Correctness (Duotone, Wallpaper, Frequency)

Status: Complete

## Objective

Repair three filters whose implementation contradicts the named transform:
Duotone (a single luma lerp = a gradient map, not a two-ink duotone), Wallpaper
Tiling (P2 was byte-identical to PMM — the wrong symmetry group — and P6M was an
"approximate triangular fold", not 6-fold), and Frequency Filter (a box blur
masquerading as frequency separation).

## Evidence

- **Duotone** (`duotoneGL.ts`): `mix(shadow, highlight, luma)` — one linear luma
  lerp between two colours, a two-stop gradient map. A print duotone reproduces
  the image with two inks, each with its own non-linear density curve,
  composited by ink density over paper — the midtone hue crossover a lerp can't
  make. (`Duplex Print` already implements the correct two-plate model.)
- **Wallpaper Tiling** (`wallpaperTiling.ts`): P2 reflected each axis
  independently (`if(fx>=sz) fx=…; if(fy>=sz) fy=…`) — that is PMM's two mirror
  lines, which the p2 group forbids (p2 is a 180° rotation, no mirrors). P6M
  used an admitted "approximate triangular fold" that is not 6-fold.
- **Frequency Filter** (`frequencyFilter.ts`): the separation kernel was a
  separable BOX blur ("box blur" at line 69); a box's sinc frequency response
  has large side-lobes and sign inversions, so a box-built "low/high/band" rings
  rather than isolating bands.

## References

- Print duotone ink-density-over-paper model (Photoshop Duotone curves);
  mirrored on the repo's `duplexPrint`.
- The 17 wallpaper groups (Schattschneider, "The Plane Symmetry Groups";
  Conway orbifold notation — p2 = 2222, pmm = *2222, p6m = *632).
- Gaussian vs box frequency response; difference-of-Gaussians band-pass
  (Gonzalez & Woods).

## Implementation

1. Rebuild **Duotone** as two ink density curves (a monotonic shadow ink and a
   midtone-bump second ink) composited over paper like a duplex print, with
   paper-colour and per-ink curve controls.
2. Add a unit-tested `wallpaperFolds.ts` where each group's fold is verified by
   its actual crystallographic invariance (P2 invariant under 180° rotation but
   NOT under a mirror; P6M invariant under 60° rotation, a mirror, and the hex
   lattice), with a GLSL mirror. Rebuild **Wallpaper Tiling** to call them.
3. Rebuild **Frequency Filter** to use a separable GAUSSIAN low-pass (σ = r/3)
   and a difference-of-Gaussians band-pass.
4. Normalise options; preserve alpha and palette. Add unit tests and
   real-browser GL-smoke contracts; register them.
5. Run the full unit, Chromium/WebGL, lint, type, catalog, package, and app
   gates.

## Outcome

- Duotone now composites two ink density curves over paper (monotonic shadow ink
  + midtone-bump second ink), producing a real overprint crossover — black →
  shadow ink, white → paper — instead of a gradient map.
- Wallpaper Tiling's P2 is a genuine 180° rotation (no mirror lines) and P6M is a
  real hexagonal 6-fold + mirror kaleidoscope (nearest hex centre + D6 fold), all
  backed by the invariance-tested `wallpaperFolds.ts`.
- Frequency Filter uses a Gaussian low-pass and a difference-of-Gaussians band,
  with monotonic side-lobe-free rolloff.
- Two adversarial reviews found Duotone and Frequency Filter fully correct, and
  Wallpaper Tiling's folds correct (GLSL↔JS parity exact, P2 genuinely p2, P6M
  genuinely p6m and boundary-consistent). Low-severity fixes applied: a P6M
  `atan(0,0)` guard at the exact tiling centre, palette normalisation, and a new
  GL contract locking the Gaussian low-pass (the box→Gaussian fix was otherwise
  untested).
- Verified with the wallpaper-fold invariance unit tests (+6, 2,265 total),
  real-browser GL-smoke contracts (Wallpaper P2 rotation-not-mirror; Frequency
  Gaussian-not-box low-pass), lint, typecheck, catalog, and build.
