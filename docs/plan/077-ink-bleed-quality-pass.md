# 077 — Ink Bleed quality pass

## Objective

Replace Ink Bleed's isotropic square minimum and faded-source composite with a
fiber-aware paper absorption model. Preserve `spread`, `absorbency`,
`paperTint`, and `grain` for saved-chain compatibility.

## Evidence

- Open-access microscopy/modeling literature describes uncoated paper as an
  anisotropic porous medium made from crossing fiber bundles. Penetrating
  liquid first follows fibers, then fills inter-fiber pore space; capillary
  flow dominates initial uptake.
- Experimental/modeling work on thin fibrous sheets finds faster in-plane
  liquid spread as fibers become more aligned.
- Ink-setting literature distinguishes surface spreading from through-paper
  capillary uptake and identifies porosity, pore distribution, permeability,
  and capillary pressure as determinants of the resulting ink deposit.

References:

- <https://pmc.ncbi.nlm.nih.gov/articles/PMC6394735/>
- <https://www.sciencedirect.com/science/article/pii/S0017931010000165>
- <https://www.sciencedirect.com/science/article/abs/pii/S0927775711000525>

## Implementation

1. Add pure coverage contracts proving that darker source marks deposit more
   ink, absorbency transfers neighboring ink into paper, and outputs are
   bounded under malformed values.
2. Replace the dual CPU/GL implementation with a WebGL2 fiber field: oriented
   primary and cross fibers, spatially heterogeneous reach, capillary transfer
   from neighboring dark marks, edge feathering, and procedural paper grain.
3. Composite explicit ink density over paper rather than blending paper tint
   with the original RGB according to luminance. Preserve source alpha.
4. Review multiple native-size sources and run the complete verification set.

## Acceptance gates

- Dark marks produce more deposited ink than light marks; increasing
  absorbency increases neighboring coverage without reversing tonal order.
- Bleed edges visibly follow heterogeneous fiber directions instead of a
  rotationally uniform square kernel.
- Default output reads as dark ink deposited on warm paper rather than a faded
  pastel color grade, and source alpha survives.
- All controls are described, partial legacy options resolve, and the filter
  passes the real-browser GL registry gate.

## Outcome

- Ink Bleed now deposits explicit dark ink on a procedural paper substrate and
  gathers neighboring density through locally varying primary/cross-fiber
  directions. Porosity variation, edge feathering, ink granulation, and paper
  grain replace the square minimum and faded-source compositing formula.
- Source alpha is preserved and the obsolete CPU fallback/duplicate shader
  module were removed. Legacy option keys continue to merge into the expanded
  defaults.
- Native-size browser review on Barbara and Goldhill confirmed legible textile,
  face, masonry, and landscape structure with a coherent ink-on-paper result
  and no browser errors. The directional wicking remains material texture, not
  an exaggerated decorative line effect.
- Verification passed: 25 focused contracts; 1,934 full-suite tests with 176
  intentional skips; lint; TypeScript; generated-entry check; library build;
  application build and bundle budget; and the complete Chromium WebGL2 gate
  (`passed=2597`, `skipped=35`, `glFilters=267`, `requiredGL=154`,
  `compiles=724`, `links=362`, `draws=8455`).
