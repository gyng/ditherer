# 081 — Analog-film simulation hardening

## Objective

Rebuild Film Grain, Light Leak, and Projection Film where their existing
shortcuts contradict photographic density, exposure, projection, or surface-
damage behavior. Preserve saved option keys while improving spatial quality,
temporal semantics, alpha composability, control honesty, and defaults.

## Evidence and findings

- Film Grain adds uniformly distributed RGB values as square output-pixel
  blocks, defaults to a destructive ±30% excursion, and exposes animation
  without declaring temporal behavior. Kodak defines granularity as random
  density variation measured by RMS deviation; perceived grain depends on
  density, scene content, color, processing, and the full imaging chain.
- Light Leak silently weights every chosen color by hardcoded red/green/blue
  factors and adds it to gamma-encoded bytes. Kodak defines exposure as light
  acting on the photographic material and light piping as edge-entering fog;
  the chosen spectral color must therefore remain meaningful and the exposure
  addition must occur in linear light.
- Projection Film writes opaque alpha in both CPU and composite-shader paths.
  Its default scratch amount normally produces zero scratches, dust is drawn
  as emitted white light even though gate debris blocks the projected image,
  and all frame-varying controls lack temporal metadata and descriptions.
- Dust and scratch counts are unrelated to frame area, so resizing the same
  scene changes apparent defect density by orders of magnitude.

## Implementation

1. Add pure contracts for density-dependent grain amplitude and area-aware
   projection artifact counts, plus browser contracts for alpha, continuous
   grain clusters, spectrally neutral leaks, and dark projected dust.
2. Replace square grain blocks with smooth Gaussian-like density clusters,
   density-aware amplitude, correlated color-layer noise, safer defaults, and
   explicit temporal metadata while retaining manual animation controls.
3. Apply light-leak exposure in linear light without channel bias, preserve
   exact identity at zero intensity, and make sparse saved options safe.
4. Scale projection dust with image area, keep default scratches live, render
   gate dust as occlusion, preserve transformed alpha through bloom, and align
   CPU/GL behavior and metadata.
5. Review representative and stress variants in Chromium, repeat the complete
   audit, and remove temporary visual harnesses only after a no-findings pass.

## Acceptance gates

- Film grain has correlated non-square clusters, peaks perceptually around
  middle density, remains bounded at endpoints, and changes with frame only
  when nonzero grain is active.
- A neutral leak remains neutral, a colored leak respects the selected color,
  zero intensity is an identity, and alpha is unchanged.
- Projection defaults visibly exercise scratches at reference resolution,
  dust occludes rather than emits light, artifact density scales with area,
  temporal metadata is correct, and alpha survives every pass.
- All controls are described; sparse legacy options remain safe; focused
  contracts, generated metadata, lint, TypeScript, builds, bundle budget, and
  the complete Chromium WebGL2 gate pass after repeated review.

## Outcome

- The initial contracts reproduced square block-constant grain, destructive
  ±30% defaults, hardcoded RGB leak bias, opaque projection output, white gate
  dust, inert default scratches, resolution-independent defect counts, and
  missing temporal/control metadata.
- Film Grain now uses a bounded four-field density distribution, a
  middle-density response envelope, smoothly correlated clusters, and
  partially shared color-layer noise. Its default strength is restrained and
  motion is explicitly temporal.
- Light Leak now preserves the selected spectrum and adds exposure in linear
  light, with exact zero-intensity identity and sparse-state defaults.
- Projection Film preserves shifted alpha through composite and bloom, scales
  dust with area and scratches with width, occludes light for gate debris, and
  renders intermittent woven scratches as dark base damage or neutral/warm
  emulsion loss. Projection grain shares the bounded density model.
- The first Chromium sheet found full-height white scratches and pixel-noise
  projection grain. The second corrected their layer polarity, span, width,
  weave, and density response; the final sheet reduced default severity while
  retaining visible stress diversity. A repeated static audit found and fixed
  width-invariant scratch counts, then produced no further findings in this
  tranche. Temporary review harnesses were removed.
- Verification passed: 49 focused unit contracts; 1,949 full-suite tests with
  179 intentional skips; generated catalog; lint; TypeScript; library build;
  application build and 554.09 kB chunk budget; and the complete Chromium
  WebGL2 gate (`passed=2612`, `skipped=35`, `glFilters=267`,
  `requiredGL=157`, `compiles=724`, `links=362`, `draws=8582`).
