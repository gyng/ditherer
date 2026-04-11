# 023 - CRT degauss flow trigger

## Goal

Add a `Flow` auto-trigger mode to `CRT Degauss` that reacts to directional motion rather than only scalar frame difference.

## Approach

- Reuse the existing block-matching motion-vector utilities in `utils/motionVectors.ts`
- Sample a sparse motion field from `_prevInput`
- Convert the estimated vectors into a compact trigger energy
- Keep it lightweight enough for a trigger check rather than a full motion overlay

## Notes

- This is intended as a cheap trigger signal, not a replacement for the dedicated motion-vectors filter.
- The shared `triggerThreshold` control should continue to work across motion, scene-cut, luma-spike, and flow modes.
