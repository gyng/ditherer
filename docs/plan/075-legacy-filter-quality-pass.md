# 075 — Legacy filter quality pass

## Objective

Replace four high-confidence first-generation approximations whose output and
implementation contradict their catalog names. Preserve filter identities and
legacy option keys so existing chains continue to resolve.

This pass covers:

1. **Infrared photography** — replace the global magenta RGB mix with an
   explicit visible-RGB estimate of near-infrared response, a monochrome Wood
   effect, and Aerochrome-style NIR/red/green false-color channel mapping.
2. **Mezzotint** — replace source-colored random stippling with a dark-ground
   tonal intaglio model: multi-direction rocker burr, luminance-driven scraping
   and burnishing, ink, paper, and plate wear.
3. **Nokia LCD** — stop the default palette pass from destroying the panel's
   two green LCD states, and replace threshold-only photo reduction with an
   optional display-native ordered decision that preserves structure at 84×48.
4. **Daguerreotype** — remove the false “period softness” default and uniform
   metallic brightness lift; preserve fine image detail while modelling
   mercury-amalgam scattering over a mirror-polished silvered copper plate.

## Evidence and references

- Kodak Aerochrome data reproduced in NASA remote-sensing literature describes
  the film layers as sensitive to green, red, and near infrared, with infrared
  exposure producing red tones. An RGB image has no measured NIR band, so the
  filter must label its NIR value as a visible-color estimate rather than claim
  spectral reconstruction.
- The National Portrait Gallery defines mezzotint as a tonal, rather than
  linear, engraving process: the entire plate is rocked into an ink-holding
  burr, then scraped and burnished into lighter tones.
- The Metropolitan Museum of Art distinguishes mezzotint's continuous
  dark-to-light tonal process from stipple engraving. The current random
  source-color dots therefore model the wrong printmaking family.
- Philips' PCD8544 controller specification defines a 48×84 monochrome pixel
  matrix. Tonal detail must therefore come from spatial binary patterns, not
  invented gray levels; the two simulated LCD optical states must survive the
  palette stage unchanged.
- The Library of Congress and Metropolitan Museum of Art both describe
  daguerreotypes as remarkably/highly detailed direct positives on polished
  mirror-like silvered copper. Their visibility depends on illumination and
  observation angle; gold-chloride gilding improves contrast. Heavy default
  box blur therefore contradicts the medium rather than reproducing it.

References:

- <https://ntrs.nasa.gov/api/citations/19780007599/downloads/19780007599.pdf>
- <https://www.npg.org.uk/collections/explore/glossary-of-art-terms/mezzotint.php>
- <https://www.metmuseum.org/ja/essays/the-printed-image-in-the-west-mezzotint>
- <https://cdn.sparkfun.com/tutorialimages/GraphicLCDNokia3310/pcd8544.pdf>
- <https://www.loc.gov/preservation/scientists/projects/ungilded.html>
- <https://www.loc.gov/collections/daguerreotypes/articles-and-essays/the-daguerreotype-medium/>
- <https://www.metmuseum.org/de/essays/daguerre-1787-1851-and-the-invention-of-photography>

## Implementation

1. Add pure contracts for bounded estimated-NIR response and false-color
   channel mapping, with tests for green vegetation proxies, blue-sky
   suppression, channel ordering, and finite malformed inputs.
2. Rebuild Infrared Photography in linear light. Expose honest foliage
   response, sky suppression, false-color, contrast, and grain controls while
   retaining `intensity` and `falseColor` saved-state keys.
3. Rebuild Mezzotint as a monochrome/toned plate process with ink and paper
   colors, continuous tonal burnishing, multi-angle rocker texture, burr
   strength, and plate wear. Retain `density` and `dotSize` keys.
4. Regenerate the catalog, visually compare multiple fixtures at native size,
   and run focused contracts plus the complete Chromium WebGL registry gate.
5. Correct Nokia LCD's default palette contract, add display-grid ordered
   dithering with a retained hard-threshold mode, and review its 84×48 output.
6. Rebuild Daguerreotype around a detail-preserving direct-positive scattering
   image, directional mirror reflection, gilding contrast, and restrained plate
   age, while retaining legacy controls.
7. Resume the wider catalog audit after these fixes; this plan is one
   tranche of the persistent filter-quality objective, not proof that every
   older filter has been cleared.

## Acceptance gates

- Infrared default output is not a uniform magenta cast. Green foliage proxies
  produce a stronger estimated NIR response than neutral surfaces, blue-sky
  proxies are suppressed, and Aerochrome mapping sends estimated NIR to red,
  visible red to green, and visible green to blue.
- The Infrared UI and description disclose that NIR is estimated from visible
  RGB; every option has a description and legacy chains deserialize safely.
- Mezzotint produces continuous ink density from rich darks to clean paper
  highlights, remains monochrome/toned by default, and its rocker texture is
  multi-directional rather than isolated random source-colored pixels.
- Both filters preserve source alpha, issue real WebGL2 draws, remain
  non-flat/non-black at defaults, and pass catalog, unit, lint, typecheck,
  build, and complete browser shader validation.
- Nokia LCD remains a two-state 84×48 display by default, retains the intended
  dark-green/light-green optical palette after rendering, and uses spatial
  binary decisions rather than grayscale pixels to preserve photographic tone.
- Daguerreotype retains fine edges at defaults, forms a positive image from
  scattering particles over directional silver reflection, and exposes
  gilding/view-light/plate-age controls without claiming blur is inherent.

## Outcome

- The four filters now use explicit, bounded models aligned with the cited
  physical or print process, retain their legacy option keys, and expose
  described controls.
- Native-size browser review covered Infrared and Mezzotint on two fixtures,
  Nokia LCD at its 84×48 display resolution, and Daguerreotype on detailed
  portrait and landscape sources. Daguerreotype's temporary review harness
  also enforced non-flat luminance and a clean browser console.
- Verification passed: 15 focused contracts; 1,930 full-suite tests with 174
  intentional skips; lint; TypeScript; generated-entry check; library build;
  application build and bundle budget; and the complete Chromium WebGL2 gate
  (`passed=2599`, `skipped=35`, `glFilters=267`, `requiredGL=152`,
  `compiles=724`, `links=362`, `draws=8455`).
- The broader catalog-quality objective remains active; this outcome records
  the completed tranche and does not assert that every legacy simulation has
  been cleared.
