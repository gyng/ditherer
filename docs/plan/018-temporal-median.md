# 018 — Temporal Median

## Goal

Add a temporal median filter that composites each pixel from a short history window, suppressing transient movers and flicker instead of accumulating them.

## Why

This fills a different role from existing temporal filters:

- unlike `Temporal Exposure`, it rejects outliers instead of blending them
- unlike `Scene Separation`, it does not build an explicit motion mask or background model
- unlike `Chronophotography`, it does not intentionally reveal multiple exposures

The result should feel like a robust temporal consensus filter: brief motion disappears, static structure remains.

## Scope

Phase 1 for this implementation:

1. add `src/filters/temporalMedian.ts`
2. register it in `src/filters/index.ts`
3. expose generated controls:
   - `windowSize`
   - `animate` / `animSpeed`
4. add focused tests for:
   - median consensus over a short frame window
   - rejection of a one-frame outlier
   - reset when animation restarts

## Implementation Notes

- use a module-level ring buffer of recent full frames
- require `mainThread: true`
- reset history when:
  - frame dimensions change
  - `windowSize` changes
  - animation restarts (`_frameIndex` returns to `0` after advancing)
- preserve current-frame alpha

## Acceptance Criteria

- filter appears in the picker as `Temporal Median`
- static content survives while brief transient changes are suppressed
- targeted Vitest coverage passes
