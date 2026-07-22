# 076 — Film Burn quality pass

## Objective

Replace Film Burn's additive warm circles with a projection-gate heat-damage
model. Preserve the registered identity and the legacy `intensity`, `warmth`,
`hotspots`, and `seed` option keys so saved chains remain compatible.

## Evidence

- Kodak's processed-film handling guide describes projector burns as swellings
  that grow into blisters and progress to film destruction. It records hardened,
  crusty emulsion that can separate from the base, plus base distortion and
  brittleness.
- The National Film and Sound Archive of Australia documents heat-driven
  emulsion shrinkage, considerable distortion or cracking, color-dye changes,
  and shrinkage/distortion of the film base.
- The National Archives identifies emulsion as the image-bearing gelatin and
  photosensitive layer over the film base. A credible effect must therefore
  damage and displace the image layer, not merely add warm light to intact RGB.

References:

- <https://www.kodak.com/en/motion/page/handling-of-processed-film/>
- <https://www.nfsa.gov.au/collection/curated/asset/82865-fire-affected-photographic-materials>
- <https://www.archives.gov/preservation/formats/motion-picture-film-important-characteristics>

## Implementation

1. Add a pure, bounded burn-zone contract for heat reach, crust/blister rim,
   and destroyed core. Test growth and spatial ordering before shader work.
2. Replace the CPU/GL dual implementation with a single WebGL2 path: irregular
   multi-scale burn fronts, local source distortion, dye fading, a hardened
   dark crust, bright exposed-projector core, and fine cracks.
3. Retain legacy controls, add described controls for distortion, blistering,
   and front roughness, and make the catalog description physically specific.
4. Review native-size stills, regenerate selective entries, and rerun the full
   unit, lint, typecheck, build, and Chromium WebGL release gates.

## Acceptance gates

- Increasing intensity expands the destroyed core and heat-affected region.
- The default has visibly irregular damaged zones with a distinct crust/blister
  boundary; it is not reducible to a global warm grade or smooth additive disc.
- Pixels outside the heat zone retain the source; the near zone warps and fades
  the image; the core loses image detail; source alpha is preserved.
- Every control is described, saved partial option objects remain valid, and
  the filter issues a non-flat real WebGL2 draw at defaults.

## Outcome

- Film Burn now models an irregular multi-scale heat front, local base
  buckling, dye fading, hardened blister/crust, fine cracking, and an exposed
  projector-light core. The old smooth additive circles and global warm cast
  are gone; all legacy saved-state keys still resolve.
- Native-size browser review on Pepper and Lenna confirmed distinct intact,
  heat-affected, crust, blister, and destroyed-core regions with no browser
  errors. The temporary review harness was removed after acceptance.
- Verification passed: 20 focused contracts; 1,932 full-suite tests with 175
  intentional skips; lint; TypeScript; generated-entry check; library build;
  application build and bundle budget; and the complete Chromium WebGL2 gate
  (`passed=2598`, `skipped=35`, `glFilters=267`, `requiredGL=153`,
  `compiles=724`, `links=362`, `draws=8455`).
