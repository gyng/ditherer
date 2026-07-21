# 070 — Unusual display simulations

## Objective

Add four visually distinctive simulations based on unusual acquisition or
display mechanisms rather than generic period grading:

1. Baird 30-line mechanical television.
2. IBM CGA composite-video artifact color.
3. Control Data PLATO gas-plasma terminal.
4. Single-chip DLP sequential-color projection.

All four effects are gather-parallel and therefore WebGL2-only. Their controls
expose the underlying physical or signal constraints, and the catalog text
names those constraints so users can distinguish them from nearby CRT, NTSC,
pixel-art, and glow effects.

## Specification basis

- Baird/BBC experimental television used 30 vertically scanned lines at 12.5
  pictures per second; the low-definition signal fit an audio-bandwidth radio
  channel and contemporary receivers used a mechanically scanned neon image.
- IBM's Color/Graphics Monitor Adapter provided 16 KiB of display memory,
  all-points-addressable graphics, and both direct-drive RGBI and composite
  television-frequency outputs. The composite path turns high-frequency pixel
  phase into NTSC chroma, producing colors absent from the digital palette.
- The PLATO CC546 panel is a square 512×512 electrode grid in neon gas. An
  addressed intersection lights as a small orange dot and remains lit until
  explicitly erased; an optional microfiche projector can be superimposed.
- A single-DMD DLP projector presents red, green, and blue illumination in
  sequential subfields. Multiple color cycles reduce visible color breakup;
  eye, camera, or scene motion separates the subfields into colored fringes.

Primary/reference documents:

- Baird technical history and operating standard:
  <https://core.ac.uk/download/pdf/185315161.pdf>
- IBM Color/Graphics Monitor Adapter Technical Reference:
  <https://bitsavers.org/pdf/ibm/pc/cards/Technical_Reference_Options_and_Adapters_Volume_2_Apr84.pdf>
- Control Data PLATO Terminal User's Guide, appendix D:
  <https://www.bitsavers.org/pdf/cdc/terminal/IST/97404800E_PLATO_Terminal_Users_Guide_197909.pdf>
- Texas Instruments DLP Pico LED Driver Design Guide:
  <https://www.ti.com/lit/an/dlpa038a/dlpa038a.pdf>
- Texas Instruments DMD sequence generation and color-cycle discussion:
  <https://www.ti.com.cn/cn/lit/an/dlpa119/dlpa119.pdf>

## Implementation

1. Add pure timing/geometry helpers for the Baird vertical raster, CGA phase,
   PLATO square-grid mapping, and DLP color subfield offsets.
2. Render Baird television through a 30-column vertical scan, low-pass vertical
   detail, neon spot, aperture falloff, disc eccentricity, and 12.5 Hz frame
   phase.
3. Render CGA by first reducing the source to a legal one- or two-bit pixel
   stream and then decoding either RGBI or phase-sensitive NTSC composite
   chroma with adjustable monitor bandwidth and hue.
4. Render PLATO as a square 512×512 bistable neon panel with threshold/dither,
   electrode grid, dot bloom, glass tint, and optional microfiche-like source
   underlay.
5. Render DLP as sequential RGB subfields with configurable wheel cycles,
   simulated eye/camera motion, bit-plane sparkle, phase, and animation.
6. Register all filters, regenerate lazy catalog artifacts, and add focused
   pure, registry, and real-browser shader contracts.

## Acceptance gates

- Baird geometry is exactly 30 vertical scan columns and a 12.5 Hz frame phase.
- CGA RGBI mode emits only its legal palette; composite mode responds to
  four-pixel carrier phase and monitor bandwidth.
- PLATO maps into a centered square 512×512 logical grid and emits persistent
  orange-neon dots rather than a generic monochrome tint.
- DLP subfield separation decreases monotonically as color-cycle count rises
  and changes direction with simulated motion.
- Every option has a user-facing description and finite fallback.
- All four declare `requiresGL`, issue real draws, compile every enum branch,
  and produce visible, opaque output in Chromium.
- Generated catalog checks, unit tests, typecheck, lint, production build, and
  `npm run test:gl` pass.

## Outcome

Implemented all four simulations and visually reviewed their defaults in the
real application against the bundled image fixture. The review prompted a CGA
encoder rewrite to choose among legal four-phase bit patterns instead of
clipping arbitrary YIQ samples, plus a standards-safe PLATO vignette expression
with ordered `smoothstep` edges.

The final browser gate exercises every option branch and scalar extreme for the
four filters, requires a real WebGL2 draw and dynamic range, and separately
asserts that CGA RGBI output contains only the 16 legal palette colors. Final
verification: 1,858 unit/integration tests passed; the Chromium gate passed
2,519 shader profiles across 698 compiles and 8,085 draws; lint, typecheck,
generated-registry verification, and the production bundle check passed.
