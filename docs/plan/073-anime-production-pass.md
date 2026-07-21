# 073 — Anime production pass

## Objective

Replace the weakest approximations in the existing anime family with a
deterministic, production-role-oriented toolset. Preserve existing filter names
and legacy option keys so saved chains continue to resolve, while making the
defaults and presets materially more useful.

The pass covers:

1. **Anime Color Grade** — scene color scripts, luminance-preserving split
   toning, highlight roll-off, chroma density, and skin-tone protection.
2. **Anime Tone Bands** — structure-aware flat shadow/base/highlight grouping
   that suppresses photographic texture before quantization and assigns color
   deliberately rather than multiplying everything by gray.
3. **Anime Ink Lines** — XDoG as the default line extractor, with separate
   scale, threshold, softness, line-weight, and texture-suppression controls,
   while retaining Sobel and Laplacian compatibility modes.
4. **Anime Sky** — coherent multi-octave painted clouds, horizon glow, and a
   more conservative sky-confidence mask.
5. **Anime Rim Light** — a new WebGL2 finishing pass that isolates directional
   contours and adds a controlled colored edge light and halo.
6. **Anime presets** — role-specific recipes and neutral naming, including
   clear-day, blue-hour, ink, environment-paint, and luminous-sky starting
   points.

## Research basis

- Arc System Works' *Guilty Gear Xrd* production talk stresses that cel shading
  is intentionally split between lit and unlit regions, that small normal noise
  becomes conspicuous at hard thresholds, and that shadow colors must be
  authored rather than treated as a uniform ambient multiply.
- Commercial animation color-design sheets specify distinct normal, shadow,
  and highlight colors per semantic region; line art and shading annotations
  are separate production layers.
- XDoG uses two Gaussian scales plus a soft threshold to produce controllable,
  noise-resistant stylized lines. The separable GPU formulation computes both
  Gaussians through horizontal and vertical convolution passes.
- Real-time video abstraction combines edge-aware smoothing, quantized color,
  and line extraction; abstraction should suppress photographic micro-detail
  before imposing graphic boundaries.
- Animation compositing and color design treat colored shading and final light
  effects as scene-defining decisions, not a global saturation boost.

Primary and first-party references:

- <https://www.ggxrd.com/Motomura_Junya_GuiltyGearXrd.pdf>
- <https://arxiv.org/abs/2410.19424>
- <https://www.kyprianidis.com/p/cag2012/winnemoeller-cag2012.pdf>
- <https://users.cs.northwestern.edu/~sco590/abstraction/imp_poster.pdf>
- <https://www.eizo.com/solutions/casestudies/creative-work/cwfilms/>

## Implementation

1. Add pure contracts for scene-look resolution, three-region cel-band
   classification, and XDoG soft-threshold response; test boundary behavior.
2. Capture current defaults on portrait and outdoor fixtures for a visual
   baseline.
3. Rebuild the four existing shaders while retaining filter identities and
   legacy control keys. Add descriptions to every control.
4. Implement Anime Rim Light as a source-backed WebGL2 filter and register it
   in the catalog and worker lookup.
5. Retune the Anime & Paint-over presets around explicit production roles and
   run the preset similarity report.
6. Regenerate package artifacts, execute every shader enum branch in Chromium,
   and perform iterative application-level visual reviews across portrait,
   outdoor, and sky-heavy fixtures.

## Acceptance gates

- Existing serialized Anime Color Grade, Tone Bands, Ink Lines, and Anime Sky
  chains still resolve and missing new options fall back safely.
- Color looks preserve luminance ordering, roll highlights without clipping,
  and visibly separate clear-day, warm, blue-hour, and neon-night moods.
- Tone bands use smoothed structural luminance, expose distinct shadow/base/
  highlight regions, and do not amplify fine source noise.
- XDoG response is monotonic around its threshold; all three line modes compile
  and produce opaque, non-flat output.
- Sky replacement stays conservative on a portrait with no sky and produces
  coherent, non-periodic cloud masses on an outdoor scene.
- Rim lighting changes direction with the light angle and is an identity at
  zero intensity.
- Focused contracts, full unit/integration tests, preset report, generated
  registry, lint, typecheck, production builds, and the complete WebGL2 gate
  pass.

## Outcome

- Replaced the global orange/magenta grade with five scene color scripts that
  shape luminance first, preserve skin hues, and roll highlights without RGB
  channel clipping.
- Rebuilt tone grouping around a separably smoothed structure image and bounded
  shadow/base/highlight ranges. A visual review caught and removed an initial
  black-crush/oversaturation failure before the final defaults were accepted.
- Made multi-scale XDoG the default ink extractor, retaining Sobel and
  Laplacian as compatible legacy branches and retaining the CPU fallback.
- Replaced periodic sky waves with four-octave coherent clouds, horizon light,
  and a conservative, structure-weighted sky mask. The mask was tightened after
  an outdoor review exposed false positives in textured distant terrain.
- Added the GPU-only Anime Rim Light compositor and tuned its default from a
  demonstrative edge glow to a restrained directional finishing light.
- Retuned the anime preset family around explicit production roles, renamed the
  artist-attributed sky recipe to `Luminous Sky Base`, and added a `Blue Hour
  Anime` finishing chain.
- Verification passed: 1,907 unit/integration tests, lint, TypeScript checks,
  selective-entry generation checks, library and application production
  builds, preset reporting, focused browser visual comparisons, and the full
  WebGL2 gate (2,589 paths; 720 shader compiles; 360 links; 8,435 draws).
