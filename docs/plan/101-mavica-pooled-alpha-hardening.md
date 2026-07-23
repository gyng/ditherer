# 101 — Mavica pooled-canvas alpha hardening

Status: Complete

## Objective

Make repeated Mavica FD7 renders preserve source alpha independently of pooled
canvas history.

## Finding

Mavica acquires its working canvas from the shared pool and immediately draws
the input with the default source-over composite operation. A released canvas
retains its previous pixels, so a second render composites the same translucent
source over stale coverage. For the failing alpha byte, this produces
`19 + 19 * (1 - 19 / 255)`, rounded to the observed 36.

## Implementation

Clear the complete acquired work canvas before either the scaled or unscaled
source draw. Keep the existing consecutive FIELD/FRAME source-alpha browser
contract as the regression gate because it already reproduces pooled reuse and
requires byte-exact alpha.

## Acceptance

- Repeated Mavica renders preserve every source alpha byte.
- FIELD and FRAME modes remain correct through WebGL and CPU fallback paths.
- Focused checks and the complete Chromium WebGL gate pass.

## Outcome

- Mavica clears its bounded pooled staging canvas before every scaled or
  unscaled source draw, eliminating history-dependent source-over coverage.
- The existing consecutive FIELD/FRAME alpha contract reproduces the original
  `19 -> 36` failure and now preserves every alpha byte exactly.
- TypeScript, lint, focused tests, and the full Chromium WebGL gate passed with
  2,698 checks, 732 compiles, 366 links, and 9,405 draws.
