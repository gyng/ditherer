# 028 - Anime look support

## Goal

Add a deliberate "anime look" workflow to Ditherer for still images and, where practical, video frames.

The goal is not just "make it cartoony." It is to support the kinds of transformations artists actually use when painting over photos into anime-style backgrounds and stylized scenes:

- simplify noisy photographic detail
- preserve major forms and perspective
- flatten color regions into cleaner bands
- introduce cleaner outlines where helpful
- push atmospheric color and lighting
- make skies, foliage, haze, and highlights feel painted rather than photographic

## Why this plan exists

Right now Ditherer can get partway there with filters like:

- `Toon / Cel Shade`
- `Posterize edges`
- `Bilateral blur`
- `Kuwahara`
- `Smooth posterize`
- `Palette Mapper by Hue Bands`
- `Sharpen`
- `Bloom`

That is enough for a "toon-filtered photo," but not consistently enough for a convincing anime-background workflow.

The missing pieces are mostly:

- better large-region simplification
- better atmosphere and sky handling
- less photographic foliage/texture noise
- more deliberate anime-oriented presets and copy

## Research summary

The common pattern across anime paint-over tutorials and image-abstraction work is:

1. simplify first
2. repaint or strongly restyle the sky
3. remove micro-detail from foliage, grass, and clutter
4. use broader shadow/light shapes than the photo naturally gives you
5. add atmospheric haze, bloom, and highlight accents sparingly

References:

- McLelun, "Anime Background Tutorial"
  - https://www.mclelun.com/2015/10/anime-background-tutorial.html
- McLelun, "Anime Background Paint Over Photo"
  - https://www.mclelun.com/2015/11/anime-background-paint-over-photo.html
- McLelun, "Painting Makoto Shinkai Style Anime Background"
  - https://www.mclelun.com/2017/06/painting-makoto-shinkai-style-anime.html
- McLelun, "Photoshop Paint Over Photo For Anime Style Outdoor Highway Scene"
  - https://www.mclelun.com/2018/12/photoshop-paint-over-photo-for-anime.html
- McLelun, "Colour Grading Using Curves and Levels For Anime Style Background Art"
  - https://www.mclelun.com/2019/04/colour-grading-using-curves-and-levels.html
- Winnemoeller et al., "Real-time Video Abstraction"
  - https://research.adobe.com/publication/real-time-video-abstraction/
- Kyprianidis et al., "Image and Video Abstraction by Anisotropic Kuwahara Filtering"
  - https://www.kyprianidis.com/p/pg2009/

Color-grading-specific takeaways from the McLelun article:

- anime backgrounds often push shadows cooler, especially toward blue/cyan
- highlights are often warmed rather than globally saturating the whole image
- curves and levels should be treated as tonal-shape tools, not just brightness controls
- strong grading is often best applied as a color-only or reduced-opacity pass rather than at full strength

## Product principles

### 1. Support anime-style simplification, not just edge detection

Photo-to-anime success depends more on simplifying texture and reshaping tone than on drawing black lines around everything.

### 2. Favor believable background painting cues

Skies, haze, foliage, and broad color masses matter more than dense comic-ink treatment for this use case.

### 3. Keep it usable as a chain system

We should ship:

- better presets immediately
- targeted new filters where the current stack has obvious gaps
- optional UI guidance later if needed

### 4. Be honest about automation limits

Ditherer can automate the base stylization and get much closer to anime art, but it will not replace manual repainting for:

- sky/cloud composition
- hero highlights
- fine cleanup of trees and clutter
- composition-aware emphasis

## Non-goals

- Do not promise one-click conversion to hand-painted anime art
- Do not depend on ML image generation or opaque black-box style transfer
- Do not block the work on manual paint tools or layer editing
- Do not make the anime workflow a separate rendering engine outside the normal chain system

## What ships in phases

## Phase A - Better anime presets with current filters

Ship curated presets first so users can get a good result immediately with no new engine work.

Suggested presets:

- `Anime Clean`
  - `Bilateral blur` -> `Toon / Cel Shade` -> `Sharpen`
- `Anime Background`
  - `Bilateral blur` -> `Posterize edges` -> `Levels` -> `Bloom`
- `Soft Anime Paint`
  - `Kuwahara` -> `Smooth posterize` -> `Sharpen`
- `Shinkai Sky Base`
  - `Smooth posterize` -> `Gradient map` -> `Anime Color Grade` -> `Bloom`
- `Graphic Anime Palette`
  - `Bilateral blur` -> `Palette Mapper by Hue Bands` -> `Edge trace`

Work:

- add 4-6 curated presets to `src/components/ChainList/presets.ts`
- tune descriptions to explain the intended scene type
- prefer presets that work for landscapes, streets, skies, and portraits separately

Success criteria:

- users can get a visibly more anime-like result without building a chain from scratch
- presets are distinct rather than small variants of the same recipe

## Phase B - Add the missing filters with the highest leverage

### 1. `Atmospheric Haze`

Purpose:

- simulate depth fade
- soften distant contrast
- tint highlights/horizon areas
- push scenes toward a painted background feel

Why it matters:

- atmosphere is one of the clearest differences between photo detail and anime background art

Suggested controls:

- `strength`
- `horizon`
- `softness`
- `highlightBloom`
- `tint`
- `depthMode`:
  - `luma`
  - `vertical`
  - `hybrid`

### 2. `Foliage Simplifier`

Purpose:

- reduce leaf/grass/noise chatter into grouped masses
- preserve silhouette while reducing interior detail

Why it matters:

- foliage is one of the biggest tells that an image is still just a filtered photo

Suggested controls:

- `radius`
- `regionMerge`
- `edgePreserve`
- `brushiness`
- `shadowRetention`

Implementation direction:

- region-aware smoothing plus edge retention
- biased toward clumping texture without destroying large boundaries

### 3. `Anime Sky`

Purpose:

- simplify or replace sky regions with a clean gradient and optional cloud shaping

Why it matters:

- tutorials repeatedly treat sky repainting as a major style step

Suggested first-version scope:

- detect likely sky region from top-of-frame color/luma heuristics
- optionally replace with:
  - flat gradient sky
  - gradient plus soft cloud bands
  - gradient plus bloom/haze only

Suggested controls:

- `mode`
- `skyStart`
- `gradientTop`
- `gradientBottom`
- `cloudAmount`
- `cloudSoftness`
- `blend`

Non-goal for v1:

- semantic-perfect sky segmentation

### 4. `Anime Tone Bands`

Purpose:

- create broader, more intentional anime-style shadow and light bands than generic posterize

Why it matters:

- current posterization can look mechanical instead of painted

Suggested controls:

- `shadowSteps`
- `highlightSteps`
- `edgeSoftness`
- `bandBias`
- `preserveSkin`

### 5. `Anime Color Grade`

Purpose:

- reproduce the curves-and-levels style grading used in anime background paint-over workflows
- cool the shadows, warm the highlights, and add controlled vibrance without flattening the whole image

Why it matters:

- the references consistently treat color grading as a major part of the anime look, not a final afterthought
- current generic color filters can help, but they do not expose the specific "cool shadows / warm highlights" behavior clearly

Suggested controls:

- `shadowCool`
- `midtoneLift`
- `highlightWarm`
- `contrast`
- `blackPoint`
- `whitePoint`
- `vibrance`
- `mix`

Implementation direction:

- base this on curve-like tonal remapping plus per-channel shadow/highlight tinting
- make `mix` explicit so users can back off the grade instead of fully committing it

## Phase C - Improve line handling for anime use cases

Current line-producing filters can be too noisy or too uniformly strong.

Add either a new filter or targeted upgrades to existing ones:

- `Edge trace`
- `Contour lines`
- `Toon / Cel Shade`
- `Posterize edges`

Needed behavior:

- fewer tiny false edges
- optional line thinning
- optional line darkening only on strong boundaries
- optional suppression of texture edges while keeping shape edges

Possible shape:

- new `Anime Ink Lines` filter
  or
- extend `Posterize edges` / `Toon / Cel Shade` with:
  - `textureSuppression`
  - `lineWeight`
  - `minEdgeStrength`

## Phase D - Add workflow guidance in the UI

Once the presets and filters exist, make them easier to discover.

Possible additions:

- tag presets with:
  - `anime`
  - `background`
  - `portrait`
  - `sky`
- add filter descriptions that explicitly call out anime-background use
- add a small preset grouping in the library browser:
  - `Anime & Paint-over`

Optional later:

- "good starting points" helper copy when an anime-oriented preset is loaded

## Phase E - Explore paint-over support, but do not block on it

Longer-term, the strongest anime workflow would include limited manual paint-over support:

- sky replacement overlays
- brush-based cleanup layers
- light/haze painting

That is valuable, but it is a larger product direction and should not block the filter/preset work above.

## Implementation notes

### Reuse what already exists

Before building new systems, reuse and tune:

- `Bilateral blur`
- `Kuwahara`
- `Anisotropic diffusion`
- `Smooth posterize`
- `Posterize edges`
- `Toon / Cel Shade`
- `Palette Mapper by Hue Bands`
- `Bloom`
- `Levels`
- `Sharpen`
- existing `Curves`/tone-shaping behavior where available through filters or future utility code

### Keep filters composable

Each new filter should still follow the normal Ditherer filter contract:

- self-contained module in `src/filters/`
- `optionTypes`
- `defaults`
- registration in `src/filters/index.ts`

Avoid baking the whole anime workflow into one giant filter.

### Prefer broad-scene robustness over perfect semantic understanding

We do not need a fragile "AI anime converter."
We need deterministic stylization tools that consistently push images in the right direction.

## Verification

Create a reference image set for evaluation:

- urban street with sky
- foliage-heavy landscape
- portrait
- interior with window light
- sunset / golden-hour scene

For each phase:

- save baseline exports before changes
- compare:
  - region simplification
  - edge cleanliness
  - sky quality
  - foliage readability
  - atmospheric mood

Add focused tests where practical for:

- deterministic region masking logic
- sky-region heuristics
- option serialization for new filters
- grading math for shadow/highlight channel remapping

Manual review matters here more than numeric tests, so include visual before/after snapshots in the plan follow-up.

## Recommended order

1. Ship anime-oriented presets using current filters
2. Build `Anime Color Grade`
3. Build `Atmospheric Haze`
4. Build `Foliage Simplifier`
5. Build `Anime Sky`
6. Improve line control for anime edges
7. Add discovery and preset-library polish

## Expected outcome

After this plan, Ditherer should be able to produce:

- cleaner anime-style backgrounds
- more convincing painted skies
- less photographic foliage noise
- stronger atmospheric depth
- better one-click starting points for anime-inspired stylization

Without pretending that the result is fully hand-painted art.
