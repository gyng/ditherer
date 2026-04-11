# 021 - Cellular automata performance

## Goal

Make `Cellular automata` usable in realtime by removing the per-frame work explosion.

## Problem

The current implementation does two expensive things every frame:

- rebuilds the entire automaton grid from the source image
- simulates `steps + frameIndex` generations, so cost grows forever during playback

That makes the filter progressively slower the longer it runs.

## Approach

- Keep automaton state across frames in module-level buffers
- Initialize from the source image only when needed:
  - first frame
  - canvas size changes
  - rule or threshold changes
  - animation timeline restarts
- Advance only `steps` generations per render
- Reuse a pair of `Uint8Array` buffers instead of allocating a fresh grid every generation
- Mark the filter `mainThread: true` so its state persists correctly

## Verification

- Add focused tests for:
  - state persists across consecutive frames
  - state resets when frame index restarts
- Run `npm run typecheck`
- Run targeted Vitest for the new cellular automata spec
