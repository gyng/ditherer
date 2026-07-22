# 078 — Cyanotype and Thermal Camera quality pass

## Objective

Correct two remaining physical-imaging filters whose current defaults or
catalog claims contradict their implementation:

1. **Cyanotype** — repair a 255× grain-unit error and model Prussian-blue image
   density over washed paper rather than clipping normalized tone with byte-
   scale noise.
2. **Thermal Camera** — disclose that visible RGB cannot contain emitted
   long-wave infrared temperature data, then render an honest visible-luminance
   proxy through thermal-camera display and sensor characteristics.

Preserve existing option keys so saved chains continue to load.

## Evidence

- The Getty Conservation Institute describes cyanotype as photochemical
  reduction of iron salts followed by Prussian-blue formation in exposed areas;
  water washing completes blue formation and dissolves unexposed sensitizer.
- FLIR documentation states that thermal cameras measure emitted infrared
  radiation rather than reflected visible light. Accurate temperature also
  depends on calibration, emissivity, reflected apparent temperature,
  atmosphere, humidity, and distance.
- FLIR documents level and span as display controls and lists iron, rainbow,
  white-hot, and black-hot palettes. These display choices do not create
  temperature data absent from the source.

References:

- <https://www.getty.edu/conservation/publications_resources/pdf_publications/pdf/atlas_cyanotype.pdf>
- <https://www.flir.com/en-asia/discover/rd-science/how-do-thermal-cameras-work/>
- <https://support.flir.com/docdownload/assets/web/2p5q/en-us/T505000.xml.html>
- <https://docs.flir.com/T810579/en-US/latest/s18.html>

## Implementation

1. Add pure contracts for cyanotype density/grain units and visible-proxy
   thermal level/span mapping. Cover tonal ordering, inversion, malformed
   values, and bounded output.
2. Rework Cyanotype in linear-light luminance with bounded normalized grain,
   paper-fiber variation, blue-density granulation, wash clearing, and source
   alpha preservation.
3. Rework Thermal Camera as WebGL2-only display simulation: cell-integrated
   low-resolution visible proxy, level/span window, fixed-pattern plus temporal
   sensor noise, palette mapping, and crosshair overlay.
4. Update descriptions and controls to state the proxy limitation explicitly,
   visually review representative sources, regenerate the catalog, and run all
   release gates.

## Acceptance gates

- Cyanotype default grain cannot move normalized tone by more than its declared
  control amplitude; dark positive-image input forms greater blue density than
  light input, and inversion reverses that order.
- Cyanotype highlights read as washed paper, dense regions as granulated
  Prussian blue, and source alpha survives.
- Thermal mapping is monotonic within the selected visible-proxy level/span,
  clamps outside it, and descriptions never imply measured temperature.
- Thermal default visibly reflects a low-resolution sensor/display pipeline
  rather than a full-resolution one-line luminance colormap.
- Both filters expose described controls, merge partial legacy options, issue
  real WebGL2 draws, and pass focused, full, build, generated, and browser GL
  validation.

## Outcome

- Cyanotype now maps linear-light source luminance into bounded Prussian-blue
  density over washed paper, with directional fibers, blue granulation, and
  source-alpha preservation. Its former byte-scaled grain input is normalized
  to the declared control amplitude.
- Thermal Camera now identifies itself as a visible-RGB luminance proxy rather
  than a temperature measurement. It integrates source samples into a
  configurable low-resolution sensor grid, then applies level/span, fixed and
  temporal sensor noise, documented display palettes, and an optional reticle.
- Native-size Chromium review covered Cyanotype on Goldhill and Barbara and the
  thermal proxy on Pepper and Lenna. The defaults retained readable image
  structure, differentiated paper and blue density, and produced a visibly
  sampled false-color display with no page or console errors.
- Verification passed: 34 focused contracts; 1,937 full-suite tests with 178
  intentional skips; lint; TypeScript; generated-entry check; library build;
  application build and bundle budget; and the complete Chromium WebGL2 gate
  (`passed=2595`, `skipped=35`, `glFilters=267`, `requiredGL=156`,
  `compiles=724`, `links=362`, `draws=8455`).
