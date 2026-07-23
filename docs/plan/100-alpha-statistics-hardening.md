# 100 — Alpha-aware neighborhood statistics

Status: Complete

## Objective

Prevent invisible RGB and near-transparent samples from contributing full-strength
energy to three upgraded imaging pipelines: Night Vision bloom, LCD logical-cell
emitters, and Spectrogram column spectra.

## Findings

- Night Vision preserves output alpha but derives its luminance and bloom guide
  from straight RGB alone, allowing a fully transparent bright pixel to cast a
  visible phosphor halo and a low-alpha pixel to bloom at full energy.
- LCD Display samples one logical-cell centre's RGB independently of its alpha,
  then uses that value for visible emitters elsewhere in the cell.
- Spectrogram includes transparent rows' hidden RGB in both CPU and WebGL DFTs,
  changing the spectrum drawn over visible rows.
- Existing browser checks compare alpha bytes or use opaque fixtures, so these
  cross-pixel RGB leaks remain invisible to the release gate.

## Implementation

1. Keep Night Vision's local straight-color response for visible pixels, but
   carry source alpha in its guide and weight only bloom energy by that alpha.
   Mirror the same rule in the CPU path and zero the guide for alpha-zero input.
2. Weight LCD's bounded cell-centre sample by its alpha before driving any
   emitter layout; continue preserving destination alpha exactly.
3. Weight every Spectrogram signal sample by source alpha in both DFT paths.
4. Add real-browser paired-source contracts that change only hidden RGB, plus
   low-alpha LCD energy checks for RGB stripe, PenTile, and Diamond layouts.
5. Run focused unit/contracts, TypeScript, lint, and the complete Chromium
   WebGL registry gate.

## Acceptance

- Changing RGB under zero alpha cannot change any visible output pixel in the
  three filters on either available backend.
- LCD centre energy scales down for near-transparent samples in every layout.
- Source alpha remains byte-exact, CPU/WebGL Night Vision and Spectrogram rules
  remain aligned, and every changed shader compiles and draws in Chromium.

## Outcome

- Night Vision now carries source coverage alongside straight local intensity
  and weights only scattered bloom energy by alpha in both CPU and WebGL.
- LCD logical-cell emitter energy is weighted by the sampled centre coverage,
  and Spectrogram's CPU/WebGL DFT inputs are alpha weighted.
- Paired hidden-RGB contracts cover all affected backends and LCD layouts; a
  separate alpha-1 versus alpha-255 contract protects low-coverage attenuation.
- Focused tests, lint, TypeScript, generated catalog verification, and the full
  Chromium WebGL gate passed with 2,698 checks and 9,405 draws.
