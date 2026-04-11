# 019 — Approved Temporal Filter Batch

## Goal

Implement the currently approved temporal backlog items:

- `Temporal Poster Hold`
- `Temporal Ink Drying`
- `Temporal Relief`
- `Keyframe Smear`
- `Temporal Mosaic Stabilizer` as a mode on `Time Mosaic`
- `Frame Vote Dither` as a mode on error diffusion

## Why

These ideas were explicitly reviewed to avoid overlap with the shipped temporal set:

- `Temporal Poster Hold` adds sticky temporal quantization rather than blending
- `Temporal Ink Drying` adds material-state simulation
- `Temporal Relief` turns motion history into embossed geometry
- `Keyframe Smear` creates sparse-keyframe interpolation drift rather than exposure trails
- `Temporal Mosaic Stabilizer` extends tile history with motion-triggered refresh
- `Frame Vote Dither` extends temporal dither with consensus rather than residual carryover

## Implementation Order

1. land the four standalone filters
2. extend `Time Mosaic` with a stabilizer mode
3. extend error diffusion with `temporalMode: off | bleed | vote`
4. register new filters and add focused tests where behavior is easy to lock down
5. run `typecheck` and the narrowest viable Vitest coverage

## Acceptance Criteria

- all four new filters appear in the picker with generated controls
- `Time Mosaic` supports both delay-map and stabilizer behaviors
- error diffusion supports both `bleed` and `vote` temporal modes
- the batch passes `tsc --noEmit`
