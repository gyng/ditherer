# 079 — Upgraded filter hardening rounds

## Objective

Review the eight filters rebuilt in plans 075–078—Infrared Photography,
Mezzotint, Nokia LCD, Daguerreotype, Film Burn, Ink Bleed, Cyanotype, and
Thermal Camera—through repeated static, contract, and real-browser passes.
Correct every reproducible correctness, saved-state compatibility, control,
shader, alpha, output-quality, or misleading-description finding, then repeat
the same audit without findings.

## Review method

1. Establish a clean generated/type/lint baseline and inspect every CPU/GL
   boundary, uniform unit, option normalization path, default, loop bound,
   alpha write, palette hand-off, and catalog claim.
2. Turn each concrete defect into the smallest durable contract that fails for
   the defect and passes only for the intended behavior.
3. Correct the implementation at the source, preserving legacy option keys and
   documented physical/process semantics.
4. Exercise all eight defaults plus meaningful low/high, mode, inversion, and
   partial-saved-state variants in Chromium. Reject shader failures, browser
   errors, flat/black output, accidental passthrough, destructive default
   clipping, and controls that do not materially affect output.
5. Repeat the static and visual review from the beginning. A pass that only
   confirms the changed lines is insufficient; the complete upgraded set must
   be rechecked.

## Acceptance gates

- Every finding has a reproducible contract or browser observation and a
  documented correction; no speculative churn is included.
- Legacy partial option objects remain accepted and every declared control is
  described, finite at its declared boundaries, and connected to its implementation.
- Defaults preserve source alpha, produce non-flat/non-black real GL draws, and
  remain legible on representative portrait, landscape, and high-frequency
  fixtures.
- Meaningful option extremes and enum modes compile and render without browser
  errors, transparent/opaque-black frames, or accidental passthrough.
- The final repeated audit records no additional findings and the generated
  catalog, focused contracts, lint, TypeScript, full unit suite, library/app
  builds, bundle budget, and complete Chromium WebGL2 registry gate all pass.

## Outcome

- Round one found and corrected six concrete defects: the infrared heuristic
  reduced neutral reflectance by 25%; Nokia LCD and Film Burn changed source
  alpha at defaults; Daguerreotype blurred alpha when soft focus was enabled;
  Nokia's grid introduced darker non-physical states and could cover every
  pixel; Ink Bleed treated equivalent 0°/180° fiber axes differently; and
  Thermal Camera omitted temporal metadata despite frame-varying noise.
- Film Burn's polar math now also defines the zero-vector case, avoiding
  implementation-dependent `atan(0, 0)`. Ink Bleed samples both directions of
  secondary fiber branches, and Nokia gaps use the off optical state only.
- The first contact-sheet review covered all eight defaults and strong option
  variants on portrait, landscape, natural-color, high-frequency, and game-art
  fixtures. It exposed an over-dense Nokia preview grid; the second pass
  suppressed gaps below a six-output-pixel cell scale and found no further
  visual issues. Temporary browser harnesses were removed after acceptance.
- The repeated full audit found no additional issues. Permanent Chromium
  contracts now cover alpha at default/stress settings, neutral infrared
  parity, Nokia's two-state grid at small/preview/8× scales, Daguerreotype view
  angle, Film Burn's zero-hotspot identity, Ink Bleed fiber-axis equivalence,
  Thermal noise on/off behavior, and sparse legacy Thermal options.
- Verification passed: 35 focused contracts; 1,938 full-suite tests with 178
  intentional skips; generated-entry check; lint; TypeScript; library build;
  application build and 552.00 kB chunk budget; and the complete Chromium
  WebGL2 gate (`passed=2603`, `skipped=35`, `glFilters=267`,
  `requiredGL=156`, `compiles=724`, `links=362`, `draws=8488`).
