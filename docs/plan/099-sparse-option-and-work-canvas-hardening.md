# 099 — Sparse Option and Work-Canvas Hardening

## Status

Complete.

## Findings

- LCD Display, Ultrasound, Night Vision, and Mavica FD7 destructure direct
  option objects without restoring controls omitted by older saved chains or
  share URLs.
- Mavica FD7 obtains an input-sized canvas before resizing it to its 640×480
  working ceiling, creating a needless large backing store for high-resolution
  inputs.

## Contracts

1. A sparse direct option object produces byte-identical output to the same
   override expanded over the filter defaults.
2. CPU and WebGL routes satisfy the sparse-state contract where both routes
   exist.
3. Mavica obtains its intermediate canvas at the final working dimensions and
   returns it to the shared pool after use.

## Verification

- Exact browser-render equivalence contracts for the four filters.
- Focused harness tests, lint, project TypeScript checking, and the complete
  Chromium WebGL gate.

## Outcome

- All four public wrappers now restore omitted persisted controls from their
  declared defaults while preserving supplied runtime state and overrides.
- Seven exact CPU/WebGL browser contracts compare sparse direct state with its
  fully expanded equivalent.
- Mavica now acquires its intermediate canvas directly at the bounded working
  resolution and releases it on every post-acquisition return path.
- The native-output control now describes its real behavior as a working-size
  ceiling up to 640×480; smaller sources are not misleadingly promised an
  upscale to exact VGA dimensions.
- Project TypeScript checking, focused lint, and 251 focused Vitest contracts
  passed. After correcting pooled-canvas source-over accumulation, the combined
  Chromium WebGL gate passed all 2,698 contracts with 35 intentional skips and
  9,405 draws.
