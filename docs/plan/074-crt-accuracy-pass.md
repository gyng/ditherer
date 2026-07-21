# 074 — CRT accuracy pass

## Objective

Replace resolution-dependent CRT decoration with a display model whose transfer,
raster, mask, beam spot, geometry, and temporal behavior correspond to actual
tube mechanisms. Preserve existing filter identities and legacy option keys so
saved chains continue to resolve.

## Research basis

- ITU-R BT.1886 formalizes a 2.4 reference EOTF chosen to closely match legacy
  CRT reference displays. The simulation should therefore treat input RGB as
  drive voltage, form light in a CRT-like power domain, composite physical light
  effects there, and encode back to the browser display.
- ITU-R BT.470 specifies conventional 525/60 and 625/50 interlaced television
  systems. Raster visibility should be expressed as source scan-line count and
  field phase, not a fixed modulo of output pixels.
- Sony documents the distinction between round-hole shadow masks and the
  Trinitron aperture grille: continuous vertical RGB phosphor stripes, a
  vertical slit grille, and horizontal tungsten stabilizing wires.
- RCA's P22 group-phosphor data gives decay to 10% after excitation as about
  22 µs blue, 60 µs green, and 1 ms red. Standard P22 therefore should not
  create the strong green multi-frame trails in the current implementation.
- Published CRT measurements report a roughly 0.15–0.20 mm low-luminance spot
  growing toward 0.30 mm at higher beam current. The raster beam profile should
  widen with luminance and toward poorly focused corners instead of applying a
  constant horizontal blur.
- Sony's PVM operating guide specifies a 7% overscan mode, providing a concrete
  upper reference for a broadcast-monitor geometry control.

Primary and manufacturer references:

- <https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.1886-0-201103-I%21%21PDF-E.pdf>
- <https://www.itu.int/rec/R-REC-BT.470-7-200502-I/en>
- <https://www.sony.com/en/SonyInfo/CorporateInfo/History/SonyHistory/2-02.html>
- <https://www.worldradiohistory.com/BOOKSHELF-ARH/Technology/RCA-Books/RCA-Tube-Handbook-HB-3-Vol-1-2.pdf>
- <https://www.researchgate.net/publication/228988904_Principles_of_cathode-ray_tube_and_liquid_crystal_display_devices>
- <https://ia601006.us.archive.org/31/items/SonyPVM1344Q1342Q13411340ManualOperatingGuideInstructions_201806/Sony%20PVM%201344Q%201342Q%201341%201340%20Manual%20Operating%20Guide%20Instructions.pdf>

## Implementation

1. Add pure contracts for CRT EOTF/output encoding, decay-to-10% retention,
   beam-width growth, raster-line resolution, and tube-profile defaults.
2. Add explicit consumer shadow-mask, slot-mask, aperture-grille, and broadcast
   monitor profiles while retaining legacy mask values.
3. Move mask, beam, bloom, and temporal composition into linear-light working
   values. Encode and optionally quantize only in the final output pass.
4. Replace binary scanline rows with a Gaussian raster spot whose width grows
   with beam current and corner defocus. Express raster density in visible
   source lines, with field parity for interlaced modes.
5. Add overscan and aperture-grille stabilizing wires; reduce default
   misconvergence, black lift, bloom, and curvature to calibrated values.
6. Replace frame-relative phosphor decay with measured P22 and intentional
   long-persistence profiles using decay-to-10% milliseconds and refresh rate.
7. Retune CRT presets around clear roles, capture representative visual output,
   and execute the complete real-browser WebGL registry gate.

## Acceptance gates

- A mid-level drive passed through gamma 2.4 produces the expected CRT-light
  value and browser encoding; black remains black at default settings.
- Raster density is invariant under output scaling for a fixed visible-line
  setting, and interlace alternates source-line parity rather than pixel rows.
- Beam width is monotonic with luminance and corner defocus.
- Aperture grille uses continuous vertical stripes plus optional stabilizing
  wires; shadow/slot masks remain spatially distinct.
- P22 retention is derived from 1 ms / 60 µs / 22 µs decay-to-10% timing and is
  effectively gone by the next 60 Hz refresh; long-persistence profiles remain
  available explicitly.
- Existing option keys deserialize safely, every option has a description, and
  the full unit, registry, build, lint, preset, and Chromium WebGL gates pass.

## Outcome

- Added six calibrated tube profiles with raster counts, mask families,
  geometry baselines, beam-width growth, corner defocus, overscan, and
  aperture-grille stabilizing wires. Explicit user adjustments continue to
  override profile defaults, and legacy option keys/modes remain available.
- Rebuilt CRT rendering around a 2.4 voltage-to-light transfer and linear-light
  mask, beam, bloom, persistence, and final sRGB encoding. Raster sampling now
  integrates three sub-pixel beam samples to avoid output-resolution moiré.
- Moved interlace field selection after spatial display passes so retained
  fields are not repeatedly softened or bloomed; static images remain woven.
- Replaced the old frame-relative green trail with measured P22 timing,
  refresh-aware custom decay-to-10% controls, an explicit long-persistence
  profile, and a legacy mode for saved workflows.
- Retuned the standalone Scanline effect and added Arcade 240p, Aperture Grille
  Monitor, and Broadcast CRT presets. Representative 240p, aperture-grille,
  consumer, and standalone-raster screenshots were reviewed at native size.
- Verification: 1,918 unit tests passed (173 skipped), focused CRT tests passed
  (16 passed, 8 skipped), lint/type-check/library build/app build/catalog checks
  passed, the preset audit found no exact duplicates, and Chromium WebGL passed
  all 724 shader compilations, 362 links, and 8,455 draws.
