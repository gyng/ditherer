# 080 — Static-media simulation hardening

## Objective

Review the older Newspaper, Thermal Printer, Polaroid, and Watercolor Bleed
effects after the physical-imaging upgrade. Remove animation that contradicts
a fixed print or developed photograph, restore composable transparency, and
make resolution/detail controls operate on the simulated medium rather than on
incidental output pixels.

## Evidence and findings

- Newspaper and Polaroid seeded fixed print/film texture with `_frameIndex`, so
  unchanged input shimmered during video playback. Thermal Printer did the
  same for dropout, even though a direct-thermal line head exposes a fixed dot
  lattice. Polaroid also blurred every image by an undocumented 3×3 kernel;
  current instant-film guidance explicitly treats sharpness and definition as
  desirable image properties rather than an intrinsic film blur.
- Thermal Printer sampled source tone at the requested resolution but rolled
  dropout independently for every output pixel. A nominal low-resolution dot
  therefore broke into higher-resolution noise instead of acting as one print
  head element. Epson and Star specifications describe direct line-thermal
  devices in discrete dot positions (commonly 203 dpi / 8 dots per mm).
- Newspaper used one center sample to represent an entire halftone cell. That
  aliases details away before screening; traditional halftones encode local
  continuous tone as dot area on a regular grid, commonly at a 45° screen.
- Newspaper, Thermal Printer, and Watercolor Bleed forced alpha to opaque.
  Watercolor already uploaded the original source as a second texture but did
  not use it, making this a clear interrupted alpha-preservation path.
- Watercolor Bleed described inverse luminance as water content. Published
  watercolor models separate a wet-area mask, mobile pigment, deposited
  pigment, and capillary water. The existing single-field approximation must
  be labelled as a stylization rather than claiming that dark color is wetter.

## Implementation

1. Add permanent browser contracts for source-alpha preservation, frame
   invariance, thermal-cell coherence, and the absence of forced Polaroid blur.
2. Anchor static grain/displacement/dropout to medium coordinates rather than
   frame number and remove obsolete animation controls.
3. Hash Thermal Printer once per simulated print-head cell, preserve one cell
   decision across its output footprint, and use a bounded multisample tone
   estimate for newspaper cells.
4. Preserve source alpha through every pass and correct control descriptions,
   filter descriptions, partial saved-state defaults, and capability metadata.
5. Review representative defaults and stress variants in Chromium, then repeat
   the complete static/shader/control audit until a pass yields no findings.

## Acceptance gates

- Identical source and options produce identical output at different frame
  indices for all three fixed-media simulations.
- Every simulated thermal dot is internally coherent at output scales above
  one pixel; changing resolution changes the lattice without revealing
  output-resolution stochastic noise.
- The selected effects preserve source alpha exactly at default and stress
  settings, and neutral Polaroid settings do not spread an impulse spatially.
- Every declared control is described, sparse legacy options remain safe, and
  catalog copy distinguishes physical behavior from artistic approximation.
- Focused contracts, lint, TypeScript, unit tests, builds, bundle budget, and
  the complete Chromium WebGL2 gate pass after a final no-findings review.

## Outcome

- The first contract pass reproduced opaque-alpha output in Newspaper,
  Thermal Printer, and Watercolor Bleed; frame-relative artifacts in
  Newspaper, Thermal Printer, and Polaroid; output-pixel rather than
  print-head-cell dropout; an undocumented Polaroid box blur; incomplete
  control copy; and overstated watercolor physics.
- Newspaper now averages nine samples per cell on a controllable 45° screen.
  Thermal Printer hashes and fades coherent line-head cells. Polaroid retains
  source definition, has a true neutral identity, uses luminance-preserving
  warm dye balance, and anchors grain to the developed image. All selected
  paths preserve source alpha exactly.
- The first Chromium contact sheet found Polaroid's hidden exponential curve
  clipping white to roughly 72% and Watercolor's paper/edge result developing
  aliased worm patterns. The repeated sheet confirmed the corrected neutral
  grade, smooth multiscale fibers, and timestep-normalized deposition. A final
  static pass found and fixed edge fading that could vary inside large thermal
  cells; the strengthened maximum-fade contract then passed.
- The final repeated audit found no further correctness, control, alpha,
  temporal, shader, or visible-output finding in this tranche. Temporary visual
  harnesses were removed.
- Verification passed: 184 focused contracts; 1,941 full-suite tests with 179
  intentional skips; generated catalog; lint; TypeScript; library build;
  application build and 552.00 kB chunk budget; and the complete Chromium
  WebGL2 gate (`passed=2608`, `skipped=35`, `glFilters=267`,
  `requiredGL=157`, `compiles=724`, `links=362`, `draws=8562`).
