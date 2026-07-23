# 089 — Reflective display and consumer-imaging hardening

**Status:** Complete

## Objective

Replace three simulations whose controls currently describe more physical
behavior than their renderers provide:

- rebuild E-ink around documented grayscale/color capacity and update-waveform
  behavior;
- rebuild Vintage TV around an analogue receiver and raster-display signal
  path; and
- rebuild Digicam Flash as a bounded linear-light, flat-scene flash-exposure
  proxy rather than encoded-RGB grading.

## Audit findings

### E-ink

- “4096 color” mode rounds channels to multiples of 64, yielding at most 125
  RGB combinations rather than 16 levels per channel (`16³ = 4096`).
- Color and monochrome modes sample at the same spatial resolution even though
  Kaleido modules pair a lower-resolution printed color-filter layer with the
  higher-resolution monochrome ink/TFT layer.
- Paper texture changes with frame index, producing emitted-display shimmer on
  a static reflective surface.
- A decorative three-pixel grid is enabled for every mode.
- Full-refresh output continues to blend generic previous-frame ghosting and
  both backends replace source alpha.

### Vintage TV

The current single shader shifts only red, adds a resolution-dependent sine
band, and boosts bright pixels. It does not model separate luminance and
chrominance bandwidth, chroma phase/tuning error, a stable scan raster, optical
bloom, or preserved alpha. The replacement will use an analogue decode pass,
separable bloom, normalized raster geometry, vertical-hold roll, and bounded
interference/noise.

### Digicam Flash

The current filter multiplies gamma-encoded RGB, applies warmth to the whole
scene rather than the flash contribution, infers “specular” material solely
from brightness, and hard-clips code values. The replacement will:

- treat the input as a flat-depth reflectance proxy;
- combine ambient and flash irradiance in linear light;
- use a smooth off-axis flash beam and separate lens-edge falloff;
- tint only the flash contribution; and
- apply sensor saturation before returning to sRGB.

The description and controls will state that a single image cannot recover
subject distance, surface normals, or material reflectance.

## Research basis

- E Ink documents Kaleido as a Carta ink layer plus printed color-filter array,
  with 16 grayscale levels and 4096 colors. A Kaleido module example specifies
  480×600 monochrome versus 160×200 color resolution.
- E Ink waveform manuals define waveform LUTs as previous-to-next pixel-drive
  sequences, distinguish changed-pixel direct/partial updates from 16-level
  grayscale clear modes, and describe full clears as the higher-quality,
  flashing update.
- ITU-R BT.470 specifies conventional 525/625-line analogue television,
  nominal field/line rates, display pre-correction, and video bandwidth. The
  artistic receiver keeps controls normalized to the loaded image while
  preserving those luma/chroma/raster relationships.
- Nikon and Canon flash documentation ties exposure to reflected light,
  subject distance, aperture, ISO, guide number, and flash white balance. Since
  the filter receives only an already-rendered image, it will explicitly remain
  a flat-scene reflectance proxy rather than claiming recovered geometry.

## Durable contracts

- E-ink grayscale has exactly 16 bounded reflectance levels before optional
  palette mapping; Kaleido uses at most 16 levels per channel and 3× lower
  color sampling resolution.
- Paper texture is frame-invariant, partial refresh retains transition
  residuals, and a settled full refresh does not.
- Vintage TV attenuates chroma detail more than equal-frequency luma detail,
  normalized scan structure is live, zero impairments approach identity, and
  vertical roll changes only when enabled.
- Digicam Flash is CPU/GL-equivalent, zero flash with unity ambient is identity,
  flash exposure is additive in linear light, warmth affects the flash term
  only, and saturation remains bounded.
- All three preserve source alpha and malformed saved-state values fall back to
  finite defaults.

## Verification

- [x] focused contracts fail before implementation and pass afterward
- [x] Chromium before/after contact sheets reviewed at full resolution
- [x] real WebGL2 compilation and numerical browser contracts pass
- [x] lint, TypeScript, full unit suite, generated catalog, package build, and
      application build pass
- [x] final review finds no stale controls, misleading copy, backend mismatch,
      temporary artifacts, or remaining findings in this tranche
